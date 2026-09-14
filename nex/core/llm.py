"""Thin Ollama client (gpt-oss:20b by default). No SDK, plain HTTP."""
from __future__ import annotations
import json
import aiohttp
from typing import AsyncIterator, Any


class Ollama:
    def __init__(self, host: str = "http://127.0.0.1:11434", model: str = "gpt-oss:20b",
                 num_ctx: int = 16384, temperature: float = 0.5):
        self.host = host.rstrip("/")
        self.model = model
        self.num_ctx = num_ctx
        self.temperature = temperature

    def configure(self, **kw):
        for k, v in kw.items():
            if v is not None and hasattr(self, k):
                setattr(self, k, v)
        self.host = self.host.rstrip("/")

    async def ping(self) -> dict:
        try:
            async with aiohttp.ClientSession() as s:
                async with s.get(f"{self.host}/api/tags", timeout=aiohttp.ClientTimeout(total=3)) as r:
                    data = await r.json()
                    names = [m["name"] for m in data.get("models", [])]
                    return {"ok": True, "models": names, "has_model": any(n.startswith(self.model.split(":")[0]) for n in names)}
        except Exception as e:  # noqa
            return {"ok": False, "error": str(e), "models": []}

    async def chat(self, messages: list[dict], tools: list[dict] | None = None,
                   json_mode: bool = False, temperature: float | None = None) -> dict:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {"num_ctx": self.num_ctx, "temperature": self.temperature if temperature is None else temperature},
        }
        if tools:
            payload["tools"] = tools
        if json_mode:
            payload["format"] = "json"
        async with aiohttp.ClientSession() as s:
            async with s.post(f"{self.host}/api/chat", json=payload, timeout=aiohttp.ClientTimeout(total=600)) as r:
                if r.status != 200:
                    raise RuntimeError(f"Ollama error {r.status}: {await r.text()}")
                data = await r.json()
        msg = data.get("message", {})
        return {"content": msg.get("content", "") or "", "tool_calls": msg.get("tool_calls", []) or [],
                "thinking": msg.get("thinking", "") or ""}

    async def stream(self, messages: list[dict], temperature: float | None = None) -> AsyncIterator[str]:
        payload = {"model": self.model, "messages": messages, "stream": True,
                   "options": {"num_ctx": self.num_ctx, "temperature": self.temperature if temperature is None else temperature}}
        async with aiohttp.ClientSession() as s:
            async with s.post(f"{self.host}/api/chat", json=payload, timeout=aiohttp.ClientTimeout(total=600)) as r:
                async for line in r.content:
                    if not line.strip():
                        continue
                    try:
                        d = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    tok = d.get("message", {}).get("content", "")
                    if tok:
                        yield tok
                    if d.get("done"):
                        break

    async def json(self, system: str, user: str, temperature: float = 0.3) -> dict:
        """Ask for a strict JSON answer; tolerant parsing for a 20b model."""
        res = await self.chat([{"role": "system", "content": system}, {"role": "user", "content": user}],
                              json_mode=True, temperature=temperature)
        return parse_json_loose(res["content"])


def parse_json_loose(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    try:
        return json.loads(text)
    except Exception:
        pass
    # find first {...} block
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except Exception:
            pass
    return {"_raw": text}
