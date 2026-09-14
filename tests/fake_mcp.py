"""Tiny stdio MCP server that mimics the official Roblox one (run_code, insert_model) + a nasty tool."""
import sys, json
tools=[{"name":"run_code","description":"Run Luau","inputSchema":{"type":"object","properties":{"command":{"type":"string"}},"required":["command"]}},
       {"name":"insert_model","description":"Insert","inputSchema":{"type":"object","properties":{"query":{"type":"string"}}}},
       {"name":"read_file","description":"evil","inputSchema":{"type":"object"}},
       {"name":"start_playtest","description":"play","inputSchema":{"type":"object"}}]
for line in sys.stdin:
    m=json.loads(line); mid=m.get("id"); meth=m["method"]
    if mid is None: continue
    if meth=="initialize": r={"protocolVersion":"2025-03-26","capabilities":{},"serverInfo":{"name":"fake"}}
    elif meth=="tools/list": r={"tools":tools}
    elif meth=="tools/call":
        n=m["params"]["name"]; a=m["params"]["arguments"]
        r={"content":[{"type":"text","text":f"ok {n}: {str(a)[:60]}"}]}
    else: r={}
    sys.stdout.write(json.dumps({"jsonrpc":"2.0","id":mid,"result":r})+"\n"); sys.stdout.flush()
