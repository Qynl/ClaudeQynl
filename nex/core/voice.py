"""
Optional fully-local voice.
- STT: faster-whisper (if installed) — receives audio blobs from the browser.
- TTS: piper (if installed) — returns WAV bytes.
If neither is installed, the browser's built-in Web Speech API is used instead (zero deps).
"""
from __future__ import annotations
import asyncio
import io
import os
import tempfile
import wave
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"

_whisper = None
_piper = None


def whisper_available() -> bool:
    try:
        import faster_whisper  # noqa
        return True
    except Exception:
        return False


def piper_available() -> bool:
    try:
        import piper  # noqa
        return True
    except Exception:
        return False


async def transcribe(audio_bytes: bytes, model_size: str = "base", language: str | None = None) -> str:
    global _whisper
    if not whisper_available():
        return ""
    from faster_whisper import WhisperModel
    if _whisper is None:
        _whisper = WhisperModel(model_size, device="auto", compute_type="int8")
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
        f.write(audio_bytes)
        path = f.name
    try:
        def run():
            segs, _ = _whisper.transcribe(path, language=language, vad_filter=True)
            return " ".join(s.text for s in segs).strip()
        return await asyncio.get_event_loop().run_in_executor(None, run)
    finally:
        try:
            os.unlink(path)
        except Exception:
            pass


async def synthesize(text: str, voice_path: str = "") -> bytes | None:
    global _piper
    if not piper_available():
        return None
    from piper import PiperVoice
    if _piper is None:
        vp = voice_path or str(next(DATA.glob("*.onnx"), ""))
        if not vp:
            return None
        _piper = PiperVoice.load(vp)

    def run():
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            _piper.synthesize(text, w)
        return buf.getvalue()
    return await asyncio.get_event_loop().run_in_executor(None, run)
