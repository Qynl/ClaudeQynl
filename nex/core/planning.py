"""
Pre-production pipeline (Plan mode).

Instead of one prompt trying to do everything, five specialist subagents run in sequence,
each seeing only what it needs. Output is a Game Design Document (GDD) + a dependency-ordered
task graph that Build mode executes one task at a time.

  1. Designer  – core loop, progression, session flow, monetization, what makes it sellable
  2. Architect – folder/remote/module layout, data schema, systems list, naming (single source of truth)
  3. Art lead  – palette, materials, lighting, UI style, asset list with sizes/positions
  4. QA lead   – acceptance tests per system, exploit risks, edge cases
  5. Producer  – turns all of the above into phases/tasks with dependencies + estimates
  6. Critics   – optimist/pessimist/judge review the PLAN itself; producer revises once if needed
"""
from __future__ import annotations
import json
from typing import Awaitable, Callable
from . import schemas as SCH

DESIGNER = """You are the GAME DESIGNER on a small professional studio. Given a brief, design a COMPLETE game that a player would pay for
on Roblox (or UE5). Return STRICT JSON:
{"title": str, "pitch": str, "genre": str, "target_audience": str, "session_minutes": int,
 "core_loop": [str] (4-7 steps the player repeats), "onboarding": [str] (first 60 seconds),
 "progression": {"short_term": str, "mid_term": str, "long_term": str},
 "systems": [{"name": str, "purpose": str, "player_facing": bool}] (8-16 systems: e.g. Spawn, Movement, Combat, Economy, Shop, Inventory, Quests, Leaderboard, DailyReward, Settings, Tutorial, VFX, Audio, SaveData, AntiExploit),
 "monetization": [{"type": "gamepass"|"devproduct", "name": str, "effect": str}],
 "retention_hooks": [str], "win_condition": str, "risks": [str]}"""

ARCHITECT = """You are the TECHNICAL ARCHITECT. Given the design, define the technical layout. It becomes the single source of truth every
builder must follow. Return STRICT JSON:
{"engine": "roblox"|"unreal",
 "folders": {"map": str, "remotes": str, "modules": str, "templates": str, "server_scripts": str, "client_scripts": str, "gui": str},
 "remotes": [{"name": str, "type": "RemoteEvent"|"RemoteFunction", "direction": "client->server"|"server->client", "payload": str}],
 "modules": [{"name": str, "location": str, "api": [str]}],
 "data_schema": {"key": str, "fields": {str: str}},
 "config_attributes": {str: str} (tunable numbers stored as Attributes on a Config folder),
 "systems_impl": [{"system": str, "script": str, "kind": "Script"|"LocalScript"|"ModuleScript", "location": str, "depends_on": [str], "summary": str}],
 "anti_exploit": [str], "performance_notes": [str]}
Rules: server-authoritative; validate every remote; DataStore with pcall+retry+BindToClose; idempotent creation."""

ART = """You are the ART DIRECTOR. Given design + architecture, define a consistent look that can be built with primitive parts,
materials, lighting and UI (no external assets required). Return STRICT JSON:
{"palette": {str: "R,G,B"} (6-8 named colors), "materials": [str], "lighting": {"technology": str, "clock_time": number, "ambient": str, "effects": [str]},
 "ui_style": {"font": str, "corner_radius": int, "stroke": str, "accent": str, "animation": str},
 "assets": [{"name": str, "kind": "zone"|"prop"|"structure"|"pickup"|"npc"|"vfx", "location": str, "approx_size": str, "position_hint": str, "material": str, "color": str, "notes": str}] (14-30 assets),
 "vfx": [{"name": str, "trigger": str, "impl": str}], "audio_hooks": [{"name": str, "trigger": str}]}"""

QA = """You are the QA LEAD. Given design + architecture, write acceptance tests and risks. Return STRICT JSON:
{"acceptance": [{"system": str, "tests": [str] (read-only Luau checks or observable facts)}],
 "exploit_risks": [str], "edge_cases": [str], "playtest_script": [str] (what the human should do when pressing Play)}"""

PRODUCER = """You are the PRODUCER. Turn the design docs into a dependency-ordered production plan. Return STRICT JSON:
{"phases": [{"name": str, "goal": str, "tasks": [
   {"id": "p1t1", "title": str, "kind": "asset"|"script"|"ui"|"animation"|"data"|"polish"|"review",
    "detail": str (exact object/script names from the architecture, sizes/positions from art, what code must do),
    "acceptance": str (from QA: a concrete read-only check), "depends_on": [task ids], "est_calls": int}]}]}
Rules: phases in order foundation → map/assets → core systems → player systems/data → UI/onboarding → anim/VFX/audio → economy/monetization → polish/anti-exploit → release review.
28-50 tasks, each 1-3 tool calls, names EXACTLY as in architecture and art docs. Last phase: review tasks that read the whole game and fix inconsistencies."""

PLAN_CRITIC_OPT = """You are the OPTIMIST plan reviewer. Given the GDD and plan, say what is strong and complete. JSON: {"score":0-10,"strengths":[str]}"""
PLAN_CRITIC_PES = """You are the PESSIMIST plan reviewer, a veteran producer. Find missing systems a paying player expects, tasks that are too big,
naming inconsistencies between docs, unverifiable acceptance criteria, and ordering problems. JSON: {"score":0-10,"problems":[str],"must_fix":[str]}"""
PLAN_JUDGE = """You are the PLAN JUDGE. Decide: {"verdict":"approve"|"revise","instructions":str} — revise only for real must_fix items."""
PRODUCER_REVISE = """You are the PRODUCER. Revise the plan per the judge's instructions. Return the same JSON shape as before (full plan)."""


class PrePro:
    def __init__(self, llm, on_stage: Callable[[str, str], Awaitable[None]]):
        self.llm = llm
        self.on_stage = on_stage

    async def run(self, brief: str, notes: str, engines: list[str]) -> dict:
        eng = "roblox" if not engines or any("roblox" in e for e in engines) else "unreal"
        await self.on_stage("design", "Designer: core loop & systems")
        design = await self.llm.json(DESIGNER, f"BRIEF: {brief}\nENGINE: {eng}\nUSER NOTES: {notes}", 0.5, schema=SCH.DESIGN, num_predict=1800, effort="deep")
        await self.on_stage("tech", "Architect: layout, remotes, data")
        arch = await self.llm.json(ARCHITECT, f"ENGINE: {eng}\nDESIGN: {json.dumps(design)[:6000]}", 0.2, schema=SCH.ARCH, num_predict=2200, effort="deep")
        await self.on_stage("art", "Art director: palette, assets, UI")
        art = await self.llm.json(ART, f"DESIGN: {json.dumps(design)[:3500]}\nARCH: {json.dumps(arch)[:3000]}", 0.5, schema=SCH.ART, num_predict=2200)
        await self.on_stage("qa", "QA lead: acceptance tests")
        qa = await self.llm.json(QA, f"DESIGN: {json.dumps(design)[:3500]}\nARCH: {json.dumps(arch)[:3500]}", 0.2, schema=SCH.QA, num_predict=1500)
        await self.on_stage("produce", "Producer: task graph")
        docs = f"DESIGN: {json.dumps(design)[:3500]}\nARCH: {json.dumps(arch)[:4000]}\nART: {json.dumps(art)[:3000]}\nQA: {json.dumps(qa)[:2500]}"
        plan = await self.llm.json(PRODUCER, docs, 0.25, schema=SCH.PLAN, num_predict=6000, effort="deep")
        await self.on_stage("review", "Reviewing the plan")
        import asyncio
        opt, pes = await asyncio.gather(self.llm.json(PLAN_CRITIC_OPT, f"{docs[:4000]}\nPLAN: {json.dumps(plan)[:5000]}", 0.3, schema=SCH.PLAN_OPT, num_predict=400, effort="fast"),
                                        self.llm.json(PLAN_CRITIC_PES, f"{docs[:4000]}\nPLAN: {json.dumps(plan)[:5000]}", 0.3, schema=SCH.PLAN_PES, num_predict=600, effort="fast"))
        judge = await self.llm.json(PLAN_JUDGE, f"OPTIMIST: {json.dumps(opt)}\nPESSIMIST: {json.dumps(pes)}", 0.1, schema=SCH.PLAN_JUDGE, num_predict=300, effort="fast")
        if judge.get("verdict") == "revise" and judge.get("instructions"):
            await self.on_stage("revise", "Producer: revising plan")
            plan2 = await self.llm.json(PRODUCER_REVISE, f"{docs[:5000]}\nPLAN: {json.dumps(plan)[:6000]}\nJUDGE: {judge['instructions']}", 0.2, schema=SCH.PLAN, num_predict=6000, effort="deep")
            if plan2.get("phases"):
                plan = plan2
        phases = plan.get("phases") or []
        for pi, ph in enumerate(phases):
            for ti, t in enumerate(ph.get("tasks", [])):
                t.setdefault("id", f"p{pi+1}t{ti+1}")
                t["status"] = "todo"
        return {
            "meta": {"title": design.get("title"), "pitch": design.get("pitch"), "engine": eng,
                     "core_loop": design.get("core_loop"), "monetization": design.get("monetization"),
                     "style": {"palette": art.get("palette"), "materials": art.get("materials"), "ui": art.get("ui_style"), "lighting": art.get("lighting")},
                     "naming": {"folders": arch.get("folders"), "remotes": [r.get("name") for r in arch.get("remotes", []) if isinstance(r, dict)],
                                "modules": [m.get("name") for m in arch.get("modules", []) if isinstance(m, dict)], "scripts": [s.get("script") for s in arch.get("systems_impl", []) if isinstance(s, dict)]}},
            "gdd": {"design": design, "architecture": arch, "art": art, "qa": qa, "plan_review": {"optimist": opt, "pessimist": pes, "judge": judge}},
            "phases": phases,
        }
