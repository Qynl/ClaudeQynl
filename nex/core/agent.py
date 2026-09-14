"""
Nex agent core: chat, intent routing, autonomous game production loop with subagents
(planner -> builder -> optimist + pessimist -> judge), bounded memory, resume after
interrupt, proactive idea scouting. All side effects go through MCPManager / AmazonMusic only.
"""
from __future__ import annotations
import asyncio
import json
import re
import time
import traceback
from typing import Awaitable, Callable

from . import prompts as P
from . import knowledge as K
from .llm import Ollama, parse_json_loose
from .mcp import MCPManager
from .memory import Memory, PlanStore
from .music import AmazonMusic
from .planning import PrePro
from . import schemas as SCH
from . import luau as LU

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
        self.mode = self.plan.plan.get('mode', 'plan')   # 'plan' | 'build'
        self.ledger: list[str] = self.plan.plan.get('ledger', [])

    # ------------------------------------------------------------ utilities
    def _engine_knowledge(self) -> str:
        names = " ".join(s["name"] for s in self.mcp.status() if s["connected"]).lower()
        parts = []
        if "roblox" in names or not names:
            parts.append(K.ROBLOX)
        if "unreal" in names:
            parts.append(K.UNREAL)
        return "\n\n".join(parts) + "\n" + K.LUAU_LINT_HINTS

    def _budget(self, msgs: list[dict], reserve_chars: int) -> list[dict]:
        """Keep the message list inside the context window (rough 3.5 chars/token)."""
        limit = int(getattr(self.llm, 'num_ctx', 16384) * 3.5) - reserve_chars
        total = sum(len(m.get("content") or "") for m in msgs)
        out = list(msgs)
        while total > limit and len(out) > 3:
            # drop the oldest non-system message; shrink tool outputs first
            for i in range(1, len(out)):
                if out[i].get("role") == "tool" and len(out[i]["content"]) > 800:
                    total -= len(out[i]["content"]) - 800
                    out[i]["content"] = out[i]["content"][:800] + " …[truncated]"
                    break
            else:
                total -= len(out[1].get("content") or "")
                del out[1]
        return out
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
                                      temperature=0.2, num_predict=350, effort="fast")
            self.mem.set_summary(res["content"])
            await self.emit("memory", self.mem.state)
        except Exception:
            pass

    # ------------------------------------------------------------ modes
    async def set_mode(self, mode: str):
        if mode not in ("plan", "build") or mode == self.mode:
            return
        self.mode = mode
        self.plan.plan["mode"] = mode; self.plan.save()
        await self.emit("mode", {"mode": mode})
        await self.set_state(self.state, self.status_text, anim=f"mode_{mode}")
        if mode == "build":
            if self.plan.plan.get("phases") and self.plan.plan.get("status") in ("planned", "paused", "stopped"):
                await self.say("Build mode. I have a plan ready — say go and I'll start building.", kind="proactive")
            else:
                await self.say("Build mode. Tell me what to build, or switch to plan mode to design a full game first.", kind="proactive")
        else:
            await self.say("Plan mode. Describe the game and I'll run design, architecture, art and QA before writing a task graph.", kind="proactive")

    def _ledger_add(self, line: str):
        line = line.strip()[:160]
        if line and line not in self.ledger:
            self.ledger.append(line)
            self.ledger = self.ledger[-120:]
            self.plan.plan["ledger"] = self.ledger; self.plan.save()

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

        quick = self._quick_intent(text)
        if quick:
            intent = quick
        else:
            await self.set_state("thinking", "Thinking…", anim="think")
        try:
            intent = intent if quick else await self.llm.json(P.INTENT, text, temperature=0.0, schema=SCH.INTENT, num_predict=160, effort='fast', cache=True)
        except Exception as e:
            await self.set_state("error", "Ollama unreachable", anim="error")
            await self.say(f"I can't reach Ollama right now. {e}", speak=False)
            return

        kind = intent.get("intent", "chat")
        try:
            if kind == "music":
                await self._do_music(intent, text)
            elif kind == "plan_control":
                cmd = intent.get("plan_control") or "status"
                if cmd == "resume" and self.plan.plan.get("status") == "planned":
                    await self.set_mode("build"); self._start_loop(); await self.say("Building. I'll report every few tasks.")
                else:
                    await self._plan_control(cmd)
            elif kind == "build_game":
                if self.mode == "plan":
                    await self.start_planning(intent.get("game_brief") or text)
                else:
                    if self.plan.plan.get("phases") and self.plan.plan.get("status") in ("planned", "paused", "stopped"):
                        await self.say("I already have a plan. Say go to build it, or switch to plan mode to redesign.")
                    else:
                        await self.say("No plan yet — I'll draft one quickly first.", kind="proactive")
                        await self.start_planning(intent.get("game_brief") or text, then_build=True)
            elif kind == "small_task":
                await self._small_task(text)
            elif kind == "inspect":
                await self._inspect(text)
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

    def _quick_intent(self, text: str) -> dict | None:
        """Regex fast-path for unambiguous commands — saves a full LLM round-trip (~2-4 s)."""
        l = text.lower().strip(" .!")
        words = l.split()
        if len(words) <= 4:
            if l in ("pause", "pause the build", "hold on", "wait"): return {"intent": "plan_control", "plan_control": "pause"}
            if l in ("continue", "resume", "go", "go on", "start", "start building", "build it", "keep going"): return {"intent": "plan_control", "plan_control": "resume"}
            if l in ("stop", "stop building", "abort", "cancel"): return {"intent": "plan_control", "plan_control": "stop"}
            if l in ("status", "progress", "where are you", "how far"): return {"intent": "plan_control", "plan_control": "status"}
            m = {"next": "next", "next song": "next", "skip": "next", "previous": "previous", "back": "previous", "pause music": "pause", "pause the music": "pause",
                 "play music": "play", "play": "play", "resume music": "play", "stop music": "pause", "louder": "volume_up", "quieter": "volume_down",
                 "what song is this": "what", "what is this song": "what", "what's playing": "what", "open amazon music": "open"}
            if l in m: return {"intent": "music", "music_action": m[l]}
        if l.startswith(("remember that", "remember:", "don't forget", "note that")): return {"intent": "memory"}
        return None

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
        res = await self.llm.json("Extract the fact the user wants remembered (or forgotten).", text, schema=SCH.MEMORY_CMD, num_predict=120, effort='fast')
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

    # ------------------------------------------------------------ small task / inspect
    async def _small_task(self, text: str):
        await self.set_state("working", "Working in Studio…", anim="work")
        report, outputs = await self._run_builder({"title": text, "detail": text, "acceptance": "The change exists in the scene, is verified by a read-only check, and has no errors."})
        if not report.upper().startswith("FAILED"):
            j = await self._review({"title": text, "kind": "small"}, report, outputs, light=True)
            if j.get("verdict") != "pass":
                await self.set_state("working", "Fixing after review…", anim="fix")
                report, outputs = await self._run_builder({"title": text, "detail": text, "acceptance": "verified"}, j.get("fix_instructions", ""))
        if report.upper().startswith("FAILED"):
            await self.set_state("error", "Didn't work", anim="fail")
        else:
            await self.set_state("idle", "Done", anim="success")
        await self.say(report.replace("DONE:", "Done.").replace("FAILED:", "That didn't work:"))

    async def _inspect(self, text: str):
        await self.set_state("working", "Reading the place…", anim="scan")
        report, outputs = await self._run_builder({"title": f"INSPECT (read-only, do not modify anything): {text}", "detail": "Only run read-only code that prints facts. Do not create or change anything.", "acceptance": "A clear spoken summary of what was found."}, read_only=True)
        await self.say(report.replace("DONE:", "").strip())

    async def _scene_snapshot(self) -> str:
        srv = next((x for x in self.mcp.servers.values() if x.connected and any(t["name"] == "run_code" for t in x.tools)), None)
        if not srv:
            return ""
        code = '''local out = {}
local function walk(inst, d) if d > 2 then return end for _, c in ipairs(inst:GetChildren()) do
  if #out > 140 then return end
  local extra = ""
  if c:IsA("BasePart") then extra = string.format(" size=%.0f,%.0f,%.0f", c.Size.X, c.Size.Y, c.Size.Z) elseif c:IsA("LuaSourceContainer") then extra = " src=" .. #c.Source end
  table.insert(out, string.rep("  ", d) .. c.ClassName .. " " .. c.Name .. extra); walk(c, d + 1) end end
for _, s in ipairs({workspace, game.ReplicatedStorage, game.ServerScriptService, game.ServerStorage, game.StarterGui, game.StarterPlayer}) do
  table.insert(out, s.Name); walk(s, 1) end
print(table.concat(out, "\\n"))'''
        try:
            r = await srv.call_tool("run_code", {"command": code})
            return (r.get("text") or "")[:3500]
        except Exception:
            return ""

    # ------------------------------------------------------------ builder subagent
    async def _run_builder(self, task: dict, fix_instructions: str = "", read_only: bool = False) -> tuple[str, list[str]]:
        tools = self.mcp.ollama_tools()
        if not tools:
            return "FAILED: no MCP server is connected — connect Roblox Studio or Unreal in settings.", []
        style = json.dumps(self.plan.plan.get("meta", {}).get("style") or {}) if self.plan.plan.get("meta") else ""
        naming = json.dumps(self.plan.plan.get("meta", {}).get("naming") or {}) if self.plan.plan.get("meta") else ""
        sys_prompt = (f"{P.BUILDER}\n\n{P.TOOL_RULES}\n\n{self._engine_knowledge()}\n\n"
                      f"PROJECT CONTEXT:\n{self.mem.context_block()[:2200]}\nSTYLE: {style}\nNAMING: {naming}\n"
                      f"ALREADY BUILT (ledger, do not recreate, reuse names):\n- " + "\n- ".join(self.ledger[-40:] or ["nothing yet"]))
        if read_only:
            sys_prompt += "\n\nREAD-ONLY MODE: you may only inspect. Any code that creates, destroys or sets properties is forbidden."
        user = f"TASK: {task['title']}\nDETAIL: {task.get('detail','')}\nACCEPTANCE: {task.get('acceptance','')}"
        if fix_instructions:
            user += f"\n\nPREVIOUS ATTEMPT WAS REJECTED. FIX THIS:\n{fix_instructions}"
        msgs = [{"role": "system", "content": sys_prompt}, {"role": "user", "content": user}]
        outputs: list[str] = []
        seen_calls: dict[str, int] = {}
        errors_in_row = 0
        preflight_fails = 0
        # give the builder a real snapshot of the place instead of letting it guess (one cheap MCP call, zero LLM)
        snap = await self._scene_snapshot()
        if snap:
            msgs.append({"role": "system", "content": "CURRENT PLACE SNAPSHOT (top 2 levels):\n" + snap})
        for rnd in range(MAX_BUILDER_ROUNDS):
            await self._pause.wait()
            if self._stop:
                return "FAILED: stopped by user", outputs
            await self.set_state("working", f"{'Inspecting' if read_only else 'Building'}: {task['title'][:40]}", anim="think" if rnd == 0 else ("read" if read_only else "work"))
            msgs = self._budget(msgs, 6000)
            res = await self.llm.chat(msgs, tools=tools, temperature=0.15 if rnd < 3 else 0.35, effort="deep" if rnd == 0 else "normal", num_predict=2200)
            msgs.append({"role": "assistant", "content": res["content"], "tool_calls": res["tool_calls"]})
            if not res["tool_calls"]:
                return (res["content"] or "DONE: (no report)"), outputs
            for tc in res["tool_calls"]:
                fn = tc.get("function", {})
                name = fn.get("name", "")
                args = fn.get("arguments", {})
                if isinstance(args, str):
                    args = parse_json_loose(args)
                sig = name + json.dumps(args, sort_keys=True)[:400]
                seen_calls[sig] = seen_calls.get(sig, 0) + 1
                if seen_calls[sig] > 2:
                    msgs.append({"role": "tool", "content": "NEX_ERROR: you already ran this exact call twice. Change approach or report FAILED with the reason.", "name": name})
                    continue
                payload = json.dumps(args).lower()
                # ---- Luau pre-flight (local, instant): reject hallucinated APIs / broken blocks before Studio sees them
                code_key = next((k for k in ("command", "code", "script", "source", "luau") if isinstance(args.get(k), str)), None)
                is_roblox = "roblox" in name.lower() or name.endswith("__run_code")
                if code_key and is_roblox:
                    issues = LU.check(args[code_key], read_only=read_only)
                    ok, msg_txt = LU.summarize(issues)
                    if not ok:
                        preflight_fails = preflight_fails + 1
                        await self.set_state("working", "Pre-flight caught a bug", anim="side_eye")
                        await self.emit("tool_result", {"name": name, "text": "PRE-FLIGHT REJECTED:\n" + msg_txt, "blocked": False, "error": True})
                        msgs.append({"role": "tool", "content": "NEX_PREFLIGHT_REJECTED — fix these and call again (do not explain, just re-call):\n" + msg_txt, "name": name})
                        if preflight_fails >= 5:
                            return "FAILED: code kept failing pre-flight: " + msg_txt[:200], outputs
                        continue
                    code = args[code_key]
                    is_verify = read_only or ("nex_verify" in payload) or ("instance.new" not in payload and ".source" not in payload and ".parent" not in payload and "print(" in payload)
                    if is_verify:
                        args = dict(args); args[code_key] = 'print("NEX_VERIFY")\n' + code
                    elif "NEX_OK" in code:
                        args = dict(args); args[code_key] = LU.wrap_for_studio(code, task["title"])
                    if msg_txt:
                        msgs.append({"role": "system", "content": "pre-flight warnings (fix next time): " + msg_txt[:400]})
                is_write = any(k in payload for k in ("source", "instance.new", "create", "spawn", "set_", "destroy"))
                anim = ("typing" if "source" in payload else "write") if is_write else ("scan" if read_only else "read")
                short = name.split("__", 1)[-1]
                await self.set_state("working", f"{'Writing' if is_write else 'Reading'}: {short} · {task['title'][:30]}", anim=anim)
                await self.emit("tool", {"name": name, "args": args})
                result = await self.mcp.call(name, args, self.playtest_consent)
                if result.get("needs_user_consent"):
                    self.pending_consent = {"tool": name, "args": args}
                    await self.say("Want me to run a playtest now? Say yes or no.", kind="consent")
                txt = result.get("reason") if result.get("blocked") else result.get("text", "")
                outputs.append(f"{name}: {txt[:1500]}")
                had_err = ("NEX_ERROR" in txt) or bool(result.get("isError")) or bool(re.search(r"(^|\n)\S*:\d+: |attempt to |unexpected symbol|expected .* near", txt))
                errors_in_row = errors_in_row + 1 if had_err else 0
                if had_err:
                    await self.set_state("working", "Hit an error, fixing…", anim="facepalm" if errors_in_row >= 2 else "fix")
                await self.emit("tool_result", {"name": name, "text": txt[:2000], "blocked": result.get("blocked", False), "error": bool(had_err)})
                msgs.append({"role": "tool", "content": txt[:6000], "name": name})
                if errors_in_row >= 4:
                    return "FAILED: repeated errors — " + txt[:200], outputs
        return "FAILED: ran out of tool rounds", outputs

    # ------------------------------------------------------------ review committee
    async def _review(self, task: dict, report: str, outputs: list[str], light: bool = False) -> dict:
        joined = "\n".join(outputs)
        # --- deterministic gates first (0 GPU seconds) ---
        if report.upper().startswith("FAILED"):
            return {"verdict": "redo", "reason": "builder reported failure", "fix_instructions": report, "note_for_memory": ""}
        if "NEX_ERROR" in joined[-3000:] and task.get("kind") != "review":
            return {"verdict": "redo", "reason": "last tool output contains NEX_ERROR", "fix_instructions": "Fix the Lua error shown in the last output and re-run, then verify.", "note_for_memory": ""}
        if "NEX_OK" not in joined and outputs and task.get("kind") != "review":
            return {"verdict": "redo", "reason": "no NEX_OK confirmation in tool output — build not verified",
                    "fix_instructions": "Re-run the build ending with print('NEX_OK ...') then run a read-only verification that prints the created object names.", "note_for_memory": ""}
        if "NEX_VERIFY" not in joined and task.get("kind") not in ("review",) and not light:
            return {"verdict": "redo", "reason": "no read-only verification call was made",
                    "fix_instructions": "Run one read-only verification call (it will be tagged NEX_VERIFY) that prints the objects you created, then report DONE.", "note_for_memory": ""}
        ctx = f"TASK: {task['title']}\nDETAIL: {task.get('detail','')[:900]}\nACCEPTANCE: {task.get('acceptance','')}\n\nBUILDER REPORT: {report[:800]}\n\nTOOL OUTPUTS (tail):\n" + joined[-3500:]
        if light:
            # one merged critic instead of three calls for small/one-shot tasks
            await self.set_state("reviewing", "Quick review", anim="judge")
            j = await self.llm.json(P.JUDGE + "\nYou are reviewing alone (no other critics). Be strict about evidence.", ctx, 0.1, schema=SCH.JUDGE, num_predict=300, effort="fast")
            await self.emit("review", {"task": task["title"], "optimist": None, "pessimist": None, "judge": j})
            return j
        await self.set_state("reviewing", "Reviewing (optimist + pessimist)", anim="review_pos")
        opt_c = self.llm.json(P.OPTIMIST, ctx, 0.3, schema=SCH.OPTIMIST, num_predict=350, effort="fast")
        pes_c = self.llm.json(P.PESSIMIST, ctx, 0.3, schema=SCH.PESSIMIST, num_predict=450, effort="fast")
        opt, pes = await asyncio.gather(opt_c, pes_c, return_exceptions=True)
        opt = opt if isinstance(opt, dict) else {"score": 5, "strengths": [], "evidence": [], "verdict": "pass"}
        pes = pes if isinstance(pes, dict) else {"score": 5, "problems": [], "must_fix": [], "unverified_claims": [], "verdict": "pass"}
        await self.set_state("reviewing", "Reviewing (pessimist)", anim="review_neg")
        # fast agreement: both pass and pessimist has no must_fix -> skip judge call
        if opt.get("verdict") == "pass" and pes.get("verdict") == "pass" and not pes.get("must_fix"):
            judge = {"verdict": "pass", "reason": "both reviewers agree", "fix_instructions": "", "note_for_memory": ""}
        else:
            await self.set_state("reviewing", "Judging…", anim="judge")
            judge = await self.llm.json(P.JUDGE, f"{ctx[-2500:]}\n\nOPTIMIST: {json.dumps(opt)[:800]}\n\nPESSIMIST: {json.dumps(pes)[:1200]}", 0.1, schema=SCH.JUDGE, num_predict=350, effort="fast")
        await self.emit("review", {"task": task["title"], "optimist": opt, "pessimist": pes, "judge": judge})
        if judge.get("note_for_memory"):
            self.mem.add_note(judge["note_for_memory"])
        return judge

    # ------------------------------------------------------------ autonomous build
    async def start_planning(self, brief: str, then_build: bool = False):
        if self._build_task and not self._build_task.done():
            await self.say("I'm already building something. Say stop first if you want a new project.")
            return
        await self.set_state("planning", "Pre-production…", anim="plan_subagents")
        await self.say("Starting pre-production: designer, architect, art director, QA, then the producer.", kind="proactive")

        async def stage(key, label):
            await self.set_state("planning", label, anim="plan_subagents")
            await self.emit("plan_stage", {"stage": key, "label": label})

        engines = [x["name"] for x in self.mcp.status() if x["connected"]]
        try:
            result = await PrePro(self.llm, stage).run(brief, self.mem.context_block()[:1500], engines)
        except Exception as e:
            await self.set_state("error", "Planning failed", anim="error")
            await self.say(f"Pre-production failed: {str(e)[:120]}")
            return
        if not result["phases"]:
            await self.say("I couldn't produce a plan, could you describe the game a bit more?")
            return
        self.plan.new(brief, result["phases"])
        self.plan.plan["meta"] = result["meta"]; self.plan.plan["gdd"] = result["gdd"]
        self.plan.plan["status"] = "planned"; self.plan.plan["mode"] = self.mode; self.plan.plan["ledger"] = self.ledger = []
        self.plan.save()
        self.mem.state["project"] = {"title": result["meta"].get("title"), "pitch": result["meta"].get("pitch"), "engine": result["meta"].get("engine"), "brief": brief}
        self.mem.save()
        await self.emit("plan", self.plan.plan)
        pr = self.plan.progress()
        rv = result["gdd"].get("plan_review", {}).get("pessimist", {})
        await self.set_state("idle", "Plan ready", anim="success")
        await self.say(f"Plan ready: {result['meta'].get('title','the game')}. {len(result['phases'])} phases, {pr['total']} tasks. "
                       f"The pessimist scored it {rv.get('score','?')} out of 10." + (" Starting the build." if then_build else " Switch to build mode and say go when you like it."), kind="proactive")
        if then_build:
            await self.set_mode("build")
            self._start_loop()

    async def start_build(self, brief: str):  # backwards compat
        await self.start_planning(brief, then_build=True)

    def _start_loop(self):
        self._stop = False
        self._pause.set()
        self._build_task = asyncio.create_task(self._build_loop())

    async def startup_report(self):
        st = self.mcp.status()
        on = [x["name"] for x in st if x["connected"]]
        off = [x for x in st if not x["connected"] and x.get("error")]
        if on:
            await self.set_state("idle", "Connected", anim="connected")
            await self.say(f"Connected to {', '.join(on)}. Say Nex and tell me what to build.", kind="proactive")
        elif off:
            await self.set_state("idle", "No engine connected", anim="disconnected")
            await self.say("I'm awake, but no engine is connected yet. Open Roblox Studio with a place, or check the MCP settings.", kind="proactive", speak=False)
        await self.resume_if_needed()

    async def resume_if_needed(self):
        """Called at startup: continue an interrupted build exactly where it was."""
        if self.plan.plan.get("status") == "planned":
            await self.emit("plan", self.plan.plan)
            await self.say(f"I have a finished plan for {self.plan.plan.get('meta',{}).get('title') or 'your game'}. Switch to build mode and say go.", kind="proactive", speak=False)
            return
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
                judge = await self._review(task, report, outputs, light=task.get("kind") in ("asset", "polish", "animation") and attempts == 0)
                if judge.get("verdict") == "pass" and not report.upper().startswith("FAILED"):
                    self.plan.set_task(task["id"], status="done", fix="")
                    self._ledger_add(f"{task['title']}: {report.replace('DONE:', '').strip()[:120]}")
                    pr = self.plan.progress()
                    if pr["done"] % 5 == 0 or pr["done"] == pr["total"]:
                        await self.say(f"{pr['done']} of {pr['total']} done — just finished {task['title']}.", kind="proactive")
                else:
                    attempts += 1
                    if attempts >= MAX_TASK_ATTEMPTS:
                        self.plan.set_task(task["id"], status="skipped", attempts=attempts)
                        await self.set_state("working", "Skipping task", anim="rain_cloud")
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
                await self.set_state("idle", "Game finished!", anim="victory_spin")
                await asyncio.sleep(2.2)
                await self.set_state("idle", "Game finished!", anim="celebrate")
                try:
                    qa = await self.llm.chat([{"role": "system", "content": P.FINAL_QA}, {"role": "user", "content": f"PLAN: {json.dumps(self.plan.plan)[:9000]}\nNOTES: {self.mem.state['notes'][-30:]}"}], temperature=0.3)
                    await self.say(qa["content"], kind="proactive")
                except Exception:
                    pass
                await self.say("Press Play in Studio and tell me how it feels — I'll fix whatever you find.", kind="proactive")
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
            if not self.plan.next_task():
                await self.say("There's nothing to continue.")
                return
            if self.mode != "build":
                await self.set_mode("build")
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
                idea = await self.llm.json(P.IDEA_SCOUT, f"PROJECT: {json.dumps(self.mem.state['project'])}\nPLAN LOG: {json.dumps(self.plan.plan.get('log', [])[-8:])}\nNOTES: {self.mem.state['notes'][-10:]}", 0.7, schema=SCH.IDEA, num_predict=300, effort="fast")
                if idea.get("has_idea") and idea.get("message"):
                    await self.set_state("idle", "Idea!", anim="idea")
                    await self.say(idea["message"], kind="proactive")
                    if idea.get("task"):
                        self.mem.state["ideas"].append(idea["task"]); self.mem.save()
                await self.set_state("idle", "Ready", anim="idle")
            except Exception:
                pass
