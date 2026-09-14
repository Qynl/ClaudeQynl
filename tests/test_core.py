import os
import asyncio, sys, json, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from nex.core.mcp import MCPManager
from nex.core.safety import check_tool_call
from nex.core import luau as LU

def test_luau():
    ok,_=LU.summarize(LU.check("local p = Instance.new('Part'); p.Parent = workspace; print('NEX_OK')")); assert ok
    ok,msg=LU.summarize(LU.check("local h = game:GetService('HttpService'); local x = Instance.new('Sprite')")); assert not ok and "HttpService" in msg and "Sprite" in msg
    ok,msg=LU.summarize(LU.check("if x then print(1)")); assert not ok and "unbalanced" in msg
    ok,msg=LU.summarize(LU.check("print(workspace.Name)", read_only=True)); assert ok
    ok,msg=LU.summarize(LU.check("Instance.new('Part').Parent = workspace", read_only=True)); assert not ok
    w=LU.wrap_for_studio("print('NEX_OK x')","t"); assert "pcall" in w and "SetWaypoint" in w
    print("luau preflight ok")

def test_safety():
    assert check_tool_call("r","run_code",{"command":"print(1)"},False).allowed
    assert not check_tool_call("r","run_code",{"command":"game:GetService('HttpService'):GetAsync('x')"},False).allowed
    assert not check_tool_call("r","read_file",{},False).allowed
    assert not check_tool_call("r","execute_command",{},False).allowed
    v=check_tool_call("r","start_playtest",{},False); assert not v.allowed and v.needs_user_consent
    assert check_tool_call("r","start_playtest",{},True).allowed
    print("safety ok")

async def test_mcp():
    m=MCPManager()
    await m.load({"fake":{"transport":"stdio","command":sys.executable,"args":[str(pathlib.Path(__file__).parent/"fake_mcp.py")]}})
    st=m.status(); assert st[0]["connected"], st
    assert "run_code" in st[0]["tools"]
    r=await m.call("fake__run_code",{"command":"print('hi')"}); assert not r["blocked"] and "ok run_code" in r["text"], r
    r=await m.call("fake__read_file",{}); assert r["blocked"]
    r=await m.call("fake__run_code",{"command":"os.execute('rm -rf /')"}); assert r["blocked"]
    r=await m.call("fake__start_playtest",{}); assert r["blocked"] and r["needs_user_consent"]
    tools=m.ollama_tools(); assert any(t["function"]["name"]=="fake__run_code" for t in tools)
    await m.close_all(); print("mcp ok")

async def test_agent_loop():
    """Mock the LLM: planner returns 1 phase / 2 tasks, builder uses a tool then says DONE, reviewers pass."""
    from nex.core import agent as ag
    from nex.core.music import AmazonMusic
    events=[]
    async def emit(e,d): events.append((e,d))
    class FakeLLM:
        num_ctx=8192
        async def chat(self, messages, tools=None, json_mode=False, temperature=None, **kw):
            sys_p=messages[0]["content"]
            if json_mode:
                if "GAME DESIGNER" in sys_p: return {"content":json.dumps({"title":"T","pitch":"p","core_loop":["a"],"systems":[{"name":"Spawn"}]}),"tool_calls":[]}
                if "TECHNICAL ARCHITECT" in sys_p: return {"content":json.dumps({"engine":"roblox","folders":{"map":"Map"},"remotes":[{"name":"Buy"}]}),"tool_calls":[]}
                if "ART DIRECTOR" in sys_p: return {"content":json.dumps({"palette":{"sky":"1,2,3"}}),"tool_calls":[]}
                if "QA LEAD" in sys_p: return {"content":json.dumps({"playtest_script":["walk"]}),"tool_calls":[]}
                if "PRODUCER" in sys_p: return {"content":json.dumps({"phases":[{"name":"P1","tasks":[{"title":"make baseplate","detail":"d","acceptance":"a"},{"title":"make script","detail":"d","acceptance":"a"}]}]}),"tool_calls":[]}
                if "PLAN JUDGE" in sys_p: return {"content":json.dumps({"verdict":"approve"}),"tool_calls":[]}
                if "VERTICAL SLICE:" in sys_p: return {"content":json.dumps({"phases":[{"name":"Vertical slice","goal":"g","tasks":[{"title":"slice area","kind":"asset","detail":"d","acceptance":"a","depends_on":[],"est_calls":1}]}]}),"tool_calls":[]}
                if "CREATIVE DIRECTOR" in sys_p: return {"content":json.dumps({"greenlight":True,"score":8,"what_works":[],"must_change_before_scaling":[],"extra_tasks":[]}),"tool_calls":[]}
                if "LENS" in sys_p: return {"content":json.dumps({"score":8,"problems":[],"must_fix":[],"verdict":"pass"}),"tool_calls":[]}
                if "RELEASE MANAGER" in sys_p: return {"content":"release ok","tool_calls":[]}
                if "plan reviewer" in sys_p: return {"content":json.dumps({"score":7}),"tool_calls":[]}
                if "OPTIMIST" in sys_p: return {"content":json.dumps({"score":8,"verdict":"pass"}),"tool_calls":[]}
                if "PESSIMIST" in sys_p: return {"content":json.dumps({"score":6,"verdict":"pass","problems":[],"must_fix":[]}),"tool_calls":[]}
                if "JUDGE" in sys_p: return {"content":json.dumps({"verdict":"pass","reason":"fine","fix_instructions":"","note_for_memory":"baseplate is 512x512"}),"tool_calls":[]}
                return {"content":"{}","tool_calls":[]}
            # builder: 1) build 2) verify 3) DONE
            tool_msgs=[m for m in messages if m["role"]=="tool"]
            if len(tool_msgs)>=2: return {"content":"DONE: built it","tool_calls":[]}
            if len(tool_msgs)==1: return {"content":"","tool_calls":[{"function":{"name":"fake__run_code","arguments":{"command":"print('Part count', #workspace:GetChildren())"}}}]}
            return {"content":"","tool_calls":[{"function":{"name":"fake__run_code","arguments":{"command":"local p = Instance.new('Part')\np.Parent = workspace\nprint('NEX_OK part')"}}}]}
        async def json(self, system, user, temperature=0.3, **kw):
            from nex.core.llm import parse_json_loose
            r=await self.chat([{"role":"system","content":system},{"role":"user","content":user}],json_mode=True); return parse_json_loose(r["content"])
        async def stream(self,*a,**k):
            yield "hi"
    m=MCPManager()
    await m.load({"fake":{"transport":"stdio","command":sys.executable,"args":[str(pathlib.Path(__file__).parent/"fake_mcp.py")]}})
    # isolate data dir
    import nex.core.memory as mem
    tmp=pathlib.Path(__file__).parent/"_tmpdata"; tmp.mkdir(exist_ok=True); mem.DATA=tmp
    nx=ag.Nex(FakeLLM(), m, AmazonMusic(), emit, {"proactive":False})
    nx.mem.path=tmp/"m.json"; nx.plan.path=tmp/"p.json"; nx.plan.plan={"goal":"","phases":[],"status":"idle","log":[]}
    # plan mode: produces a plan but does not build
    await nx.start_planning("obby game")
    assert nx.plan.plan["status"]=="planned" and nx._build_task is None, nx.plan.plan["status"]
    assert nx.plan.plan["gdd"]["design"]["title"]=="T" and nx.plan.plan["meta"]["naming"]["remotes"]==["Buy"]
    # switch to build and go
    await nx.set_mode("build"); nx._start_loop()
    await asyncio.wait_for(nx._build_task, 20)
    if os.environ.get("NEX_TRACE"): print("STATUS",nx.plan.plan["status"],"LOG",nx.plan.plan["log"][-5:],"MSG",[e for e in events if e[0]=="message"][-3:], "PHASES",[(p["name"],[t.get("status") for t in p["tasks"]]) for p in nx.plan.plan["phases"]])
    assert len(nx.ledger)>=9, nx.ledger
    pr=nx.plan.progress(); assert pr["done"]==pr["total"] and pr['total']>=9, pr
    assert nx.plan.plan['phases'][0]['gate']=='slice' and nx.plan.plan['phases'][-1]['name'].startswith('Polish')
    assert nx.plan.plan.get('slice_review',{}).get('greenlight') is True
    assert nx.plan.plan["status"]=="done"
    # fast-agreement path skips the judge -> the ledger carries the facts instead
    assert any("built it" in x for x in nx.ledger), nx.ledger
    kinds=[e for e,_ in events]; assert "review" in kinds and "tool" in kinds and "plan" in kinds
    await m.close_all(); nx._idle_task.cancel()
    import shutil; shutil.rmtree(tmp)
    print("agent ok: pre-production -> planned -> build 2/2 tasks, reviewed, ledger + memory note stored")

test_luau(); test_safety(); asyncio.run(test_mcp()); asyncio.run(test_agent_loop())
