"""
Nex — local server. Serves the eyes UI + settings page, WebSocket for realtime state,
HTTP for settings, MCP management and optional local voice.

Run:  python -m nex.server   (from repo root)   or   python nex/server.py
"""
from __future__ import annotations
import asyncio
import json
import os
import sys
import webbrowser
from pathlib import Path

from aiohttp import web, WSMsgType

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))

from nex.core.llm import Ollama            # noqa: E402
from nex.core.mcp import MCPManager        # noqa: E402
from nex.core.music import AmazonMusic     # noqa: E402
from nex.core.agent import Nex             # noqa: E402
from nex.core import voice                 # noqa: E402

DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)
SETTINGS_PATH = DATA / "settings.json"
PRESETS = json.loads((ROOT / "presets" / "mcp_presets.json").read_text(encoding="utf-8"))

DEFAULT_SETTINGS = {
    "ollama_host": "http://127.0.0.1:11434",
    "model": "gpt-oss:20b",
    "num_ctx": 16384,
    "temperature": 0.5,
    "wake_word": "nex",
    "voice_enabled": True,
    "tts_engine": "auto",        # auto | browser | piper
    "stt_engine": "auto",        # auto | browser | whisper
    "whisper_model": "base",
    "piper_voice": "",
    "language": "en-US",
    "proactive": True,
    "music_poll": True,
    "theme": "cyan",
    "mcp": {k: {kk: vv for kk, vv in v.items() if kk not in ("label", "notes")} for k, v in PRESETS.items()},
    "port": 7777,
}


def load_settings() -> dict:
    s = json.loads(json.dumps(DEFAULT_SETTINGS))
    if SETTINGS_PATH.exists():
        try:
            s.update(json.loads(SETTINGS_PATH.read_text(encoding="utf-8")))
        except Exception:
            pass
    return s


def save_settings(s: dict):
    SETTINGS_PATH.write_text(json.dumps(s, indent=1), encoding="utf-8")


def expand(cfg: dict) -> dict:
    c = dict(cfg)
    if "command" in c and isinstance(c["command"], str):
        c["command"] = os.path.expandvars(c["command"])
    return c


class App:
    def __init__(self):
        self.settings = load_settings()
        self.clients: set[web.WebSocketResponse] = set()
        self.llm = Ollama(self.settings["ollama_host"], self.settings["model"], self.settings["num_ctx"], self.settings["temperature"])
        self.mcp = MCPManager()
        self.music = AmazonMusic()
        self.nex: Nex | None = None
        self.mcp_logs: list[str] = []

    async def emit(self, event: str, data: dict):
        msg = json.dumps({"event": event, "data": data}, ensure_ascii=False, default=str)
        dead = []
        for ws in self.clients:
            try:
                await ws.send_str(msg)
            except Exception:
                dead.append(ws)
        for d in dead:
            self.clients.discard(d)

    async def start(self):
        self.nex = Nex(self.llm, self.mcp, self.music, self.emit, self.settings)

        async def mcp_log(name, line):
            self.mcp_logs.append(f"[{name}] {line}")
            self.mcp_logs = self.mcp_logs[-300:]
            await self.emit("mcp_log", {"server": name, "line": line})

        self.mcp.on_log = mcp_log
        asyncio.create_task(self.reload_mcp())
        asyncio.create_task(self._music_loop())
        asyncio.create_task(self._delayed_resume())

    async def _delayed_resume(self):
        await asyncio.sleep(3)
        if self.nex:
            await self.nex.resume_if_needed()

    async def reload_mcp(self):
        cfgs = {k: expand(v) for k, v in self.settings.get("mcp", {}).items()}
        await self.mcp.load(cfgs)
        await self.emit("mcp", self.mcp.status())

    async def _music_loop(self):
        while True:
            await asyncio.sleep(4)
            if self.settings.get("music_poll") and self.nex and self.clients:
                await self.nex.music_poll()

    # ---------------- HTTP handlers
    async def ws_handler(self, request):
        ws = web.WebSocketResponse(heartbeat=20)
        await ws.prepare(request)
        self.clients.add(ws)
        assert self.nex
        await ws.send_str(json.dumps({"event": "hello", "data": {
            "state": self.nex.state, "text": self.nex.status_text, "settings": self.public_settings(),
            "plan": self.nex.plan.plan, "memory": self.nex.mem.state, "mcp": self.mcp.status(),
            "history": self.nex.mem.recent_messages()[-20:],
            "voice_backend": {"whisper": voice.whisper_available(), "piper": voice.piper_available()},
        }}, default=str))
        try:
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                try:
                    d = json.loads(msg.data)
                except Exception:
                    continue
                t = d.get("type")
                if t == "user":
                    asyncio.create_task(self.nex.handle_user(d.get("text", ""), d.get("voice", False)))
                elif t == "state":  # UI-driven states (listening/speaking)
                    await self.nex.set_state(d.get("state", "idle"), d.get("text"), d.get("anim"))
                elif t == "plan":
                    await self.nex._plan_control(d.get("cmd", "status"))
                elif t == "music":
                    r = await self.music.command(d.get("action", "toggle"))
                    await self.emit("music", r.get("now") or await self.music.now_playing())
                elif t == "consent":
                    self.nex.playtest_consent = bool(d.get("ok"))
                    self.nex.pending_consent = None
                elif t == "clear":
                    self.nex.mem.clear_conversation()
                    await self.emit("memory", self.nex.mem.state)
                elif t == "note_remove":
                    self.nex.mem.remove_note(int(d.get("idx", -1)))
                    await self.emit("memory", self.nex.mem.state)
        finally:
            self.clients.discard(ws)
        return ws

    def public_settings(self):
        s = dict(self.settings)
        s["presets"] = PRESETS
        return s

    async def get_settings(self, request):
        return web.json_response(self.public_settings())

    async def post_settings(self, request):
        body = await request.json()
        body.pop("presets", None)
        self.settings.update(body)
        save_settings(self.settings)
        self.llm.configure(host=self.settings["ollama_host"], model=self.settings["model"],
                           num_ctx=int(self.settings["num_ctx"]), temperature=float(self.settings["temperature"]))
        if self.nex:
            self.nex.settings = self.settings
        await self.reload_mcp()
        await self.emit("settings", self.public_settings())
        return web.json_response({"ok": True})

    async def ollama_status(self, request):
        return web.json_response(await self.llm.ping())

    async def mcp_status(self, request):
        return web.json_response({"servers": self.mcp.status(), "logs": self.mcp_logs[-80:]})

    async def mcp_reconnect(self, request):
        name = request.match_info.get("name")
        if name in self.mcp.servers:
            await self.mcp.servers[name].close()
        await self.reload_mcp()
        return web.json_response(self.mcp.status())

    async def mcp_test(self, request):
        """Send a harmless read-only probe (Roblox: print workspace child count)."""
        name = request.match_info.get("name")
        srv = self.mcp.servers.get(name)
        if not srv or not srv.connected:
            return web.json_response({"ok": False, "error": "not connected"})
        tool = "run_code" if any(t["name"] == "run_code" for t in srv.tools) else (srv.tools[0]["name"] if srv.tools else None)
        if not tool:
            return web.json_response({"ok": False, "error": "no tools"})
        args = {"command": "print('Nex connected. Workspace children: '..#workspace:GetChildren())"} if tool == "run_code" else {}
        r = await srv.call_tool(tool, args)
        return web.json_response({"ok": not r.get("isError"), "result": r})

    async def stt(self, request):
        data = await request.read()
        text = await voice.transcribe(data, self.settings.get("whisper_model", "base"),
                                      (self.settings.get("language") or "en-US").split("-")[0])
        return web.json_response({"text": text})

    async def tts(self, request):
        body = await request.json()
        wav = await voice.synthesize(body.get("text", ""), self.settings.get("piper_voice", ""))
        if not wav:
            return web.json_response({"ok": False}, status=404)
        return web.Response(body=wav, content_type="audio/wav")

    async def music_now(self, request):
        return web.json_response(await self.music.now_playing())

    async def index(self, request):
        return web.FileResponse(ROOT / "web" / "index.html")

    async def settings_page(self, request):
        return web.FileResponse(ROOT / "web" / "settings.html")


def main():
    app_state = App()
    app = web.Application(client_max_size=50 * 1024 * 1024)
    app.router.add_get("/", app_state.index)
    app.router.add_get("/settings", app_state.settings_page)
    app.router.add_get("/ws", app_state.ws_handler)
    app.router.add_get("/api/settings", app_state.get_settings)
    app.router.add_post("/api/settings", app_state.post_settings)
    app.router.add_get("/api/ollama", app_state.ollama_status)
    app.router.add_get("/api/mcp", app_state.mcp_status)
    app.router.add_post("/api/mcp/{name}/reconnect", app_state.mcp_reconnect)
    app.router.add_post("/api/mcp/{name}/test", app_state.mcp_test)
    app.router.add_post("/api/stt", app_state.stt)
    app.router.add_post("/api/tts", app_state.tts)
    app.router.add_get("/api/music", app_state.music_now)
    app.router.add_static("/static", ROOT / "web")

    async def on_startup(_):
        await app_state.start()

    async def on_cleanup(_):
        await app_state.mcp.close_all()

    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    port = int(os.environ.get("NEX_PORT", app_state.settings.get("port", 7777)))
    host = os.environ.get("NEX_HOST", "127.0.0.1")
    print(f"\n  Nex is awake →  http://127.0.0.1:{port}   (settings: /settings)\n")
    if os.environ.get("NEX_NO_BROWSER") is None and host == "127.0.0.1":
        asyncio.get_event_loop().call_later(1.0, lambda: webbrowser.open(f"http://127.0.0.1:{port}"))
    web.run_app(app, host=host, port=port, print=None)


if __name__ == "__main__":
    main()
