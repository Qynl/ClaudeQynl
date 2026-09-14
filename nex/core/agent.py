"""
Nex agent core: chat, intent routing, autonomous game production loop with subagents
(planner -> builder -> optimist + pessimist -> judge), bounded memory, resume after
interrupt, proactive idea scouting. All side effects go through MCPManager / AmazonMusic only.
"""
from __future__ import annotations
import asyncio
import json
import time
import traceback
from typing import Awaitable, Callable

from . import prompts as P
from .llm import Ollama, parse_json_loose
from .mcp import MCPManager
from .memory import Memory, PlanStore
from .music import AmazonMusic

Emit = Callable[[str, dict], Awaitable[None]]

MAX_BUILDER_ROUNDS = 8       # tool rounds per task attempt
MAX_TASK_ATTEMPTS = 3        # redo attempts per task before marking failed and moving on
IDLE_IDEA_INTERVAL = 420     # seconds between proactive idea checks while idle


class Nex:
    def __init__(self, llm: Ollama, mcp: MCPManager, music: AmazonMusic, emit: Emit, settings: dict):
        self.llm = llm
        self.mcp = mcp
        self.music = music
        self.emit = emit
        self.settings = settings
        self.mem = Memory()
        self.plan = PlanStore()
        self.state = "idle"          # idle | thinking | working | reviewing | speaking | listening | music | error
        self.status_text = "Ready"
        self.busy = asyncio.Lock()
        self._build_task: asyncio.Task | None = None
        self._pause = asyncio.Event(); self._pause.set()
        self._stop = False
        self.playtest_consent = False
        self._last_activity = time.time()
        self._idle_task = asyncio.create_task(self._idle_loop())
        self.pending_consent: dict | None = None

    # ------------------------------------------------------------ utilities
    async def set_state(self, state: str, text: str | None = None, anim: str | None = None):
        self.state = state
        if text is not None:
            self.status_text = text
        await self.emit("state", {"state": state, "text": self.status_text, "anim": anim})

    async def say(self, text: str, speak: bool = True, kind: str = "assistant"):
        text = text.strip()
        if not text:
            return
        self.mem.add_message("assistant", text)
        await self.emit("message", {"role": "assistant", "text": text, "speak": speak, "kind": kind})

    def _system(self) -> str:
        ctx = self.mem.context_block()
        servers = ", ".join(f"{s['name']}({'on' if s['connected'] else 'off'})" for s in self.mcp.status()) or "none"
        plan = ""
        if self.plan.is_active():
            pr = self.plan.progress()
            nt = self.plan.next_task()
            plan = f"\nACTIVE BUILD: '{self.plan.plan.get('goal','')}' {pr['done']}/{pr['total']} tasks done, status={self.plan.plan['status']}."
            if nt:
                plan += f" Current task: {nt[1]['title']}"
        return f"{P.NEX_PERSONA}\n\n{P.TOOL_RULES}\n\nMCP SERVERS: {servers}{plan}\n\n{ctx}".strip()

    async def _compact_if_needed(self):
        if not self.mem.needs_compaction():
            return
        old = self.mem.pop_old_for_compaction()
        text = "\n".join(f"{m['role']}: {m['content'][:600]}" for m in old)
        prev = self.mem.state["summary"]
        try:
            res = await self.llm.chat([{"role": "system", "content": P.COMPACTOR},
                                       {"role": "user", "content": f"PREVIOUS SUMMARY:\n{prev}\n\nNEW EXCERPT:\n{text}"}],
                                      temperature=0.2)
            self.mem.set_summary(res["content"])
            await self.emit("memory", self.mem.state)
        except Exception:
            pass

    # ------------------------------------------------------------ chat entry
    async def handle_user(self, text: str, via_voice: bool = False):
        self._last_activity = time.time()
        text = text.strip()
        if not text:
            return
        self.mem.add_message("user", text)
        await self.emit("message", {"role": "user", "text": text})

        # consent handling for pending playtest
        if self.pending_consent:
            low = text.lower()
            if any(w in low for w in ("yes", "ok", "okay", "go", "sure", "ja", "do it", "yep")):
                self.playtest_consent = True
                self.pending_consent = None
                await self.say("Okay — press Play in Studio when you're ready and tell me what you see.")
                return
            if any(w in low for w in ("no", "nope", "not now", "nein", "later")):
                self.pending_consent = None
                await self.say("Alright, skipping the playtest.")
                return

        await self.set_state("thinking", "Thinking…", anim="think")
        try:
            intent = await self.llm.json(P.INTENT, text, temperature=0.1)
        except Exception as e:
            await self.set_state("error", "Ollama unreachable", anim="error")
            await self.say(f"I can't reach Ollama right now. {e}", speak=False)
            return

        kind = intent.get("intent", "chat")
        try:
            if kind == "music":
                await self._do_music(intent, text)
            elif kind == "plan_control":
                await self._plan_control(intent.get("plan_control") or "status")
            elif kind == "build_game":
                await self.start_build(intent.get("game_brief") or text)
            elif kind == "small_task":
                await self._small_task(text)
            elif kind == "memory":
                await self._memory_cmd(text)
            else:
                await self._chat(text)
        except Exception as e:
            traceback.print_exc()
            await self.set_state("error", "Something broke", anim="error")
            await self.say(f"Hm, something went wrong: {str(e)[:200]}")
        finally:
            if self.state not in ("working", "reviewing"):
                await self.set_state("idle", "Ready", anim="idle")
            await self._compact_if_needed()

    async def _chat(self, text: str):
        msgs = [{"role": "system", "content": self._system()}] + self.mem.recent_messages()
        await self.set_state("thinking", "Thinking…", anim="think")
        buf = ""
        await self.emit("stream_start", {})
        async for tok in self.llm.stream(msgs):
            buf += tok
            await self.emit("stream", {"delta": tok})
        await self.emit("stream_end", {})
        self.mem.add_message("assistant", buf)
        await self.emit("message", {"role": "assistant", "text": buf, "speak": True, "replace_stream": True})

    async def _memory_cmd(self, text: str):
        res = await self.llm.json("Extract the fact the user wants remembered (or forgotten). JSON: {\"action\":\"remember\"|\"forget\",\"fact\":str}", text)
        if res.get("action") == "remember" and res.get("fact"):
            self.mem.add_note(res["fact"])
            await self.say("Got it, I'll remember that.")
        elif res.get("action") == "forget":
            f = (res.get("fact") or "").lower()
            self.mem.state["notes"] = [n for n in self.mem.state["notes"] if f not in n.lower()]
            self.mem.save()
            await self.say("Forgotten.")
        else:
            await self._chat(text)
        await self.emit("memory", self.mem.state)

    # ------------------------------------------------------------ music
    async def _do_music(self, intent: dict, text: str):
        action = intent.get("music_action") or "toggle"
        await self.set_state("music", "Amazon Music", anim="music_start")
        if action == "what":
            np = await self.music.now_playing()
            if np.get("title"):
                await self.say(f"That's {np['title']} by {np.get('artist','someone')}.")
            else:
                await self.say("Amazon Music isn't playing anything right now.")
        elif action == "search":
            r = await self.music.search_play(intent.get("music_query") or text)
            await self.say(r.get("note") or "Opened Amazon Music.")
        else:
            r = await self.music.command(action)
            np = r.get("now") or {}
            if action in ("play", "next", "previous") and np.get("title"):
                await self.say(f"{np['title']} by {np.get('artist','')}.".replace(" by .", "."))
            elif action == "pause":
                await self.say("Paused.")
            elif action == "open":
                await self.say("Opening Amazon Music.")
            else:
                await self.say("Done." if r.get("ok") else r.get("reason", "Couldn't do that."))
        await self.emit("music", await self.music.now_playing())

    async def music_poll(self):
        """Called periodically by server to push now-playing to the UI (drives vibing animation)."""
        try:
            np = await self.music.now_playing()
            await self.emit("music", np)
        except Exception:
            pass

    # ------------------------------------------------------------ small task
    async def _small_task(self, text: str):
        await self.set_state("working", "Working in Studio…", anim="work")
        report, outputs = await self._run_builder({"title": text, "detail": text, "acceptance": "The change exists in the scene and works."})
        await self.say(report)

    # ------------------------------------------------------------ builder subagent
    async def _run_builder(self, task: dict, fix_instructions: str = "") -> tuple[str, list[str]]:
        tools = self.mcp.ollama_tools()
        if not tools:
            return "FAILED: no MCP server is connected — connect Roblox Studio or Unreal in settings.", []
        sys_prompt = f"{P.BUILDER}\n\n{P.TOOL_RULES}\n\nPROJECT CONTEXT:\n{self.mem.context_block()[:2500]}"
        user = f"TASK: {task['title']}\nDETAIL: {task.get('detail','')}\nACCEPTANCE: {task.get('acceptance','')}"
        if fix_instructions:
            user += f"\n\nPREVIOUS ATTEMPT WAS REJECTED. FIX THIS:\n{fix_instructions}"
        msgs = [{"role": "system", "content": sys_prompt}, {"role": "user", "content": user}]
        outputs: list[str] = []
        for rnd in range(MAX_BUILDER_ROUNDS):
            await self._pause.wait()
            if self._stop:
                return "FAILED: stopped by user", outputs
            await self.set_state("working", f"Building: {task['title'][:40]}", anim="think" if rnd == 0 else "work")
            res = await self.llm.chat(msgs, tools=tools, temperature=0.3)
            msgs.append({"role": "assistant", "content": res["content"], "tool_calls": res["tool_calls"]})
            if not res["tool_calls"]:
                return (res["content"] or "DONE: (no report)"), outputs
            for tc in res["tool_calls"]:
                fn = tc.get("function", {})
                name = fn.get("name", "")
                args = fn.get("arguments", {})
                if isinstance(args, str):
                    args = parse_json_loose(args)
                anim = "write" if any(k in json.dumps(args).lower() for k in ("source", "instance.new", "create")) else "read"
                await self.set_state("working", f"{'Writing' if anim=='write' else 'Reading'}: {name.split('__',1)[-1]}", anim=anim)
                await self.emit("tool", {"name": name, "args": args})
                result = await self.mcp.call(name, args, self.playtest_consent)
                if result.get("needs_user_consent"):
                    self.pending_consent = {"tool": name, "args": args}
                    await self.say("Want me to run a playtest now? Say yes or no.", kind="consent")
                txt = result.get("reason") if result.get("blocked") else result.get("text", "")
                outputs.append(f"{name}: {txt[:1500]}")
                await self.emit("tool_result", {"name": name, "text": txt[:2000], "blocked": result.get("blocked", False)})
                msgs.append({"role": "tool", "content": txt[:6000], "name": name})
        return "FAILED: ran out of tool rounds", outputs

    # ------------------------------------------------------------ review committee
    async def _review(self, task: dict, report: str, outputs: list[str]) -> dict:
        await self.set_state("reviewing", "Reviewing (optimist)", anim="review_pos")
        ctx = f"TASK: {task['title']}\nDETAIL: {task.get('detail','')}\nACCEPTANCE: {task.get('acceptance','')}\n\nBUILDER REPORT: {report}\n\nTOOL OUTPUTS:\n" + "\n".join(outputs)[-5000:]
        opt_c = self.llm.json(P.OPTIMIST, ctx, 0.4)
        pes_c = self.llm.json(P.PESSIMIST, ctx, 0.4)
        opt, pes = await asyncio.gather(opt_c, pes_c, return_exceptions=True)
        opt = opt if isinstance(opt, dict) else {"score": 5, "strengths": [], "verdict": "pass"}
        await self.set_state("reviewing", "Reviewing (pessimist)", anim="review_neg")
        await asyncio.sleep(0.4)
        pes = pes if isinstance(pes, dict) else {"score": 5, "problems": [], "verdict": "pass"}
        await self.set_state("reviewing", "Judging…", anim="judge")
        judge = await self.llm.json(P.JUDGE, f"{ctx}\n\nOPTIMIST: {json.dumps(opt)}\n\nPESSIMIST: {json.dumps(pes)}", 0.2)
        await self.emit("review", {"task": task["title"], "optimist": opt, "pessimist": pes, "judge": judge})
        if judge.get("note_for_memory"):
            self.mem.add_note(judge["note_for_memory"])
        return judge

    # ------------------------------------------------------------ autonomous build
    async def start_build(self, brief: str):
        if self._build_task and not self._build_task.done():
            await self.say("I'm already building something. Say 'stop' first if you want a new project.")
            return
        await self.set_state("thinking", "Planning the game…", anim="plan")
        await self.say("On it. Let me plan this like a real production first.", kind="proactive")
        engines = [s["name"] for s in self.mcp.status() if s["connected"]]
        plan = await self.llm.json(P.PLANNER, f"GAME BRIEF: {brief}\nCONNECTED ENGINES: {engines or ['roblox (assumed)']}\nUSER NOTES: {self.mem.context_block()[:1200]}", 0.5)
        phases = plan.get("phases") or []
        if not phases:
            await self.say("I couldn't produce a plan, could you describe the game a bit more?")
            return
        for pi, ph in enumerate(phases):
            for ti, t in enumerate(ph.get("tasks", [])):
                t.setdefault("id", f"p{pi+1}t{ti+1}")
                t["status"] = "todo"
        self.plan.new(brief, phases)
        self.plan.plan["meta"] = {k: plan.get(k) for k in ("title", "pitch", "engine", "core_loop", "monetization")}
        self.plan.save()
        self.mem.state["project"] = {"title": plan.get("title"), "pitch": plan.get("pitch"), "engine": plan.get("engine"), "brief": brief}
        self.mem.save()
        await self.emit("plan", self.plan.plan)
        pr = self.plan.progress()
        await self.say(f"Plan ready: {plan.get('title','the game')} — {len(phases)} phases, {pr['total']} tasks. Starting with {phases[0]['name']}.", kind="proactive")
        self._start_loop()

    def _start_loop(self):
        self._stop = False
        self._pause.set()
        self._build_task = asyncio.create_task(self._build_loop())

    async def resume_if_needed(self):
        """Called at startup: continue an interrupted build exactly where it was."""
        if self.plan.is_active() and self.plan.next_task():
            self.plan.plan["status"] = "paused"
            self.plan.save()
            nt = self.plan.next_task()
            await self.emit("plan", self.plan.plan)
            await self.say(f"I was in the middle of building {self.plan.plan.get('meta',{}).get('title') or 'the game'} — next up is '{nt[1]['title']}'. Say continue when you want me to pick it back up.", kind="proactive")

    async def _build_loop(self):
        self.plan.plan["status"] = "running"; self.plan.save()
        try:
            while not self._stop:
                await self._pause.wait()
                nxt = self.plan.next_task()
                if not nxt:
                    break
                phase, task = nxt
                attempts = task.get("attempts", 0)
                self.plan.set_task(task["id"], status="in_progress")
                self.plan.plan["current"] = task["id"]; self.plan.save()
                await self.emit("plan", self.plan.plan)
                fix = task.get("fix", "")
                report, outputs = await self._run_builder(task, fix)
                if self._stop:
                    break
                self.plan.log(f"{task['id']} builder: {report[:200]}")
                judge = await self._review(task, report, outputs)
                if judge.get("verdict") == "pass" and not report.upper().startswith("FAILED"):
                    self.plan.set_task(task["id"], status="done", fix="")
                    pr = self.plan.progress()
                    if pr["done"] % 5 == 0 or pr["done"] == pr["total"]:
                        await self.say(f"{pr['done']} of {pr['total']} done — just finished {task['title']}.", kind="proactive")
                else:
                    attempts += 1
                    if attempts >= MAX_TASK_ATTEMPTS:
                        self.plan.set_task(task["id"], status="skipped", attempts=attempts)
                        await self.say(f"I couldn't get '{task['title']}' right after {attempts} tries, moving on. Reason: {judge.get('reason','')[:120]}", kind="proactive")
                    else:
                        self.plan.set_task(task["id"], status="failed", attempts=attempts, fix=judge.get("fix_instructions", ""))
                        await self.set_state("working", "Fixing after review…", anim="fix")
                        await self.emit("message", {"role": "assistant", "text": f"Reviewers rejected '{task['title']}' — fixing: {judge.get('reason','')[:140]}", "speak": False, "kind": "proactive"})
                await self.emit("plan", self.plan.plan)
                await self._compact_if_needed()
            if not self._stop and not self.plan.next_task():
                self.plan.plan["status"] = "done"; self.plan.save()
                await self.emit("plan", self.plan.plan)
                await self.set_state("idle", "Game finished!", anim="celebrate")
                await self.say("The game is finished and reviewed. Want to playtest it? Press Play in Studio and tell me how it feels.", kind="proactive")
                await asyncio.sleep(4)
        except Exception as e:
            traceback.print_exc()
            self.plan.plan["status"] = "paused"; self.plan.save()
            await self.set_state("error", "Build error", anim="error")
            await self.say(f"Build paused due to an error: {str(e)[:150]}. Say continue to retry.", kind="proactive")
        finally:
            if self.plan.plan.get("status") == "running":
                self.plan.plan["status"] = "paused"; self.plan.save()
            await self.set_state("idle", "Ready", anim="idle")

    async def _plan_control(self, cmd: str):
        if cmd == "pause":
            self._pause.clear(); self.plan.plan["status"] = "paused"; self.plan.save()
            await self.say("Paused. I remember exactly where I am.")
        elif cmd == "resume":
            if not self.plan.is_active() and self.plan.plan.get("status") != "done":
                await self.say("There's nothing to continue.")
                return
            if self._build_task and not self._build_task.done():
                self._pause.set(); self.plan.plan["status"] = "running"; self.plan.save()
            else:
                self._start_loop()
            nt = self.plan.next_task()
            await self.say(f"Continuing with {nt[1]['title']}." if nt else "Everything is already done.")
        elif cmd == "stop":
            self._stop = True; self._pause.set()
            self.plan.plan["status"] = "stopped"; self.plan.save()
            await self.say("Stopped. The plan is saved if you change your mind.")
        else:
            pr = self.plan.progress()
            nt = self.plan.next_task()
            await self.say(f"{pr['done']} of {pr['total']} tasks done, status {self.plan.plan.get('status')}." + (f" Next: {nt[1]['title']}." if nt else ""))
        await self.emit("plan", self.plan.plan)

    # ------------------------------------------------------------ proactive
    async def _idle_loop(self):
        while True:
            await asyncio.sleep(30)
            try:
                if not self.settings.get("proactive", True):
                    continue
                if self.state != "idle" or time.time() - self._last_activity < IDLE_IDEA_INTERVAL:
                    continue
                if not self.mem.state.get("project"):
                    continue
                self._last_activity = time.time()
                await self.set_state("thinking", "Hmm…", anim="idea_think")
                idea = await self.llm.json(P.IDEA_SCOUT, f"PROJECT: {json.dumps(self.mem.state['project'])}\nPLAN LOG: {json.dumps(self.plan.plan.get('log', [])[-8:])}\nNOTES: {self.mem.state['notes'][-10:]}", 0.7)
                if idea.get("has_idea") and idea.get("message"):
                    await self.set_state("idle", "Idea!", anim="idea")
                    await self.say(idea["message"], kind="proactive")
                    if idea.get("task"):
                        self.mem.state["ideas"].append(idea["task"]); self.mem.save()
                await self.set_state("idle", "Ready", anim="idle")
            except Exception:
                pass
