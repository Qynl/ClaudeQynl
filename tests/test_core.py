import asyncio, sys, json, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from nex.core.mcp import MCPManager
from nex.core.safety import check_tool_call

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
        async def chat(self, messages, tools=None, json_mode=False, temperature=None):
            sys_p=messages[0]["content"]
            if json_mode:
                if "PLANNER" in sys_p: return {"content":json.dumps({"title":"T","phases":[{"name":"P1","tasks":[{"title":"make baseplate","detail":"d","acceptance":"a"},{"title":"make script","detail":"d","acceptance":"a"}]}]}),"tool_calls":[]}
                if "OPTIMIST" in sys_p: return {"content":json.dumps({"score":8,"verdict":"pass"}),"tool_calls":[]}
                if "PESSIMIST" in sys_p: return {"content":json.dumps({"score":6,"verdict":"pass","problems":[]}),"tool_calls":[]}
                if "JUDGE" in sys_p: return {"content":json.dumps({"verdict":"pass","reason":"fine","fix_instructions":"","note_for_memory":"baseplate is 512x512"}),"tool_calls":[]}
                return {"content":"{}","tool_calls":[]}
            # builder
            if messages[-1]["role"]=="tool": return {"content":"DONE: built it","tool_calls":[]}
            return {"content":"","tool_calls":[{"function":{"name":"fake__run_code","arguments":{"command":"Instance.new('Part')"}}}]}
        async def json(self, system, user, temperature=0.3):
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
    await nx.start_build("obby game")
    await asyncio.wait_for(nx._build_task, 20)
    pr=nx.plan.progress(); assert pr["done"]==2, pr
    assert nx.plan.plan["status"]=="done"
    assert "baseplate is 512x512" in nx.mem.state["notes"]
    kinds=[e for e,_ in events]; assert "review" in kinds and "tool" in kinds and "plan" in kinds
    await m.close_all(); nx._idle_task.cancel()
    import shutil; shutil.rmtree(tmp)
    print("agent loop ok (2/2 tasks, reviewed, memory note stored)")

test_safety(); asyncio.run(test_mcp()); asyncio.run(test_agent_loop())
