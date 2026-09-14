"""
Compact engine knowledge injected into the builder — the single biggest quality lever for a 20b model.
Kept short on purpose: every token here is paid on every builder call.
"""

ROBLOX = """ROBLOX STUDIO (Edit mode, run_code executes Luau as a plugin-level command):
STRUCTURE
- Services: game:GetService("Workspace"|"ServerScriptService"|"ServerStorage"|"ReplicatedStorage"|"StarterGui"|"StarterPlayer"|"Players"|"Lighting"|"SoundService"|"Teams").
- Server logic -> Script in ServerScriptService. Client logic -> LocalScript in StarterPlayerScripts or inside a ScreenGui in StarterGui. Shared code -> ModuleScript in ReplicatedStorage.
- Client<->server ONLY via RemoteEvent/RemoteFunction in ReplicatedStorage. Never trust the client: validate on server.
- Organise: Workspace/Map (folders per zone), ReplicatedStorage/Remotes, ReplicatedStorage/Modules, ServerStorage/Templates.
- Reuse: check `if Folder:FindFirstChild(name) then` before creating — tasks may re-run. Idempotent code always.
BUILDING
- local p = Instance.new("Part"); p.Anchored = true; p.Size = Vector3.new(..); p.CFrame = CFrame.new(..); p.Material = Enum.Material.SmoothPlastic; p.Color = Color3.fromRGB(..); p.Name = "..."; p.Parent = folder.
- Use Anchored=true for all static geometry. Use CanCollide correctly. Use Attributes (obj:SetAttribute) for tuning data.
- Scripts: local s = Instance.new("Script"); s.Name=...; s.Source = [==[ ... ]==]; s.Parent = ... (use [==[ ]==] so inner [[ ]] is safe).
- Write full, working scripts — no "TODO", no placeholders. Handle player join/leave, CharacterAdded, respawns.
- Data: DataStoreService with pcall + retry, save on PlayerRemoving and BindToClose, leaderstats folder for the leaderboard.
- UI: ScreenGui in StarterGui, Frames with UICorner/UIStroke/UIPadding/UIListLayout, TextLabel with TextScaled, AnchorPoint 0.5 for centring, tween with TweenService.
- Animation: create KeyframeSequence in ServerStorage OR animate parts procedurally with TweenService (safe in Edit mode, no upload needed). For characters use Animator:LoadAnimation with an Animation whose AnimationId is a known catalog id only if the user gave one.
- Sound: Sound instance with SoundId="rbxassetid://<id>" only with ids you know are valid; otherwise leave SoundId empty and name it so the user can fill it.
- Lighting/atmosphere: Lighting.Technology, Atmosphere, Bloom, ColorCorrection give cheap polish.
- Monetization: MarketplaceService ProcessReceipt for dev products, GamePassService checks — write code but leave IDs as Attributes for the user to fill.
- Mark undo points: game:GetService("ChangeHistoryService"):SetWaypoint("Nex: <task>") at end of each build call.
VERIFY (read-only) e.g.
  local f = workspace:FindFirstChild("Map"); print("Map:", f and #f:GetDescendants() or "MISSING")
  local s = game.ServerScriptService:FindFirstChild("GameManager"); print("Script ok:", s and #s.Source > 200)
COMMON MISTAKES TO AVOID: forgetting .Parent; setting Position before Anchored; using wait() (use task.wait()); using LocalScripts on the server; string keys with spaces; nested [[ ]] in Source; assuming a previous call's local variables still exist (they don't — every run_code is a fresh script)."""

UNREAL = """UNREAL ENGINE 5 (via MCP tools the server exposes — read tool descriptions; typical: spawn_actor, set_actor_transform, create_blueprint, add_component_to_blueprint, set_property, compile_blueprint, create_material, focus_viewport, get_actors_in_level):
- Build levels from StaticMeshActors with engine basic shapes (/Engine/BasicShapes/Cube.Cube etc.) when no assets exist.
- Gameplay -> Blueprints: create BP from Actor/Character/GameMode, add components, set defaults, compile. Keep node graphs small; prefer many small BPs.
- Always verify with get_actors_in_level / find_actors_by_name after building.
- Never use console-command or python-exec style tools."""

LUAU_LINT_HINTS = """If the tool output contains 'NEX_ERROR' or a Lua error (e.g. 'attempt to index nil', 'expected', 'unexpected symbol'), fix the code and run again before reporting."""
