"""
Bounded memory for Nex.
- working memory: the current plan + step + last few facts (always injected into prompts)
- long-term notes: short bullet facts about the project/user, capped, compacted by the LLM
- transcript: sliding window of recent chat; older parts are summarised
All stored under nex/data/ — the only place Nex may write.
"""
from __future__ import annotations
import json
import time
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
DATA.mkdir(exist_ok=True)

MAX_NOTES = 60           # long-term bullet facts
MAX_TRANSCRIPT = 30      # recent messages kept verbatim
MAX_SUMMARY_CHARS = 2500


class Memory:
    def __init__(self):
        self.path = DATA / "memory.json"
        self.state = {
            "notes": [],                # list[str]
            "summary": "",              # rolling summary of older conversation
            "transcript": [],           # list[{role, content, t}]
            "project": {},              # current game project meta
            "ideas": [],                # proactive ideas Nex wants to mention
        }
        self.load()

    def load(self):
        if self.path.exists():
            try:
                self.state.update(json.loads(self.path.read_text(encoding="utf-8")))
            except Exception:
                pass

    def save(self):
        self.path.write_text(json.dumps(self.state, indent=1, ensure_ascii=False), encoding="utf-8")

    # --- notes ---
    def add_note(self, note: str):
        note = note.strip()[:300]
        if not note or note in self.state["notes"]:
            return
        self.state["notes"].append(note)
        if len(self.state["notes"]) > MAX_NOTES:
            self.state["notes"] = self.state["notes"][-MAX_NOTES:]
        self.save()

    def remove_note(self, idx: int):
        if 0 <= idx < len(self.state["notes"]):
            self.state["notes"].pop(idx)
            self.save()

    # --- transcript ---
    def add_message(self, role: str, content: str):
        self.state["transcript"].append({"role": role, "content": content[:4000], "t": time.time()})
        self.save()

    def needs_compaction(self) -> bool:
        return len(self.state["transcript"]) > MAX_TRANSCRIPT

    def pop_old_for_compaction(self) -> list[dict]:
        """Return the messages that should be summarised and drop them from the window."""
        keep = MAX_TRANSCRIPT // 2
        old, self.state["transcript"] = self.state["transcript"][:-keep], self.state["transcript"][-keep:]
        self.save()
        return old

    def set_summary(self, s: str):
        self.state["summary"] = s.strip()[:MAX_SUMMARY_CHARS]
        self.save()

    # --- prompt view ---
    def context_block(self) -> str:
        parts = []
        if self.state["project"]:
            parts.append("PROJECT: " + json.dumps(self.state["project"], ensure_ascii=False)[:800])
        if self.state["summary"]:
            parts.append("EARLIER CONVERSATION SUMMARY:\n" + self.state["summary"])
        if self.state["notes"]:
            parts.append("LONG-TERM NOTES:\n- " + "\n- ".join(self.state["notes"][-25:]))
        return "\n\n".join(parts)

    def recent_messages(self) -> list[dict]:
        return [{"role": m["role"], "content": m["content"]} for m in self.state["transcript"]]

    def clear_conversation(self):
        self.state["transcript"] = []
        self.state["summary"] = ""
        self.save()


class PlanStore:
    """Persistent plan so Nex can resume exactly where it was after interruption/restart."""

    def __init__(self):
        self.path = DATA / "plan.json"
        self.plan: dict = {"goal": "", "phases": [], "status": "idle", "log": [], "created": 0}
        if self.path.exists():
            try:
                self.plan = json.loads(self.path.read_text(encoding="utf-8"))
            except Exception:
                pass

    def save(self):
        self.plan["log"] = self.plan.get("log", [])[-200:]
        self.path.write_text(json.dumps(self.plan, indent=1, ensure_ascii=False), encoding="utf-8")

    def new(self, goal: str, phases: list[dict]):
        seen = set()
        for pi, ph in enumerate(phases):
            for ti, t in enumerate(ph.get("tasks", [])):
                if not t.get("id") or t["id"] in seen:
                    t["id"] = f"p{pi + 1}t{ti + 1}"
                seen.add(t["id"]); t.setdefault("status", "todo")
        self.plan = {"goal": goal, "phases": phases, "status": "running", "log": [], "created": time.time(),
                     "current": None}
        self.save()

    def log(self, msg: str):
        self.plan.setdefault("log", []).append({"t": time.time(), "m": msg[:500]})
        self.save()

    def next_task(self) -> tuple[dict, dict] | None:
        for ph in self.plan.get("phases", []):
            for t in ph.get("tasks", []):
                if t.get("status") in (None, "todo", "failed", "in_progress"):
                    return ph, t
        return None

    def set_task(self, task_id: str, **fields):
        for ph in self.plan.get("phases", []):
            for t in ph.get("tasks", []):
                if t.get("id") == task_id:
                    t.update(fields)
        self.save()

    def progress(self) -> dict:
        total = done = 0
        for ph in self.plan.get("phases", []):
            for t in ph.get("tasks", []):
                total += 1
                done += t.get("status") == "done"
        return {"total": total, "done": done, "pct": (100 * done // total) if total else 0}

    def is_active(self) -> bool:
        return self.plan.get("status") in ("running", "paused")
