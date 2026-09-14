# Nex

Two glowing rectangular eyes that live on your screen, talk to you, vibe to your Amazon Music,
and autonomously build **finished, sellable games** inside **Roblox Studio** (primary) and **Unreal Engine 5**
through MCP — running fully local on `gpt-oss:20b` via Ollama.

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│            ▄▄▄▄▄▄▄▄▄▄          ▄▄▄▄▄▄▄▄▄▄                    │
│            █████████           █████████                     │
│            █████████           █████████         ← 129 anims │
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

## Using Nex

* Say **"Nex, play some music"** / **"Nex, what's this song?"** / **"Nex, next track"**.
* Say **"Nex, build me a complete tycoon game with 3 tiers, shop, daily rewards and leaderboards"** →
  Nex plans 20-45 tasks, builds them in Studio one by one, reviews each one with two opposing critics and a judge,
  and tells you when it hits milestones. Open 📋 to watch the plan.
* **"pause"**, **"continue"**, **"stop"**, **"status"** control the build.
* **"remember that I hate neon colours"** → long-term note.
* ✨ button → try any of the 129 animations.

## Layout

```
nex/
  server.py          aiohttp server: UI, websocket, settings, MCP mgmt, voice endpoints
  core/safety.py     hard capability limits (tool blocklist, payload scan, playtest consent)
  core/mcp.py        MCP client (stdio + Streamable HTTP), no SDK
  core/agent.py      Nex brain: intent router, planner, builder, optimist/pessimist/judge, resume, proactive
  core/memory.py     bounded memory + persistent plan
  core/music.py      Amazon Music via media keys / media session
  core/llm.py        Ollama client
  core/voice.py      optional local Whisper/Piper
  web/               eyes (canvas), 129 animations, app logic, settings page
  presets/           MCP presets (Roblox official, Unreal, custom HTTP)
  data/              Nex's memory (git-ignored)
tests/test_core.py   safety + MCP + full agent-loop tests (mock LLM)
```

Run tests: `python tests/test_core.py`
