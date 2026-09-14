"""JSON schemas for Ollama structured outputs. Constrained decoding = the model literally cannot emit malformed JSON."""

def _o(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required or list(props.keys())}

S = {"type": "string"}
I = {"type": "integer"}
B = {"type": "boolean"}
SA = {"type": "array", "items": S}

INTENT = _o({
    "intent": {"type": "string", "enum": ["chat", "build_game", "small_task", "music", "plan_control", "memory", "inspect"]},
    "music_action": {"type": ["string", "null"], "enum": ["play", "pause", "next", "previous", "open", "search", "volume_up", "volume_down", "what", None]},
    "music_query": {"type": ["string", "null"]},
    "plan_control": {"type": ["string", "null"], "enum": ["pause", "resume", "stop", "status", None]},
    "game_brief": {"type": ["string", "null"]},
})

OPTIMIST = _o({"score": I, "strengths": SA, "evidence": SA, "verdict": {"type": "string", "enum": ["pass", "fail"]}})
PESSIMIST = _o({"score": I, "problems": SA, "must_fix": SA, "unverified_claims": SA, "verdict": {"type": "string", "enum": ["pass", "fail"]}})
JUDGE = _o({"verdict": {"type": "string", "enum": ["pass", "redo"]}, "reason": S, "fix_instructions": S, "note_for_memory": S})
IDEA = _o({"has_idea": B, "message": S, "task": {"type": ["object", "null"], "properties": {"title": S, "detail": S, "acceptance": S}}}, ["has_idea", "message"])
MEMORY_CMD = _o({"action": {"type": "string", "enum": ["remember", "forget"]}, "fact": S})

TASK = _o({"id": S, "title": S, "kind": {"type": "string", "enum": ["asset", "script", "ui", "animation", "data", "polish", "review"]},
           "detail": S, "acceptance": S, "depends_on": SA, "est_calls": I})
PHASE = _o({"name": S, "goal": S, "tasks": {"type": "array", "items": TASK}})
PLAN = _o({"phases": {"type": "array", "items": PHASE}})

DESIGN = _o({
    "title": S, "pitch": S, "genre": S, "target_audience": S, "session_minutes": I,
    "core_loop": SA, "onboarding": SA,
    "progression": _o({"short_term": S, "mid_term": S, "long_term": S}),
    "systems": {"type": "array", "items": _o({"name": S, "purpose": S, "player_facing": B})},
    "monetization": {"type": "array", "items": _o({"type": {"type": "string", "enum": ["gamepass", "devproduct"]}, "name": S, "effect": S})},
    "retention_hooks": SA, "win_condition": S, "risks": SA,
})
ARCH = _o({
    "engine": {"type": "string", "enum": ["roblox", "unreal"]},
    "folders": _o({"map": S, "remotes": S, "modules": S, "templates": S, "server_scripts": S, "client_scripts": S, "gui": S}),
    "remotes": {"type": "array", "items": _o({"name": S, "type": {"type": "string", "enum": ["RemoteEvent", "RemoteFunction"]}, "direction": S, "payload": S})},
    "modules": {"type": "array", "items": _o({"name": S, "location": S, "api": SA})},
    "data_schema": _o({"key": S, "fields": {"type": "object"}}),
    "config_attributes": {"type": "object"},
    "systems_impl": {"type": "array", "items": _o({"system": S, "script": S, "kind": {"type": "string", "enum": ["Script", "LocalScript", "ModuleScript"]}, "location": S, "depends_on": SA, "summary": S})},
    "anti_exploit": SA, "performance_notes": SA,
})
ART = _o({
    "palette": {"type": "object"}, "materials": SA,
    "lighting": _o({"technology": S, "clock_time": {"type": "number"}, "ambient": S, "effects": SA}),
    "ui_style": _o({"font": S, "corner_radius": I, "stroke": S, "accent": S, "animation": S}),
    "assets": {"type": "array", "items": _o({"name": S, "kind": S, "location": S, "approx_size": S, "position_hint": S, "material": S, "color": S, "notes": S})},
    "vfx": {"type": "array", "items": _o({"name": S, "trigger": S, "impl": S})},
    "audio_hooks": {"type": "array", "items": _o({"name": S, "trigger": S})},
})
QA = _o({"acceptance": {"type": "array", "items": _o({"system": S, "tests": SA})}, "exploit_risks": SA, "edge_cases": SA, "playtest_script": SA})
PLAN_OPT = _o({"score": I, "strengths": SA})
PLAN_PES = _o({"score": I, "problems": SA, "must_fix": SA})
PLAN_JUDGE = _o({"verdict": {"type": "string", "enum": ["approve", "revise"]}, "instructions": S})

PESSIMIST_LITE = _o({"score": I, "problems": SA, "must_fix": SA, "verdict": {"type": "string", "enum": ["pass", "fail"]}})
SLICE_REVIEW = _o({"greenlight": B, "score": I, "what_works": SA, "must_change_before_scaling": SA,
                   "extra_tasks": {"type": "array", "items": _o({"title": S, "kind": S, "detail": S, "acceptance": S})}})
