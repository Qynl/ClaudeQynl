"""
Nex Safety Layer
----------------
Hard, non-bypassable rules about what Nex is allowed to do.

Nex has exactly three capability surfaces:
  1. MCP tool calls to *user-configured* MCP servers (Roblox Studio, Unreal Engine, ...)
  2. Amazon Music control via OS media keys / window focus (NO API, no account access)
  3. Its own memory/plan files inside nex/data/ (its "brain"), nothing else on disk.

Everything else (arbitrary shell, arbitrary file reads/writes, network requests,
launching programs, Roblox playtest, ...) is *not implemented* — there is no code
path for it, so the model cannot "convince" the agent to do it.

Additionally, MCP tool calls are filtered through a policy so that the model
cannot use even an MCP server to escape (e.g. run_code that touches the OS).
"""
from __future__ import annotations
import re
from dataclasses import dataclass, field
from typing import Any

# Tool names (any server) that are always forbidden, even if the server offers them.
FORBIDDEN_TOOL_PATTERNS = [
    r".*shell.*", r".*terminal.*", r".*exec(ute)?_?(command|cmd|sh|bash|powershell).*",
    r".*(read|write|delete|remove|list)_?(file|dir|directory|folder).*",
    r".*filesystem.*", r".*process.*", r".*registry.*", r".*download.*", r".*http_?request.*",
    r".*fetch_?url.*", r".*open_?(url|browser|app|application).*", r".*launch.*",
]

# Substrings in Luau/Python/C++ payloads we never send to run_code style tools.
# Roblox Studio plugins can't touch the OS anyway, but this is defence in depth.
FORBIDDEN_CODE_SNIPPETS = [
    "os.execute", "io.popen", "io.open", "require(\"os\")", "subprocess", "System.Diagnostics",
    "HttpService", "HttpRbxApiService", "MarketplaceService:PromptPurchase", "MessagingService",
    "game:Shutdown", "plugin:", "StudioService", "ScriptEditorService",  # keep Nex out of studio internals
    "unreal.SystemLibrary.execute_console_command", "os.system", "shutil.", "open(",
    "PlaytestService", "RunService:Run", "StartPlay", "PIE",  # NO self-started playtests
]

# Tools that count as "starts a playtest / runs the game" -> require explicit user consent every time.
PLAYTEST_TOOL_PATTERNS = [r".*play.*test.*", r".*start_?play.*", r".*run_?game.*", r".*simulate.*", r".*pie.*"]

# Tools that are allowed on the official Roblox Studio MCP server
ROBLOX_OFFICIAL_TOOLS = {"run_code", "insert_model"}


@dataclass
class SafetyVerdict:
    allowed: bool
    reason: str = ""
    needs_user_consent: bool = False
    sanitized_args: dict = field(default_factory=dict)


def _matches(name: str, patterns: list[str]) -> bool:
    n = name.lower()
    return any(re.fullmatch(p, n) for p in patterns)


def check_tool_call(server: str, tool: str, args: dict[str, Any], user_consented_playtest: bool) -> SafetyVerdict:
    """Return whether this tool call may go out to the MCP server."""
    if _matches(tool, FORBIDDEN_TOOL_PATTERNS):
        return SafetyVerdict(False, f"Tool '{tool}' is on the hard block list (OS/file/network access).")

    if _matches(tool, PLAYTEST_TOOL_PATTERNS) and not user_consented_playtest:
        return SafetyVerdict(False, "Playtests need your explicit OK first.", needs_user_consent=True)

    # Deep-scan any string arguments (code payloads) for escape attempts.
    def scan(v: Any) -> str | None:
        if isinstance(v, str):
            low = v
            for bad in FORBIDDEN_CODE_SNIPPETS:
                if bad in low:
                    return bad
        elif isinstance(v, dict):
            for x in v.values():
                r = scan(x)
                if r:
                    return r
        elif isinstance(v, list):
            for x in v:
                r = scan(x)
                if r:
                    return r
        return None

    hit = scan(args)
    if hit:
        return SafetyVerdict(False, f"Payload contained forbidden snippet '{hit}'.")

    return SafetyVerdict(True, sanitized_args=args)


def sanitize_path_component(name: str) -> str:
    """Nex may only write memory files with plain names inside nex/data."""
    cleaned = re.sub(r"[^a-zA-Z0-9_\-]", "_", name)[:64]
    return cleaned or "unnamed"
