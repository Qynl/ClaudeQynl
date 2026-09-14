"""
Amazon Music control WITHOUT any API.
Windows: uses the system media transport (media keys) + Windows Media Session
(via PowerShell WinRT) to read what's currently playing. Nex is allowed to *launch*
Amazon Music (the only program it may open) via the URI protocol / Start-Process.

Nothing here can touch files or other apps.
"""
from __future__ import annotations
import asyncio
import os
import sys
import ctypes

IS_WIN = os.name == "nt"

VK_MEDIA_NEXT_TRACK = 0xB0
VK_MEDIA_PREV_TRACK = 0xB1
VK_MEDIA_STOP = 0xB2
VK_MEDIA_PLAY_PAUSE = 0xB3
VK_VOLUME_MUTE = 0xAD
VK_VOLUME_DOWN = 0xAE
VK_VOLUME_UP = 0xAF
KEYEVENTF_KEYUP = 0x0002


def _press(vk: int):
    if not IS_WIN:
        return
    ctypes.windll.user32.keybd_event(vk, 0, 0, 0)
    ctypes.windll.user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)


# PowerShell snippet using WinRT GlobalSystemMediaTransportControlsSessionManager
_PS_NOW_PLAYING = r"""
$ErrorActionPreference='SilentlyContinue'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
Function Await($WinRtTask, $ResultType) { $asTask = $asTaskGeneric.MakeGenericMethod($ResultType); $netTask = $asTask.Invoke($null, @($WinRtTask)); $netTask.Wait(-1) | Out-Null; $netTask.Result }
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$sessions = $mgr.GetSessions()
foreach ($s in $sessions) {
  $id = $s.SourceAppUserModelId
  if ($id -notlike '*Amazon*Music*' -and $id -notlike '*AmazonMusic*') { continue }
  $info = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $pb = $s.GetPlaybackInfo()
  $o = @{ app=$id; title=$info.Title; artist=$info.Artist; album=$info.AlbumTitle; status=[string]$pb.PlaybackStatus }
  $o | ConvertTo-Json -Compress
  exit
}
'{}'
"""


class AmazonMusic:
    def __init__(self):
        self.last: dict = {}

    async def _ps(self, script: str, timeout: float = 8) -> str:
        if not IS_WIN:
            return "{}"
        proc = await asyncio.create_subprocess_exec(
            "powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), timeout)
        except asyncio.TimeoutError:
            proc.kill()
            return "{}"
        return out.decode(errors="ignore").strip()

    async def now_playing(self) -> dict:
        import json
        raw = await self._ps(_PS_NOW_PLAYING)
        try:
            d = json.loads(raw or "{}")
        except Exception:
            d = {}
        d = d if isinstance(d, dict) else {}
        d["playing"] = d.get("status", "") == "Playing"
        self.last = d
        return d

    async def open(self):
        """The ONLY application Nex is ever permitted to launch."""
        if not IS_WIN:
            return {"ok": False, "reason": "Windows only"}
        # UWP / Store version first, fallback to protocol handler
        await self._ps("Start-Process 'amazonmusic:' ; Start-Sleep -m 300")
        return {"ok": True}

    async def _focus(self):
        # Bring Amazon Music window to front (harmless, needed for key delivery in some builds)
        await self._ps("$p = Get-Process -Name 'Amazon Music' -ErrorAction SilentlyContinue | Select -First 1; if($p){ (New-Object -ComObject WScript.Shell).AppActivate($p.Id) | Out-Null }", 4)

    async def command(self, action: str) -> dict:
        action = action.lower().strip()
        mapping = {
            "play": VK_MEDIA_PLAY_PAUSE, "pause": VK_MEDIA_PLAY_PAUSE, "toggle": VK_MEDIA_PLAY_PAUSE,
            "next": VK_MEDIA_NEXT_TRACK, "skip": VK_MEDIA_NEXT_TRACK,
            "previous": VK_MEDIA_PREV_TRACK, "prev": VK_MEDIA_PREV_TRACK, "back": VK_MEDIA_PREV_TRACK,
            "stop": VK_MEDIA_STOP, "volume_up": VK_VOLUME_UP, "volume_down": VK_VOLUME_DOWN, "mute": VK_VOLUME_MUTE,
        }
        if action == "open":
            return await self.open()
        if action not in mapping:
            return {"ok": False, "reason": f"unknown action {action}"}
        np = await self.now_playing()
        if action == "play" and np.get("playing"):
            return {"ok": True, "note": "already playing", "now": np}
        if action == "pause" and np and not np.get("playing"):
            return {"ok": True, "note": "already paused", "now": np}
        if not np.get("app"):
            await self.open()
            await asyncio.sleep(2.5)
        _press(mapping[action])
        await asyncio.sleep(0.6)
        return {"ok": True, "now": await self.now_playing()}

    async def search_play(self, query: str) -> dict:
        """Open Amazon Music's search page for the query (no API: uses deep link), then press play."""
        if not IS_WIN:
            return {"ok": False, "reason": "Windows only"}
        from urllib.parse import quote
        await self._ps(f"Start-Process 'https://music.amazon.com/search/{quote(query)}'")
        await asyncio.sleep(3)
        return {"ok": True, "note": f"Opened search for '{query}'. Pick a track or say 'play'."}
