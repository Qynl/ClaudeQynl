"""
Minimal MCP (Model Context Protocol) client — stdio and Streamable-HTTP transports.
No SDK, plain JSON-RPC 2.0. Every call is gated by safety.check_tool_call.
"""
from __future__ import annotations
import asyncio
import json
import os
import shlex
import sys
from typing import Any, Callable, Awaitable

import aiohttp

from .safety import check_tool_call, SafetyVerdict

PROTOCOL_VERSION = "2025-03-26"


class MCPServer:
    def __init__(self, name: str, cfg: dict):
        self.name = name
        self.cfg = cfg
        self.transport = cfg.get("transport", "stdio")
        self.tools: list[dict] = []
        self.connected = False
        self.error = ""
        self._id = 0
        self._pending: dict[int, asyncio.Future] = {}
        self._proc: asyncio.subprocess.Process | None = None
        self._reader_task: asyncio.Task | None = None
        self._session: aiohttp.ClientSession | None = None
        self._http_session_id: str | None = None
        self.on_log: Callable[[str], Awaitable[None]] | None = None

    # ---------- lifecycle ----------
    async def connect(self):
        try:
            if self.transport == "stdio":
                await self._connect_stdio()
            else:
                await self._connect_http()
            init = await self.request("initialize", {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "Nex", "version": "1.0"},
            })
            await self.notify("notifications/initialized", {})
            res = await self.request("tools/list", {})
            self.tools = res.get("tools", [])
            self.connected = True
            self.error = ""
            return init
        except Exception as e:
            self.connected = False
            self.error = str(e)
            await self.close()
            raise

    async def _connect_stdio(self):
        cmd = self.cfg["command"]
        args = self.cfg.get("args", [])
        if isinstance(cmd, str) and not args:
            parts = shlex.split(cmd, posix=(os.name != "nt"))
            cmd, args = parts[0], parts[1:]
        env = {**os.environ, **self.cfg.get("env", {})}
        self._proc = await asyncio.create_subprocess_exec(
            cmd, *args, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE, env=env,
            cwd=self.cfg.get("cwd") or None,
        )
        self._reader_task = asyncio.create_task(self._stdio_reader())
        asyncio.create_task(self._stderr_reader())

    async def _connect_http(self):
        self._session = aiohttp.ClientSession(headers=self.cfg.get("headers", {}))

    async def close(self):
        self.connected = False
        if self._reader_task:
            self._reader_task.cancel()
        if self._proc and self._proc.returncode is None:
            try:
                self._proc.terminate()
                await asyncio.wait_for(self._proc.wait(), 3)
            except Exception:
                try:
                    self._proc.kill()
                except Exception:
                    pass
        if self._session:
            await self._session.close()
        self._proc = None
        self._session = None
        for f in self._pending.values():
            if not f.done():
                f.set_exception(ConnectionError("MCP closed"))
        self._pending.clear()

    # ---------- transport ----------
    async def _stdio_reader(self):
        assert self._proc and self._proc.stdout
        while True:
            line = await self._proc.stdout.readline()
            if not line:
                self.connected = False
                self.error = "server exited"
                break
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            self._dispatch(msg)

    async def _stderr_reader(self):
        assert self._proc and self._proc.stderr
        while True:
            line = await self._proc.stderr.readline()
            if not line:
                break
            if self.on_log:
                await self.on_log(line.decode(errors="ignore").rstrip())

    def _dispatch(self, msg: dict):
        if "id" in msg and msg["id"] in self._pending:
            fut = self._pending.pop(msg["id"])
            if "error" in msg:
                fut.set_exception(RuntimeError(msg["error"].get("message", str(msg["error"]))))
            else:
                fut.set_result(msg.get("result", {}))

    async def request(self, method: str, params: dict, timeout: float = 120) -> Any:
        self._id += 1
        rid = self._id
        msg = {"jsonrpc": "2.0", "id": rid, "method": method, "params": params}
        if self.transport == "stdio":
            assert self._proc and self._proc.stdin
            fut: asyncio.Future = asyncio.get_event_loop().create_future()
            self._pending[rid] = fut
            self._proc.stdin.write((json.dumps(msg) + "\n").encode())
            await self._proc.stdin.drain()
            return await asyncio.wait_for(fut, timeout)
        else:
            return await self._http_request(msg, timeout)

    async def notify(self, method: str, params: dict):
        msg = {"jsonrpc": "2.0", "method": method, "params": params}
        if self.transport == "stdio":
            assert self._proc and self._proc.stdin
            self._proc.stdin.write((json.dumps(msg) + "\n").encode())
            await self._proc.stdin.drain()
        else:
            try:
                await self._http_request(msg, 10, expect_result=False)
            except Exception:
                pass

    async def _http_request(self, msg: dict, timeout: float, expect_result: bool = True) -> Any:
        assert self._session
        headers = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
        if self._http_session_id:
            headers["Mcp-Session-Id"] = self._http_session_id
        async with self._session.post(self.cfg["url"], json=msg, headers=headers,
                                      timeout=aiohttp.ClientTimeout(total=timeout)) as r:
            sid = r.headers.get("Mcp-Session-Id")
            if sid:
                self._http_session_id = sid
            if not expect_result:
                return None
            ctype = r.headers.get("Content-Type", "")
            if "text/event-stream" in ctype:
                async for raw in r.content:
                    line = raw.decode(errors="ignore").strip()
                    if line.startswith("data:"):
                        try:
                            d = json.loads(line[5:].strip())
                        except json.JSONDecodeError:
                            continue
                        if d.get("id") == msg.get("id"):
                            if "error" in d:
                                raise RuntimeError(d["error"].get("message"))
                            return d.get("result", {})
                raise RuntimeError("SSE stream ended without a response")
            data = await r.json()
            if "error" in data:
                raise RuntimeError(data["error"].get("message"))
            return data.get("result", {})

    # ---------- tools ----------
    async def call_tool(self, name: str, args: dict, user_consented_playtest: bool = False) -> dict:
        verdict: SafetyVerdict = check_tool_call(self.name, name, args, user_consented_playtest)
        if not verdict.allowed:
            return {"blocked": True, "reason": verdict.reason, "needs_user_consent": verdict.needs_user_consent}
        res = await self.request("tools/call", {"name": name, "arguments": verdict.sanitized_args})
        texts = []
        for c in res.get("content", []):
            if c.get("type") == "text":
                texts.append(c.get("text", ""))
            else:
                texts.append(f"[{c.get('type')} content]")
        return {"blocked": False, "isError": res.get("isError", False), "text": "\n".join(texts)[:12000]}


class MCPManager:
    def __init__(self):
        self.servers: dict[str, MCPServer] = {}
        self.on_log: Callable[[str, str], Awaitable[None]] | None = None

    async def load(self, configs: dict[str, dict]):
        # disconnect removed
        for name in list(self.servers):
            if name not in configs:
                await self.servers[name].close()
                del self.servers[name]
        for name, cfg in configs.items():
            if not cfg.get("enabled", True):
                if name in self.servers:
                    await self.servers[name].close()
                    del self.servers[name]
                continue
            if name in self.servers and self.servers[name].cfg == cfg and self.servers[name].connected:
                continue
            if name in self.servers:
                await self.servers[name].close()
            srv = MCPServer(name, cfg)

            async def _log(line, _n=name):
                if self.on_log:
                    await self.on_log(_n, line)

            srv.on_log = _log
            self.servers[name] = srv
            try:
                await srv.connect()
            except Exception:
                pass  # error stored on server

    def status(self) -> list[dict]:
        return [{"name": s.name, "connected": s.connected, "error": s.error, "transport": s.transport,
                 "tools": [t["name"] for t in s.tools]} for s in self.servers.values()]

    def ollama_tools(self) -> list[dict]:
        """Expose MCP tools as OpenAI-style function tools, namespaced server__tool."""
        out = []
        for s in self.servers.values():
            if not s.connected:
                continue
            for t in s.tools:
                out.append({"type": "function", "function": {
                    "name": f"{s.name}__{t['name']}",
                    "description": (t.get("description") or "")[:800],
                    "parameters": t.get("inputSchema") or {"type": "object", "properties": {}},
                }})
        return out

    async def call(self, qualified: str, args: dict, consent: bool = False) -> dict:
        if "__" not in qualified:
            return {"blocked": True, "reason": f"unknown tool {qualified}"}
        sname, tname = qualified.split("__", 1)
        srv = self.servers.get(sname)
        if not srv or not srv.connected:
            return {"blocked": True, "reason": f"server '{sname}' not connected"}
        try:
            return await srv.call_tool(tname, args, consent)
        except Exception as e:
            return {"blocked": False, "isError": True, "text": f"MCP error: {e}"}

    async def close_all(self):
        for s in self.servers.values():
            await s.close()
