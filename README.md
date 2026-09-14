# Nex

Two glowing rectangular eyes that live on your screen, talk to you, vibe to your Amazon Music,
and autonomously build **finished, sellable games** inside **Roblox Studio** (primary) and **Unreal Engine 5**
through MCP — running fully local on `gpt-oss:20b` via Ollama.

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│            ▄▄▄▄▄▄▄▄▄▄          ▄▄▄▄▄▄▄▄▄▄                    │
│            █████████           █████████                     │
│            █████████           █████████         ← 43 anims │
│            █████████           █████████                     │
│            ▀▀▀▀▀▀▀▀▀▀          ▀▀▀▀▀▀▀▀▀▀                    │
│                                                              │
│                ● WORKING · writing: run_code                 │
│                  "building spawn pads (3/27)"                │
│                                                              │
│  [🎙] Talk to Nex… or say "Nex"                         [➤]  │
└──────────────────────────────────────────────────────────────┘
```

## What Nex can do — and only this

| Capability | How |
|---|---|
| Talk / listen | Wake word **"Nex"** → speech-to-text → answer spoken aloud. Browser engine by default (zero install), optional fully-local Whisper + Piper. |
| Roblox Studio | Official [Roblox Studio MCP](https://github.com/Roblox/studio-rust-mcp-server) (`run_code`, `insert_model`). Nex writes Luau, builds assets, scripts, UI, animations, data stores… |
| Unreal Engine 5 | Any Unreal MCP server (preset for [unreal-mcp](https://github.com/chongdashu/unreal-mcp)). |
| Amazon Music | Windows media keys + system media session. **No API, no login.** Play / pause / next / previous / volume / "what's playing" / search. |
| Build whole games | Planner → per-task Builder subagent → **Optimist** + **Pessimist** reviewers → **Judge** → redo or next task. Runs until done or you say stop. |
| Remember | Bounded memory: rolling conversation summary + ≤60 long-term notes + persistent plan. Interrupt or restart – Nex continues from the exact task. |
| Inspect | "Nex, what's in the place?" / "what does GameManager do?" → read-only mode (mutating code is refused). |
| Always-on-top | 🗗 button pops the eyes into a tiny Picture-in-Picture window that floats over Studio. |
| Speak up on its own | Progress every few tasks, "reviewers rejected X, fixing…", found/fixed bugs, and idle-time ideas about your project. |

### What Nex **cannot** do (by construction, not by prompt)

* No file system, shell, network, process or registry access — there is no code path for it.
* The only program it may open is Amazon Music.
* MCP tools that look like shell/file/process/download are blocked even if a server offers them.
* Code payloads with `HttpService`, `os`/`io`, `plugin`, Studio internals or playtest triggers are rejected.
* **Playtests need your explicit OK** every time (Nex asks; you press Play in Studio).
* Its own memory lives only in `nex/data/`.

## Install (Windows)

1. **Ollama** → https://ollama.com → then `ollama pull gpt-oss:20b`
2. **Python 3.10+** (tick *Add to PATH*).
3. **Roblox Studio MCP** → download installer from the
   [releases page](https://github.com/Roblox/studio-rust-mcp-server/releases), run it once (it installs the Studio plugin).
   Open Studio with a place.
4. Double-click **`start_nex.bat`**. It installs the single dependency (`aiohttp`) and opens Nex in your browser.
   Use **Edge or Chrome** (best voices + wake-word recognition). Click once on the page to enable the microphone.

Optional fully-local voice: `pip install faster-whisper piper-tts`, put a Piper voice `.onnx` into `nex/data/`,
then switch engines in **⚙ Settings**.

## Plan mode vs Build mode

The small chip under the eyes switches modes (also: "switch to build mode").

**◈ Plan** — describing a game triggers *pre-production* with five specialist subagents, each with its own prompt and context:
Designer (core loop, systems, monetization, retention) → Architect (folders, remotes, modules, data schema, anti-exploit — the naming source of truth)
→ Art director (palette, materials, lighting, UI style, asset list) → QA lead (acceptance tests, exploit risks, playtest script)
→ Producer (dependency-ordered task graph, 28-50 tasks). Then Optimist / Pessimist / Judge review the **plan itself** and the producer revises once if needed.
Nothing is built. The result is a GDD you can read in 📋 → *Design*.

**◆ Build** — executes the task graph. Every task: Builder subagent (tools, must end with `NEX_OK` + a read-only verification)
→ Optimist + Pessimist → Judge → pass / redo (max 3) / skip. A **ledger** of everything built so far is fed to every later task so names stay consistent
(📋 → *Built*). Progress, rejections and skips are spoken proactively; the run survives pauses, restarts and interruptions.

## Using Nex

* Say **"Nex, play some music"** / **"Nex, what's this song?"** / **"Nex, next track"**.
* In **Plan** mode: **"Nex, a tycoon game with 3 tiers, shop, daily rewards and leaderboards"** → full pre-production, plan ready in a few minutes.
  Flip to **Build**, say **"go"** → Nex builds every task in Studio, reviews each with two opposing critics and a judge, and reports milestones.
* In **Build** mode without a plan: small tasks are done directly ("add a red spinning platform at 0,10,0").
* **"pause"**, **"continue"**, **"stop"**, **"status"** control the build.
* **"remember that I hate neon colours"** → long-term note.
* ✨ button → try any of the 43 animations.

## Speed & anti-hallucination (tuned for a 16 GB GPU, e.g. RX 9060 XT)

| Lever | What it does |
|---|---|
| `keep_alive=-1`, `num_gpu=999`, warm-up at start | gpt-oss:20b (MXFP4, ≈12.5 GB) stays pinned in VRAM; first request is already hot. |
| `num_ctx` 8192 default | Fits weights + KV cache in 16 GB. Nex budgets every prompt to fit; memory is compacted automatically. |
| Structured outputs (JSON schema per call) | Ollama constrains decoding — malformed JSON and rambling are impossible for intent, critics, judge, planner, GDD. |
| Reasoning effort per call | `low` for intent/critics/judge, `medium` only for the designer/architect/producer and the builder's first step. |
| Regex fast-path | "pause", "continue", "next song", "status", … never touch the LLM. |
| **Luau pre-flight** (`core/luau.py`) | Before code reaches Studio: block balance, unknown services/classes/materials, deprecated APIs, missing `.Parent`, empty/TODO scripts, nested `[[ ]]`, read-only violations. Rejections come back as a checklist the model fixes in one shot — saves a 20-60 s Studio round-trip each time. |
| Scene snapshot | Each task starts with a real tree of the place (one MCP call, zero LLM) so the model doesn't guess what exists. |
| Auto `pcall` + undo waypoint | Build code is wrapped so errors come back as `NEX_ERROR <msg>` and every task is one Ctrl+Z in Studio. |
| Deterministic review gates | FAILED report / `NEX_ERROR` / missing `NEX_OK` / missing `NEX_VERIFY` → instant redo, no critic calls. |
| Fast agreement | Optimist + pessimist run in parallel; if both pass with no must-fix, the judge call is skipped. Asset/polish tasks get a single merged critic. |
| Response cache | Identical intent/critic prompts within 10 min are not recomputed. |

Typical cost per plan task on a 9060 XT: 1 builder call (~15-30 s) + 1 verify call + 2 short critics (~5 s each) ≈ 40-60 s.
A 35-task game ≈ 30-40 min of unattended building.

**ROCm note:** install Ollama's ROCm build; if `ollama ps` shows less than 100 % GPU, set `HSA_OVERRIDE_GFX_VERSION=12.0.0` (RDNA 4) or lower `num_ctx`.

## Layout

```
nex/
  server.py          aiohttp server: UI, websocket, settings, MCP mgmt, voice endpoints
  core/production.py  vertical slice, review lenses, phase gates, polish phase, release note
  core/safety.py     hard capability limits (tool blocklist, payload scan, playtest consent)
  core/mcp.py        MCP client (stdio + Streamable HTTP), no SDK
  core/agent.py      Nex brain: intent router, planner, builder, optimist/pessimist/judge, resume, proactive
  core/memory.py     bounded memory + persistent plan
  core/music.py      Amazon Music via media keys / media session
  core/llm.py        Ollama client (GPU pinning, schemas, effort, cache)
  core/luau.py       Luau pre-flight linter + Studio wrappers
  core/schemas.py    JSON schemas for structured outputs
  core/planning.py   5-subagent pre-production pipeline
  core/voice.py      optional local Whisper/Piper
  web/               anims.js (43 clips), eyes.js (spring pose engine), app.js, settings page
  presets/           MCP presets (Roblox official, Unreal, custom HTTP)
  data/              Nex's memory (git-ignored)
tests/test_core.py   safety + MCP + full agent-loop tests (mock LLM)
```

Run tests: `python tests/test_core.py`

## Animation catalog (43 clips)

From `nex/web/anims.js`. Every clip is a *pose target*; `eyes.js` springs the eyes toward it, so any clip can interrupt any other without a jump. Loops with **enter / exit** shots play them when switching family — e.g. leaving music plays `headset_off` (the headset fades and lifts) before `idle`. All props are white line art.

### loops

| Clip | Type | Enter → Exit | Description |
|---|---|---|---|
| `idle` | loop |  →  | Neutral. Slow float, faint drift. |
| `listen` | loop |  →  | Attentive: eyes open a little, slight lean, sound wave. |
| `speak` | loop |  →  | Talking: syllable flicker, gentle nod. |
| `think` | loop |  →  | Looks up-right, relaxed lids, three dots. |
| `plan` | loop |  →  | Reads down a list: eyes scan left-right, slightly lowered. |
| `work` | loop | work_in → work_out | Focused: small quick eye movements, spinner. |
| `type` | loop | work_in → work_out | Writing code line by line. |
| `read` | loop | work_in → work_out | Reads lines across. |
| `review` | loop |  →  | Weighs it up: slow left-right, slight tilt. |
| `error` | loop |  →  | Eyes shut, brief shake, cross above. |
| `music` | loop | headset_on → headset_off | Vibing: sways and bounces on the beat. |
| `music_nod` | loop | headset_on → headset_off | Head-nodding, eyes half closed. |
| `music_sway` | loop | headset_on → headset_off | Slow wide sway, dreamy. |
| `music_closed` | loop | headset_on → headset_off | Eyes closed, lost in it. |
| `music_paused` | loop | headset_on → headset_off | Paused, still wearing the headset. |
| `music_dj` | loop | headset_on → headset_off | DJ: tilted, one lid down, scratch wobble, equalizer. |
| `sleep` | loop | sleep_in → wake | Asleep. Slow breathing. |

### shots

| Clip | Type | Enter → Exit | Description |
|---|---|---|---|
| `headset_on` | 1.1s |  →  | Headset lowers on from above, small settle bounce, happy blink. |
| `headset_off` | 1.15s |  →  | Lifts the headset off, shakes it out, settles. |
| `work_in` | 0.8s |  →  | Rolls shoulders, drops gaze to the desk. |
| `work_out` | 0.8s |  →  | Lifts gaze, satisfied blink. |
| `wake` | 2.2s |  →  | Opens, tall stretch, blink. |
| `sleep_in` | 1.6s |  →  | Lids sink, glow dims. |
| `blink` | 0.18s |  →  | Blink. |
| `blink2` | 0.4s |  →  | Double blink. |
| `wink` | 0.5s |  →  | Wink. |
| `nod` | 0.9s |  →  | Yes. |
| `shake` | 0.9s |  →  | No. |
| `glance_l` | 1.3s |  →  | Glance left. |
| `glance_r` | 1.3s |  →  | Glance right. |
| `glance_u` | 1.3s |  →  | Glance up. |
| `tilt` | 1.6s |  →  | Head tilt — curious. |
| `squint` | 1.6s |  →  | Narrows eyes. |
| `happy` | 1.8s |  →  | Happy hop. |
| `sad` | 2.4s |  →  | Sad. |
| `surprised` | 1.4s |  →  | Round wide eyes, pop up. |
| `idea` | 2.2s |  →  | Lightbulb. |
| `success` | 1.6s |  →  | Check mark. |
| `fail` | 1.8s |  →  | Cross mark. |
| `celebrate` | 3s |  →  | Bouncing celebration. |
| `sigh` | 2s |  →  | Inhale up, exhale down. |
| `yawn` | 2.2s |  →  | Yawn. |
| `alert` | 1.2s |  →  | Attention. |

## Production workflow (build mode)

1. **Pre-production** – design doc, architecture, art style, naming contract; the pessimist scores the plan.
2. **Vertical slice** – one tiny, fully finished loop first. A creative director reviews it against a Studio snapshot; only a greenlight (max 2 rounds) lets Nex scale out.
3. **Phases** – assets → scripts → UI → data. Every task passes review lenses (tech / feel / art / UX by task kind) and a judge that can send it back with exact fix instructions.
4. **Phase gates** – a read-only Luau probe checks the architecture contract (missing scripts/remotes, default-grey parts) and adds fix tasks.
5. **Polish phase** – lighting, UI consistency, juice, sounds, balance/anti-exploit, screenshot critique, onboarding.
6. **Release note** – what was built, what is weak, and a request to press Play.

Three consecutive failed tasks pause the build and ask you for help.
