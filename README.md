# Nex

Two glowing rectangular eyes that live on your screen, talk to you, vibe to your Amazon Music,
and autonomously build **finished, sellable games** inside **Roblox Studio** (primary) and **Unreal Engine 5**
through MCP — running fully local on `gpt-oss:20b` via Ollama.

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│            ▄▄▄▄▄▄▄▄▄▄          ▄▄▄▄▄▄▄▄▄▄                    │
│            █████████           █████████                     │
│            █████████           █████████         ← 137 anims │
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
* ✨ button → try any of the 137 animations.

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
  web/               eyes (canvas), 137 animations, app logic, settings page
  presets/           MCP presets (Roblox official, Unreal, custom HTTP)
  data/              Nex's memory (git-ignored)
tests/test_core.py   safety + MCP + full agent-loop tests (mock LLM)
```

Run tests: `python tests/test_core.py`

## Animation catalog (137 clips)

Generated from `nex/web/animations.js` (`node tests/gen_anim_docs.js`). Loops run until the state changes; one-shots layer on top. Loops with **enter / exit** clips play them when moving between families — e.g. leaving any music loop plays `headset_off` before idle.

### Idle loops

| Clip | Enter → Exit | What it looks like |
|---|---|---|
| `heartbeat` |  | Lub-dub double pump of scale and glow. |
| `idle` |  | Neutral breathing. Slow float, micro-drift, soft glow pulse. |
| `idle_bored` |  | Heavy-lidded, eyes drift lazily side to side. |
| `idle_breathe` |  | Very slow scale breathing, nothing else. |
| `idle_curious` |  | Head tilt with one eye slightly taller — “hm?” |
| `idle_look_around` |  | Glances left, holds, then right, then back to centre. |
| `idle_wiggle` |  | Playful counter-rotating wiggle with little hops. |
| `whistle` |  | Innocent whistling, eyes up and away. |

### Sleep loops

| Clip | Enter → Exit | What it looks like |
|---|---|---|
| `doze` | fall_asleep → wake_stretch | Nodding off: head drops, jerks back, drops again. |
| `sleep` | fall_asleep → wake_stretch | Asleep. Slow rise and fall, floating z’s. |

### Voice loops

| Clip | Enter → Exit | What it looks like |
|---|---|---|
| `listen` |  | Eyes widen, lean in, sound waves pulse either side. |
| `listen_lean` |  | Stronger lean toward the user, one eye taller. |
| `speak` |  | Syllable-rate height flicker with gentle nodding. |
| `speak_calm` |  | Soft-spoken: relaxed lids, minimal motion. |
| `speak_excited` |  | Happy shape, bigger bounce, brighter glow. |

### Thinking loops

| Clip | Enter → Exit | What it looks like |
|---|---|---|
| `idea_think` |  | Up-left daydream — the idle idea scout. |
| `think` |  | Eyes up-right, lids relaxed, three thinking dots. |
| `think_hard` |  | Squinted, eyes rocking, a gear turns. |

### Planning loops

| Clip | Enter → Exit | What it looks like |
|---|---|---|
| `compile` |  | Progress bar fills, squint deepens, tiny shake at 100%. |
| `plan` | plan_start → plan_end | Reads down a checklist, boxes tick over time. |
| `plan_subagents` | plan_start → plan_end | Design/Tech/Art/QA agent orbs light up in turn while the clipboard fills. |

### Working loops

| Clip | Enter → Exit | What it looks like |
|---|---|---|
| `fix` | work_start → work_end | Wrench cranks, small determined jolts. |
| `read` | work_start → work_end | Reads lines across an open book. |
| `scan` |  | Inspect mode: a laser line sweeps, eyes follow it. |
| `search` |  | Magnifier roams, one eye enlarged behind it. |
| `typing` | work_start → work_end | Rapid code typing: line-by-line scan, caret tick, keys light up. |
| `work` | work_start → work_end | Focused build loop with a turning gear. |
| `write` | work_start → work_end | Eyes track a pencil writing line after line. |

### Review-committee loops

| Clip | Enter → Exit | What it looks like |
|---|---|---|
| `judge` |  | Judge: level gaze, balance scale tips back and forth. |
| `review_neg` |  | Pessimist: cold hue, narrowed eyes, thumbs down. |
| `review_pos` |  | Optimist: warm hue, happy eyes, thumbs up. |

### Music loops (headset on/off transitions)

| Clip | Enter → Exit | What it looks like |
|---|---|---|
| `music_bounce` | headset_on → headset_off | Squash-and-stretch hop every beat. |
| `music_dj` | headset_on → headset_off | DJ: hand on the cup, head tilted, scratch wobble, equalizer. |
| `music_eyes_closed` | headset_on → headset_off | Eyes closed, lost in it. |
| `music_headbang` | headset_on → headset_off | Hard nods, eyes squeezed. |
| `music_love` | headset_on → headset_off | Heart eyes — this song is a favourite. |
| `music_paused` | headset_on → headset_off | Paused but still wearing the headset, waiting. |
| `music_shuffle` | headset_on → headset_off | Side-step shuffle, eyes roll with the steps. |
| `music_sway` | headset_on → headset_off | Slow wide sway, dreamy lids. |
| `music_vibe` | headset_on → headset_off | Default vibe: sways side to side, bounces on the beat. |

### State loops

| Clip | Enter → Exit | What it looks like |
|---|---|---|
| `confused` |  | Uneven eyes, tilt, floating question mark. |
| `error` |  | X eyes, red tint, brief shake, exclamation. |
| `gamepad` |  | Watching a playtest: gamepad, darting eyes. |
| `loading` |  | Watching a clock tick. |
| `locked` |  | Shield up, guarded look. |
| `offline` |  | Dim, half-closed, unplugged. |
| `waiting_consent` |  | Big hopeful eyes, waiting for a yes/no. |

### One-shot reactions

| Clip | Enter → Exit | What it looks like |
|---|---|---|
| `alert` |  | Attention flash. |
| `angry` |  | Angry slant, trembling. |
| `annoyed` |  | Half-lidded, looking away. |
| `approve` |  | Verdict pass: nodding bounce. |
| `blink` |  | Standard blink. |
| `bounce_in` |  | Drops in from above and bounces. |
| `bow` |  | Polite bow. |
| `bug_fixed` |  | Bug squashed, check mark. |
| `bug_found` |  | Spots a bug — startled. |
| `celebrate` |  | Confetti party, rainbow hue. |
| `compact_memory` |  | Compacting memory — brain + gear. |
| `connected` |  | Engine connected. |
| `countdown` |  | Three-second pulse countdown. |
| `cry` |  | Tears streaming. |
| `disapprove` |  | Verdict redo: head shake. |
| `disconnected` |  | Engine lost. |
| `dizzy` |  | Eyes spiral, stars orbit. |
| `double_blink` |  | Two quick blinks. |
| `electric` |  | Zapped. |
| `eureka` |  | Star eyes, bulb and sparks. |
| `facepalm` |  | Hand over eye, slow shake. |
| `fail` |  | Red cross, eyes sink. |
| `fall_asleep` |  | Lids slowly sink, eyes drift down, glow dims. |
| `forget` |  | Deletes a memory. |
| `giggle` |  | Suppressed giggle. |
| `glitch` |  | Digital glitch. |
| `greet` |  | Hello wave. |
| `happy` |  | Happy hops. |
| `headset_off` |  | Takes the headset off — lifts up and away, shakes hair out, settles. |
| `headset_on` |  | Headset drops down from above, lands with a small bounce, happy blink. |
| `hide` |  | Ducks out of view. |
| `hmm` |  | Short pensive “hmm” with tilt. |
| `idea` |  | Lightbulb pops on. |
| `jump` |  | Jump. |
| `laugh` |  | Laughing shake. |
| `look_down` |  | Glance down, lids follow. |
| `look_left` |  | Glance left and back. |
| `look_right` |  | Glance right and back. |
| `look_up` |  | Glance up and back. |
| `love` |  | Heart eyes with floating hearts. |
| `mode_build` |  | Switched to Build mode: wrench spin, focused eyes. |
| `mode_plan` |  | Switched to Plan mode: clipboard peeks up. |
| `music_drop` |  | Beat drop: slam down, rainbow flash, sparks. |
| `music_next` |  | Skip: quick swing to the right. |
| `music_prev` |  | Previous: quick swing to the left. |
| `music_volume_down` |  | Volume down: eyes narrow, speaker icon sinks. |
| `music_volume_up` |  | Volume up: eyes widen, speaker icon rises. |
| `nod` |  | Yes nod. |
| `ok_sign` |  | Quick OK check. |
| `peek` |  | Peeks up from below. |
| `plan_end` |  | Clipboard drops away, eyes come back up. |
| `plan_start` |  | Clipboard slides up from below. |
| `playtest_ask` |  | Asks permission to playtest. |
| `pop` |  | Pop in from nothing. |
| `proud` |  | Chest-out proud, sparkles. |
| `rain_cloud` |  | Sulks under a raining cloud. |
| `remember` |  | Stores a memory — brain glows. |
| `roll_eyes` |  | Eye-roll arc, lids settle half-way. |
| `sad` |  | Droopy sad eyes. |
| `scared` |  | Tall scared eyes, shivering. |
| `shake_head` |  | No shake. |
| `shield_block` |  | Safety layer blocked something. |
| `shiver` |  | Cold shiver. |
| `shocked` |  | Tiny dot pupils, trembling. |
| `shy` |  | Looks down and away, pinkish. |
| `side_eye` |  | Suspicious side-eye with one lid half-down. |
| `sigh` |  | Inhale up, exhale down. |
| `slow_blink` |  | Slow contented blink. |
| `smug` |  | Smug half-lids. |
| `sneeze` |  | Ah… ah… choo. |
| `spin` |  | Quick 360. |
| `squint_focus` |  | Narrowed, focused stare. |
| `stretch` |  | Tall stretch with eyes shut. |
| `success` |  | Green check draws in. |
| `surprised` |  | Round wide eyes, pop up. |
| `thumbs_up` |  | Thumbs up. |
| `tilt_left` |  | Head tilt left. |
| `tilt_right` |  | Head tilt right. |
| `tool_call` |  | Flash of glow as a tool is invoked. |
| `tool_result` |  | Small upward glance as the result lands. |
| `victory_spin` |  | 360° spin with squash & stretch, proud landing. |
| `wake` |  | Quick wake: lids open, eyes grow to full size. |
| `wake_stretch` |  | Morning routine: lids open, tall stretch, shake-off, blink. |
| `wake_word` |  | Heard “Nex”: snap to attention, pop bigger. |
| `wink` |  | Right-eye wink. |
| `wink_left` |  | Left-eye wink. |
| `work_end` |  | Tools go down, eyes lift, satisfied blink. |
| `work_start` |  | Roll shoulders, drop the gaze to the desk. |
| `yawn` |  | Long yawn stretch. |
| `zoom_in` |  | Leans in — eyes grow and narrow. |

**State → default loop:** idle→`idle`, thinking→`think`, working→`work`, reviewing→`judge`, speaking→`speak`, listening→`listen`, music→`music_vibe`, error→`error`, sleep→`sleep`, offline→`offline`, planning→`plan_subagents`

**Idle fidget pool:** `blink` `double_blink` `look_left` `look_right` `look_up` `tilt_left` `tilt_right` `slow_blink` `hmm` `stretch` `idle_look_around` `roll_eyes` `yawn` `wink` `peek` `whistle` `side_eye` `heartbeat` `idle_curious` `idle_wiggle`

**Music variants (rotate every 14 s):** `music_vibe` `music_headbang` `music_sway` `music_bounce` `music_eyes_closed` `music_shuffle` `music_love` `music_dj`
