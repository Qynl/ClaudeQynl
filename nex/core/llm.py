"""
Ollama client tuned for a single consumer GPU (e.g. RX 9060 XT 16 GB) running gpt-oss:20b.

Speed levers used here:
- keep_alive=-1          model stays resident; no reload between calls
- num_gpu=999            force every layer onto the GPU (gpt-oss:20b MXFP4 ≈ 12.5 GB — fits 16 GB with 8k ctx)
- stable prefix          system prompt identical across calls -> Ollama reuses the KV cache for the prefix
- num_predict caps       small JSON answers can't ramble
- reasoning 'low'        gpt-oss thinking effort; 'medium' only for planning/builder
- parallel requests only when they are cheap (reviewers) — a single GPU serialises anyway
- tiny in-memory cache   identical intent/critic prompts within a session are not recomputed
"""
from __future__ import annotations
import asyncio
import hashlib
import json
import time
from typing import Any, AsyncIterator

import aiohttp

# Ollama's gpt-oss models accept "think": "low" | "medium" | "high"
EFFORT = {"fast": "low", "normal": "low", "deep": "medium"}


class Ollama:
    def __init__(self, host: str = "http://127.0.0.1:11434", model: str = "gpt-oss:20b",
                 num_ctx: int = 8192, temperature: float = 0.3):
        self.host = host.rstrip("/")
        self.model = model
        self.num_ctx = num_ctx
        self.temperature = temperature
        self.keep_alive = -1
        self.num_gpu = 999
        self.think_default = "low"
        self._session: aiohttp.ClientSession | None = None
        self._cache: dict[str, tuple[float, dict]] = {}
        self._lock = asyncio.Semaphore(2)     # never queue more than 2 requests at the GPU
        self.stats = {"calls": 0, "prompt_tokens": 0, "eval_tokens": 0, "seconds": 0.0, "cache_hits": 0}

    def configure(self, **kw):
        for k, v in kw.items():
            if v is not None and hasattr(self, k):
                setattr(self, k, v)
        self.host = self.host.rstrip("/")

    async def _s(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=900))
        return self._session

    async def ping(self) -> dict:
        try:
            s = await self._s()
            async with s.get(f"{self.host}/api/tags", timeout=aiohttp.ClientTimeout(total=3)) as r:
                data = await r.json()
            names = [m["name"] for m in data.get("models", [])]
            loaded = []
            try:
                async with s.get(f"{self.host}/api/ps", timeout=aiohttp.ClientTimeout(total=3)) as r:
                    ps = await r.json()
                loaded = [{"name": m["name"], "vram": m.get("size_vram", 0), "size": m.get("size", 0)} for m in ps.get("models", [])]
            except Exception:
                pass
            return {"ok": True, "models": names, "has_model": any(n.split(":")[0] == self.model.split(":")[0] for n in names),
                    "loaded": loaded, "stats": self.stats}
        except Exception as e:  # noqa
            return {"ok": False, "error": str(e), "models": [], "stats": self.stats}

    async def warmup(self):
        """Load the model onto the GPU right at startup so the first real request is fast."""
        try:
            s = await self._s()
            await s.post(f"{self.host}/api/generate", json={"model": self.model, "keep_alive": self.keep_alive,
                                                            "options": {"num_ctx": self.num_ctx, "num_gpu": self.num_gpu}})
        except Exception:
            pass

    def _options(self, temperature: float | None, num_predict: int | None) -> dict:
        o = {"num_ctx": self.num_ctx, "temperature": self.temperature if temperature is None else temperature,
             "num_gpu": self.num_gpu, "repeat_penalty": 1.05, "top_p": 0.9}
        if num_predict:
            o["num_predict"] = num_predict
        return o

    async def chat(self, messages: list[dict], tools: list[dict] | None = None, json_mode: bool = False,
                   temperature: float | None = None, num_predict: int | None = None, effort: str = "normal",
                   schema: dict | None = None, cache: bool = False) -> dict:
        payload: dict[str, Any] = {"model": self.model, "messages": messages, "stream": False,
                                   "keep_alive": self.keep_alive, "options": self._options(temperature, num_predict),
                                   "think": EFFORT.get(effort, self.think_default)}
        if tools:
            payload["tools"] = tools
        if schema:
            payload["format"] = schema          # structured outputs: grammar-constrained JSON
        elif json_mode:
            payload["format"] = "json"
        key = None
        if cache:
            key = hashlib.sha1(json.dumps(payload, sort_keys=True).encode()).hexdigest()
            hit = self._cache.get(key)
            if hit and time.time() - hit[0] < 600:
                self.stats["cache_hits"] += 1
                return hit[1]
        t0 = time.time()
        async with self._lock:
            s = await self._s()
            async with s.post(f"{self.host}/api/chat", json=payload) as r:
                if r.status != 200:
                    txt = await r.text()
                    # older Ollama without 'think' support -> retry without it
                    if "think" in txt.lower() and "think" in payload:
                        payload.pop("think")
                        async with s.post(f"{self.host}/api/chat", json=payload) as r2:
                            if r2.status != 200:
                                raise RuntimeError(f"Ollama error {r2.status}: {await r2.text()}")
                            data = await r2.json()
                    else:
                        raise RuntimeError(f"Ollama error {r.status}: {txt}")
                else:
                    data = await r.json()
        self.stats["calls"] += 1
        self.stats["prompt_tokens"] += data.get("prompt_eval_count", 0)
        self.stats["eval_tokens"] += data.get("eval_count", 0)
        self.stats["seconds"] += time.time() - t0
        msg = data.get("message", {})
        out = {"content": msg.get("content", "") or "", "tool_calls": msg.get("tool_calls", []) or [],
               "thinking": msg.get("thinking", "") or "",
               "tps": (data.get("eval_count", 0) / max(1e-6, data.get("eval_duration", 1) / 1e9))}
        if key:
            self._cache[key] = (time.time(), out)
        return out

    async def stream(self, messages: list[dict], temperature: float | None = None) -> AsyncIterator[str]:
        payload = {"model": self.model, "messages": messages, "stream": True, "keep_alive": self.keep_alive,
                   "options": self._options(temperature, 400), "think": "low"}
        async with self._lock:
            s = await self._s()
            async with s.post(f"{self.host}/api/chat", json=payload) as r:
                if r.status != 200:
                    payload.pop("think")
                    r = await s.post(f"{self.host}/api/chat", json=payload)
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

    async def json(self, system: str, user: str, temperature: float = 0.2, schema: dict | None = None,
                   num_predict: int = 1500, effort: str = "normal", cache: bool = False) -> dict:
        """Strict JSON answer. With a schema Ollama constrains decoding -> no malformed JSON, no rambling."""
        res = await self.chat([{"role": "system", "content": system}, {"role": "user", "content": user}],
                              json_mode=True, temperature=temperature, num_predict=num_predict, effort=effort,
                              schema=schema, cache=cache)
        return parse_json_loose(res["content"])

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()


def parse_json_loose(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    try:
        v = json.loads(text)
        return v if isinstance(v, dict) else {"_raw": v}
    except Exception:
        pass
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        try:
            v = json.loads(text[start:end + 1])
            return v if isinstance(v, dict) else {"_raw": v}
        except Exception:
            pass
    return {"_raw": text}
