"""
Luau pre-flight for gpt-oss output — runs BEFORE code is sent to Roblox Studio.

A 20b model's failures are predictable: hallucinated APIs, unbalanced blocks, deprecated calls,
forgetting .Parent, nested [[ ]] inside Source strings. Catching those locally costs 0 ms of GPU time,
whereas a round-trip through Studio + a re-prompt costs 20-60 s. Each rejection returns a concrete,
machine-readable reason the builder can act on in one shot.
"""
from __future__ import annotations
import re

# ---- services / members that exist (subset large enough for game building) -----------------
SERVICES = {
    "Workspace", "Players", "ReplicatedStorage", "ServerStorage", "ServerScriptService", "StarterGui", "StarterPack",
    "StarterPlayer", "Lighting", "SoundService", "TweenService", "RunService", "DataStoreService", "MarketplaceService",
    "Teams", "Debris", "CollectionService", "PhysicsService", "UserInputService", "ContextActionService",
    "PathfindingService", "TextService", "BadgeService", "GamePassService", "ChangeHistoryService", "Selection",
    "InsertService", "ProximityPromptService", "TeleportService", "Chat", "TextChatService", "GuiService",
    "ContentProvider", "LocalizationService", "SocialService", "GroupService", "HapticService", "VRService", "AssetService",
}
# frequently hallucinated / forbidden
BAD_SERVICES = {"HttpService", "HttpRbxApiService", "MessagingService", "ScriptContext", "CoreGui", "StudioService", "PluginGuiService", "LogService"}

DEPRECATED = {
    r"\bwait\s*\(": "use task.wait()",
    r"\bspawn\s*\(": "use task.spawn()",
    r"\bdelay\s*\(": "use task.delay()",
    r"\.connect\s*\(": "use :Connect() (capital C, colon)",
    r":connect\s*\(": "use :Connect()",
    r"\bBodyVelocity\b|\bBodyPosition\b|\bBodyGyro\b": "use LinearVelocity / AlignPosition / AlignOrientation",
    r"\bFindFirstChild\s*\(\s*['\"][^'\"]+['\"]\s*,\s*true\s*\)\s*==\s*nil\b": "ok but prefer FindFirstChild(name, true) ~= nil",
    r"\.Character\.Humanoid\b": "use Character:FindFirstChildOfClass('Humanoid') (may not exist yet)",
    r"\bInstance\.new\s*\(\s*['\"][^'\"]+['\"]\s*,\s*[^)]+\)": "Instance.new(className, parent) is deprecated; set .Parent last",
    r"\bgame\.Workspace\.Camera\b": "use workspace.CurrentCamera",
    r"\bGetPlayerFromCharacter\s*\(\s*hit\s*\)": "use hit.Parent (hit is a BasePart)",
    r"\bHumanoid\.Health\s*=\s*0\b": "ok",
}

# Instance class names that exist (to catch e.g. "RectangleLabel", "UIButton", "MeshPart3D")
CLASSES = {
    "Part", "MeshPart", "WedgePart", "CornerWedgePart", "TrussPart", "SpawnLocation", "Seat", "VehicleSeat", "Model", "Folder",
    "Script", "LocalScript", "ModuleScript", "RemoteEvent", "RemoteFunction", "BindableEvent", "BindableFunction",
    "ScreenGui", "SurfaceGui", "BillboardGui", "Frame", "ScrollingFrame", "TextLabel", "TextButton", "TextBox", "ImageLabel",
    "ImageButton", "ViewportFrame", "CanvasGroup", "UICorner", "UIStroke", "UIPadding", "UIListLayout", "UIGridLayout",
    "UITableLayout", "UIPageLayout", "UIAspectRatioConstraint", "UISizeConstraint", "UITextSizeConstraint", "UIGradient", "UIScale",
    "Sound", "SoundGroup", "ParticleEmitter", "Beam", "Trail", "Attachment", "PointLight", "SpotLight", "SurfaceLight", "Fire",
    "Smoke", "Sparkles", "Highlight", "Decal", "Texture", "SelectionBox", "Atmosphere", "Sky", "Bloom", "BlurEffect", "ColorCorrectionEffect",
    "SunRaysEffect", "DepthOfFieldEffect", "Clouds", "Humanoid", "HumanoidDescription", "Animation", "AnimationController", "Animator",
    "KeyframeSequence", "Keyframe", "Pose", "Motor6D", "Weld", "WeldConstraint", "HingeConstraint", "RopeConstraint", "SpringConstraint",
    "PrismaticConstraint", "AlignPosition", "AlignOrientation", "LinearVelocity", "AngularVelocity", "VectorForce", "Torque",
    "ProximityPrompt", "ClickDetector", "Tool", "Accessory", "Team", "IntValue", "NumberValue", "StringValue", "BoolValue", "ObjectValue",
    "CFrameValue", "Vector3Value", "Color3Value", "Configuration", "Camera", "Terrain", "NoCollisionConstraint", "BodyColors", "Shirt", "Pants",
    "Dialog", "DialogChoice", "Backpack", "PlayerGui", "StarterGear", "Explosion", "ForceField", "Handles", "ArcHandles", "TextChatCommand",
}

MATERIALS = {"Plastic", "SmoothPlastic", "Neon", "Wood", "WoodPlanks", "Marble", "Slate", "Concrete", "Granite", "Brick", "Pebble", "Cobblestone",
             "Rock", "Sandstone", "Basalt", "CrackedLava", "Limestone", "Pavement", "CorrodedMetal", "DiamondPlate", "Foil", "Metal", "Grass",
             "LeafyGrass", "Sand", "Fabric", "Snow", "Mud", "Ground", "Asphalt", "Salt", "Ice", "Glacier", "Glass", "ForceField", "Air", "Water", "Cardboard", "Carpet", "CeramicTiles", "ClayRoofTiles", "RoofShingles", "Leather", "Plaster", "Rubber"}


class Issue:
    def __init__(self, severity: str, msg: str):
        self.severity = severity  # 'error' | 'warn'
        self.msg = msg

    def __repr__(self):
        return f"{self.severity.upper()}: {self.msg}"


def _strip_strings_and_comments(src: str) -> str:
    src = re.sub(r"--\[(=*)\[.*?\]\1\]", " ", src, flags=re.S)
    src = re.sub(r"--[^\n]*", " ", src)
    src = re.sub(r"\[(=*)\[.*?\]\1\]", '""', src, flags=re.S)
    src = re.sub(r'"(?:\\.|[^"\\\n])*"', '""', src)
    src = re.sub(r"'(?:\\.|[^'\\\n])*'", "''", src)
    return src


def check_block_balance(code: str) -> Issue | None:
    body = _strip_strings_and_comments(code)
    openers = len(re.findall(r"\b(function|if|for|while|do)\b", body))
    # 'do' after for/while shouldn't double count; 'if ... then' uses end; 'repeat' uses until
    fors = len(re.findall(r"\b(for|while)\b", body))
    dos = len(re.findall(r"\bdo\b", body))
    openers -= min(fors, dos)  # each for/while has its own do
    # elseif doesn't open a new block
    openers -= len(re.findall(r"\belseif\b", body)) * 0  # elseif counted as 'if'? our regex matches 'if' inside 'elseif' word? no: \bif\b won't match inside elseif
    ends = len(re.findall(r"\bend\b", body))
    repeats = len(re.findall(r"\brepeat\b", body)); untils = len(re.findall(r"\buntil\b", body))
    if openers != ends:
        return Issue("error", f"unbalanced blocks: {openers} openers (function/if/for/while/do) vs {ends} 'end'")
    if repeats != untils:
        return Issue("error", "repeat without until")
    if body.count("(") != body.count(")"):
        return Issue("error", "unbalanced parentheses")
    if body.count("{") != body.count("}"):
        return Issue("error", "unbalanced braces")
    return None


def check(code: str, read_only: bool = False) -> list[Issue]:
    issues: list[Issue] = []
    if not code.strip():
        return [Issue("error", "empty code")]
    if (b := check_block_balance(code)):
        issues.append(b)

    # nested long strings inside Source = [[ ... [[ ]] ... ]]
    for m in re.finditer(r"\.Source\s*=\s*\[\[(.*?)\]\]", code, flags=re.S):
        if "[[" in m.group(1):
            issues.append(Issue("error", "nested [[ ]] inside .Source — wrap the outer string with [==[ ... ]==]"))

    # services
    for m in re.finditer(r'GetService\s*\(\s*["\']([A-Za-z]+)["\']\s*\)', code):
        svc = m.group(1)
        if svc in BAD_SERVICES:
            issues.append(Issue("error", f"{svc} is not allowed"))
        elif svc not in SERVICES:
            issues.append(Issue("error", f"unknown service '{svc}' (hallucinated?)"))
    for m in re.finditer(r"\bgame\.([A-Z][A-Za-z]+)\b", code):
        if m.group(1) in BAD_SERVICES:
            issues.append(Issue("error", f"game.{m.group(1)} is not allowed"))

    # classes
    for m in re.finditer(r'Instance\.new\s*\(\s*["\']([A-Za-z0-9]+)["\']', code):
        if m.group(1) not in CLASSES:
            issues.append(Issue("error", f"Instance.new('{m.group(1)}') — no such class"))
    # materials
    for m in re.finditer(r"Enum\.Material\.([A-Za-z]+)", code):
        if m.group(1) not in MATERIALS:
            issues.append(Issue("error", f"Enum.Material.{m.group(1)} does not exist"))
    # colour ranges
    for m in re.finditer(r"Color3\.fromRGB\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)", code):
        if any(float(x) > 255 for x in m.groups()):
            issues.append(Issue("error", "Color3.fromRGB values must be 0-255"))
    for m in re.finditer(r"Color3\.new\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)", code):
        if any(float(x) > 1 for x in m.groups()):
            issues.append(Issue("error", "Color3.new takes 0-1 floats; use Color3.fromRGB for 0-255"))

    # deprecated
    for pat, hint in DEPRECATED.items():
        if hint != "ok" and re.search(pat, code):
            issues.append(Issue("warn", f"'{re.search(pat, code).group(0).strip()}' — {hint}"))

    # forgot .Parent on created instances
    created = re.findall(r"\blocal\s+([A-Za-z_]\w*)\s*=\s*Instance\.new\(", code)
    for var in created:
        if not re.search(rf"\b{var}\.Parent\s*=", code) and not re.search(rf"\b{var}\b\s*\)", code):
            issues.append(Issue("warn", f"'{var}' is created but never parented (.Parent missing)"))

    # scripts written with empty/placeholder source
    for m in re.finditer(r"\.Source\s*=\s*\[=*\[(.*?)\]=*\]", code, flags=re.S):
        body = m.group(1)
        if len(body.strip()) < 40:
            issues.append(Issue("error", "script Source is nearly empty — write the full script"))
        if re.search(r"\bTODO\b|\.\.\.\s*$|placeholder|your code here", body, flags=re.I | re.M):
            issues.append(Issue("error", "script Source contains a TODO/placeholder — write real code"))

    # confirmation print
    if not read_only and "NEX_OK" not in code and "print(" not in code:
        issues.append(Issue("warn", "no print(): end with print('NEX_OK ...') so the result can be verified"))

    # read-only violations
    if read_only and re.search(r"Instance\.new|:Destroy\(|\.Parent\s*=|:Clone\(|\.Source\s*=|:SetAttribute\(|\.CFrame\s*=|\.Position\s*=", code):
        issues.append(Issue("error", "read-only mode: this code mutates the place"))
    return issues


def summarize(issues: list[Issue]) -> tuple[bool, str]:
    errs = [i for i in issues if i.severity == "error"]
    warns = [i for i in issues if i.severity == "warn"]
    ok = not errs
    lines = [f"- {i.msg}" for i in errs] + [f"- (warn) {i.msg}" for i in warns]
    return ok, "\n".join(lines)


# ---- helpers the agent can wrap around user code ------------------------------------------
def wrap_for_studio(code: str, label: str) -> str:
    """Wrap a build snippet: pcall + traceback + undo waypoint. Output is stable & machine-readable."""
    safe_label = label.replace("]", ")").replace("[", "(")[:60]
    return f"""local __ok, __err = pcall(function()
{code}
end)
if __ok then
  pcall(function() game:GetService("ChangeHistoryService"):SetWaypoint("Nex: {safe_label}") end)
else
  print("NEX_ERROR " .. tostring(__err))
end"""


VERIFY_SNIPPETS = {
    "tree": """local function tree(inst, depth, out) depth = depth or 0; out = out or {}; if depth > 2 then return out end
for _, c in ipairs(inst:GetChildren()) do table.insert(out, string.rep("  ", depth) .. c.ClassName .. " " .. c.Name); tree(c, depth + 1, out) end return out end
print(table.concat(tree({ROOT}), "\\n"))""",
    "script_len": """local s = {PATH}; print("SCRIPT", s and s.Name, s and #s.Source or -1)""",
}
