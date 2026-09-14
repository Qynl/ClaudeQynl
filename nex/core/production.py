"""
Production-quality workflow pieces used by the build loop.

Why a 20b model produces grey-box games: it treats every task as "make it exist". A studio treats
every task as "make it exist, look right, feel right, and not break anything else". This module adds
the missing gates without any code library — the model still writes everything itself.

  VERTICAL SLICE   phases are re-ordered so that a tiny, fully polished slice of the core loop is built
                   and reviewed FIRST (map chunk + core mechanic + feedback + HUD). Only if that slice
                   passes the fun/art/tech lenses does the plan scale out. Fixes "70% done, nothing fun".
  LENSES           per-task review runs three specialised lenses instead of generic critics:
                   ART (would a screenshot look like a real game?), FEEL (juice, feedback, readability),
                   TECH (server-authority, errors, idempotency). Tasks of kind 'asset' skip TECH, 'script' skips ART.
  PHASE GATE       after each phase, one integration test is run in Studio: a read-only probe that walks
                   the whole place and lists every Script/RemoteEvent/Folder the architecture promised.
                   Missing items become new tasks automatically.
  POLISH PASSES    after all phases: a lighting/post-FX pass, a UI-consistency pass, a sound-hook pass,
                   a balance pass, and a final "screenshot" critique — each is a normal task with a lens.
  STALL DETECTION  if three consecutive tasks are skipped, or the ledger doesn't grow for N tasks,
                   the loop pauses and asks the user rather than burning GPU time.
"""
from __future__ import annotations
import json

# ---------------- review lenses ----------------
LENS_ART = """You are the ART LENS — a senior environment/UI artist. Judge only visual quality from the tool output and code:
palette consistency (from STYLE), material variety, no default grey Plastic, proper scale, lighting/atmosphere use, UI with UICorner/UIStroke/padding,
readable contrast, no z-fighting/overlaps, decoration density (props, trims, lights), silhouettes. A paying player judges by screenshot.
Return JSON: {"score":0-10,"problems":[str],"must_fix":[str],"verdict":"pass"|"fail"}"""
LENS_FEEL = """You are the FEEL LENS — a senior game designer. Judge only game feel and clarity: does the player get immediate feedback (tween, sound hook,
particle, UI pop) on every action? Are numbers tuned sensibly (speeds, prices, timers)? Is the goal obvious in 10 seconds? Is there juice (screen shake hooks,
scale pops, color flashes)? Any dead time? Return JSON: {"score":0-10,"problems":[str],"must_fix":[str],"verdict":"pass"|"fail"}"""
LENS_TECH = """You are the TECH LENS — a senior Roblox engineer. Judge only correctness: server authority, remote validation, pcall around DataStore,
no memory leaks (connections cleaned up on PlayerRemoving), idempotent creation, correct Script vs LocalScript placement, no deprecated APIs,
actual evidence in tool output (NEX_OK + NEX_VERIFY facts). Return JSON: {"score":0-10,"problems":[str],"must_fix":[str],"verdict":"pass"|"fail"}"""
LENS_JUDGE = """You are the JUDGE. Combine the lens reviews. Pass only if no lens has a real must_fix AND tool output proves the work.
Return JSON: {"verdict":"pass"|"redo","reason":str,"fix_instructions":str,"note_for_memory":str}"""

LENSES_BY_KIND = {
    "asset": ["art", "feel"], "ui": ["art", "feel", "tech"], "script": ["tech", "feel"], "data": ["tech"],
    "animation": ["feel", "art"], "polish": ["art", "feel"], "review": ["tech", "art", "feel"], "small": ["tech"],
}
LENS_PROMPT = {"art": LENS_ART, "feel": LENS_FEEL, "tech": LENS_TECH}

# ---------------- vertical slice ----------------
SLICE_PLANNER = """You are the PRODUCER creating the VERTICAL SLICE: the smallest fully polished piece of this game that proves it is fun and looks right.
It must contain: one small area of the map with real materials/lighting/decoration, the core mechanic working end-to-end, immediate feedback (tween + sound hook + UI pop),
a minimal HUD, spawn, and one progression tick (e.g. earn 1 coin and see it). No data saving, no shop yet.
Return STRICT JSON: {"phases":[{"name":"Vertical slice","goal":str,"tasks":[{"id":"s1","title":str,"kind":"asset"|"script"|"ui"|"animation"|"polish","detail":str,"acceptance":str,"depends_on":[],"est_calls":2}]}]}
6-10 tasks, very concrete, names EXACTLY from the architecture/art docs."""

SLICE_REVIEW = """You are the CREATIVE DIRECTOR reviewing the finished VERTICAL SLICE. From the ledger, task reports and the place snapshot decide whether this
game is worth scaling out. Consider: is the core loop fun on paper AND implemented with feedback? Does the snapshot show real materials/lighting/UI, not grey parts?
Return JSON: {"greenlight":bool,"score":0-10,"what_works":[str],"must_change_before_scaling":[str],"extra_tasks":[{"title":str,"kind":str,"detail":str,"acceptance":str}]}"""

# ---------------- phase gate ----------------
def phase_gate_probe(arch: dict) -> str:
    """Read-only Luau that checks every promised remote/module/script/folder exists. Zero LLM."""
    folders = arch.get("folders", {}) or {}
    remotes = [r.get("name") for r in arch.get("remotes", []) if isinstance(r, dict) and r.get("name")]
    modules = [m.get("name") for m in arch.get("modules", []) if isinstance(m, dict) and m.get("name")]
    scripts = [s.get("script") for s in arch.get("systems_impl", []) if isinstance(s, dict) and s.get("script")]
    return f"""print("NEX_VERIFY phase gate")
local missing = {{}}
local function find(name) for _, root in ipairs({{workspace, game.ReplicatedStorage, game.ServerScriptService, game.ServerStorage, game.StarterGui, game.StarterPlayer, game.Lighting}}) do
  local f = root:FindFirstChild(name, true); if f then return f end end return nil end
for _, n in ipairs({json.dumps(list(folders.values()))}) do if not find(n) then table.insert(missing, "Folder " .. n) end end
for _, n in ipairs({json.dumps(remotes)}) do if not find(n) then table.insert(missing, "Remote " .. n) end end
for _, n in ipairs({json.dumps(modules)}) do if not find(n) then table.insert(missing, "Module " .. n) end end
for _, n in ipairs({json.dumps(scripts)}) do local s = find(n); if not s then table.insert(missing, "Script " .. n) elseif s:IsA("LuaSourceContainer") and #s.Source < 120 then table.insert(missing, "Script too short " .. n) end end
local parts, grey = 0, 0
for _, d in ipairs(workspace:GetDescendants()) do if d:IsA("BasePart") and not d:IsA("Terrain") then parts += 1; if d.Material == Enum.Material.Plastic and d.Color == Color3.fromRGB(163,162,165) then grey += 1 end end end
print("PARTS", parts, "DEFAULT_GREY", grey, "LIGHTING", game.Lighting.Technology.Name, "ATMOSPHERE", game.Lighting:FindFirstChildOfClass("Atmosphere") ~= nil)
print("MISSING", #missing == 0 and "none" or table.concat(missing, "; "))"""


def parse_gate(output: str) -> dict:
    res = {"missing": [], "parts": 0, "grey": 0, "atmosphere": False}
    for line in output.splitlines():
        if line.startswith("MISSING"):
            body = line[len("MISSING"):].strip()
            res["missing"] = [] if body == "none" else [x.strip() for x in body.split(";") if x.strip()]
        elif line.startswith("PARTS"):
            toks = line.split()
            try:
                res["parts"] = int(toks[1]); res["grey"] = int(toks[3]); res["atmosphere"] = toks[-1] == "true"
            except Exception:
                pass
    return res


# ---------------- polish passes appended after the last phase ----------------
POLISH_PHASE = {
    "name": "Polish & release quality", "goal": "Make it look and feel like a finished commercial game.",
    "tasks": [
        {"id": "pol1", "kind": "polish", "title": "Lighting & atmosphere pass",
         "detail": "Set Lighting.Technology to Future or ShadowMap, ClockTime/ambient per STYLE, add Atmosphere (density/haze/color), Bloom (small), ColorCorrection (slight contrast/saturation), SunRays if outdoors. Add PointLights/SpotLights on key props. Replace any remaining default grey Plastic parts with STYLE materials.",
         "acceptance": "Read-only check prints Lighting.Technology, Atmosphere present, count of default-grey parts == 0."},
        {"id": "pol2", "kind": "ui", "title": "UI consistency pass",
         "detail": "Every ScreenGui: same font, UICorner radius, UIStroke, padding, accent colour from STYLE; buttons tween on hover/press; HUD anchored with AnchorPoint and Scale sizes (no Offset-only); text uses TextScaled with UITextSizeConstraint.",
         "acceptance": "Read-only check lists each ScreenGui and confirms UICorner+UIStroke present under each top-level Frame."},
        {"id": "pol3", "kind": "animation", "title": "Juice pass",
         "detail": "Add TweenService feedback to every player action: pickup scale pop + fade, purchase button bounce, damage flash (Highlight), coin count number tween, spawn fade-in. Add ParticleEmitter bursts on key events (pickups, level up).",
         "acceptance": "Read-only check finds at least 4 tween/particle usages across scripts (search Source for TweenService and ParticleEmitter)."},
        {"id": "pol4", "kind": "script", "title": "Sound hook pass",
         "detail": "Create SoundService/SFX folder with named Sound objects (SoundId left empty, Name describes it: 'Pickup','Purchase','Error','LevelUp','Ambient') and a ModuleScript SFX with play(name, parent) that clones and plays; call it from all key events. Add an ambient Sound looped in Workspace.",
         "acceptance": "Read-only check prints SFX module and the named Sound objects, and finds >= 4 require(SFX) usages."},
        {"id": "pol5", "kind": "script", "title": "Balance & anti-exploit pass",
         "detail": "Move every tunable (prices, speeds, timers, rewards) into Config attributes; add server-side rate limits on remotes (per-player debounce), sanity-check all client inputs, clamp values. Ensure connections are disconnected on PlayerRemoving.",
         "acceptance": "Read-only check prints Config attributes list and confirms every RemoteEvent handler references a debounce table."},
        {"id": "pol6", "kind": "review", "title": "Screenshot critique",
         "detail": "Read-only: print a description of what the spawn area looks like (materials, colours, lights, props within 60 studs of SpawnLocation) and what the HUD contains. Then fix the three ugliest things you find.",
         "acceptance": "Report lists the three fixes with names."},
        {"id": "pol7", "kind": "review", "title": "Onboarding walkthrough",
         "detail": "Read-only: simulate a new player's first 60 seconds using the QA playtest script; check each step has UI guidance (tutorial label / arrow / objective text). Add missing guidance.",
         "acceptance": "Report maps each playtest step to the UI element that guides it."},
    ],
}

RELEASE_REPORT = """You are the RELEASE MANAGER. Given the GDD, plan status, ledger and the last phase gate, write a spoken release note (4-6 sentences):
what the game is, what was built and verified, what was skipped, and the top three things to check when pressing Play. Plain text."""
