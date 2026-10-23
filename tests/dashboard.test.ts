import {test,expect} from "bun:test";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {MetricsStore} from "../src/dashboard/store";
import {startProxy} from "../src/proxy/server";
import {CopilotClient} from "../src/proxy/copilot";
test("metrics filters apply to aggregates and history with inclusive start, exclusive end and bound model values",()=>{
  const store=new MetricsStore(":memory:"),now=Date.now(),base={at:now,model:"model-a",status:200,latency:100,input:10,output:3,tools:1,session:"one",body:{messages:[{role:"user",content:"private prompt"}]}};
  try {
    store.add({...base,id:"before",at:now-1});store.add({...base,id:"start"});store.add({...base,id:"limited",at:now+1,status:429,latency:900,tools:0});store.add({...base,id:"other",at:now+2,model:"model-b",input:50});store.add({...base,id:"end",at:now+100});
    const filter={from:now,to:now+100,model:"model-a",status:"error" as const},result=store.summary(90,now+200,filter);
    expect(result.totals.requests).toBe(1);expect(result.totals.input).toBe(10);expect(result.totals.p95).toBe(900);expect(result.totals.errorRate).toBe(1);expect(result.totals.toolRatio).toBe(0);
    expect(result.models).toHaveLength(1);expect((result.models[0] as any).model).toBe("model-a");expect((result.daily[0] as any).requests).toBe(1);expect((result.sessions as any).count).toBe(1);
    expect((store.recent(200,0,filter)[0] as any).id).toBe("limited");expect(store.recent(200,0,{...filter,status:"429"})).toHaveLength(1);
    expect(store.summary(90,now+200,{from:now,to:now+100,status:"success"}).totals.requests).toBe(2);
    expect(store.summary(90,now+200,{...filter,model:"' OR 1=1 --"}).totals.requests).toBe(0);
    expect(result.availableModels).toEqual(["model-a","model-b"]);expect(JSON.stringify(store.recent())).not.toContain("private prompt");
  } finally {store.close();}
});
test("rate-limit observation timestamp changes only when provider headers are received",async()=>{
  let limited=true;const auth:any={get:async()=>({token:"fixture",api:"https://api.individual.githubcopilot.com"})};
  const client=new CopilotClient(auth,(async()=>new Response("{}",{headers:limited?{"x-ratelimit-remaining":"4"}:{}})) as unknown as typeof fetch);
  expect(client.limitsObservedAt).toBeNull();await client.request("/models");expect(client.limitsObservedAt).toBeNumber();expect(client.observedLimits["x-ratelimit-remaining"]).toBe("4");
  const received=client.limitsObservedAt;limited=false;await client.request("/models");expect(client.limitsObservedAt).toBe(received);
});
test("SQLite WAL preserves redacted requests across restarts and prunes requests and refresh events",()=>{
  const dir=mkdtempSync(join(tmpdir(),"bridge-metrics-")),file=join(dir,"history.sqlite"),now=Date.now();let store=new MetricsStore(file);
  const row={id:"a",at:now,model:"fixture",status:200,latency:100,input:12,output:3,tools:1,session:"hashed",cacheRead:5,body:{messages:[{role:"user",content:"confidential fixture"}],authorization:"Bearer fixture-secret",tools:[{name:"private_tool",input_schema:{type:"object"}}]}};
  try{store.add(row);store.add({...row,id:"b",at:now+1000,latency:900,status:429,tools:0});store.refresh({at:now,ok:true});
    expect((store.db.query("PRAGMA journal_mode").get() as any).journal_mode).toBe("wal");store.close();store=new MetricsStore(file);
    const saved=JSON.stringify(store.recent());expect(saved).not.toContain("confidential fixture");expect(saved).not.toContain("fixture-secret");expect(saved).not.toContain("private_tool");expect(saved).toContain("redacted");
    const s=store.summary();expect(s.totals.requests).toBe(2);expect(s.totals.p50).toBe(100);expect(s.totals.p95).toBe(900);expect(s.totals.errorRate).toBe(.5);expect(s.totals.toolRatio).toBe(.5);expect(s.totals.cacheRead).toBe(10);expect((s.sessions as any).averageDurationMs).toBe(1000);
    store.prune(1,now+3*86400000);expect(store.recent()).toHaveLength(0);expect(store.events()).toHaveLength(0);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test("dashboard uses same-origin HttpOnly sessions and keeps management protected when model API key is disabled",async()=>{
  const listener=Bun.listen({hostname:"127.0.0.1",port:0,socket:{data(){}}}),port=listener.port;listener.stop(true);
  const auth:any={status:{login:"fixture"},models:async()=>({data:[]}),stop(){}};const store=new MetricsStore(":memory:");let saved:any;
  const proxy=await startProxy(auth,{port,key:"fixture-secret",models:{default:"copilot-auto"},retentionDays:90},{metrics:store,saveSettings:v=>{saved=v;}}),base=`http://127.0.0.1:${port}`;
  try{
    expect((await fetch(base+"/api/status")).status).toBe(401);const root=await fetch(base+"/");expect(root.headers.get("set-cookie")).toBeNull();expect(await root.text()).not.toContain("fixture-secret");
    expect((await fetch(base+"/api/session",{method:"POST"})).status).toBe(401);
    const token=new URLSearchParams(new URL(proxy.dashboardURL).hash.slice(1)).get("session")!;
    const handshake=await fetch(base+"/api/session",{method:"POST",headers:{Authorization:`Bearer ${token}`}}),cookie=handshake.headers.get("set-cookie")!;expect(cookie).toContain("HttpOnly");expect(cookie).toContain("SameSite=Strict");
    const headers={Cookie:cookie.split(";")[0]};expect((await fetch(base+"/api/status",{headers})).status).toBe(200);
    for(const query of ["from=-1","from=abc","from=100&to=99","from=0&to=8640000000000000","status=invalid"]){expect((await fetch(base+"/api/summary?"+query,{headers})).status).toBe(400);expect((await fetch(base+"/api/logs?"+query,{headers})).status).toBe(400);}
    store.add({id:"filtered",at:Date.now(),model:"test-model",status:429,latency:10,input:2,output:1,tools:0,session:"fixture"});
    const filtered=await fetch(base+"/api/summary?model=test-model&status=429",{headers});expect((await filtered.json() as any).totals.requests).toBe(1);
    const empty=await fetch(base+"/api/logs?model=other-model",{headers});expect((await empty.json() as any).requests).toHaveLength(0);
    expect((await fetch(base+"/api/status",{headers:{...headers,Origin:"https://foreign.invalid"}})).status).toBe(403);
    expect((await fetch(base+"/api/status",{headers:{...headers,Host:`foreign.invalid:${port}`}})).status).toBe(403);
    const settings={port:port+1,retentionDays:30,requireApiKey:false,models:Object.fromEntries(["default","sonnet","opus","haiku"].map(s=>[s,"copilot-auto"]))};
    let response=await fetch(base+"/api/settings",{method:"POST",headers,body:JSON.stringify(settings)});expect(response.status).toBe(200);expect((await response.json() as any).restartRequired).toBe(true);expect(saved.retentionDays).toBe(30);
    expect((await fetch(base+"/api/status")).status).toBe(401);expect((await fetch(base+"/api/summary",{headers})).status).toBe(200);
    response=await fetch(base+"/api/settings",{method:"POST",headers,body:JSON.stringify({...settings,models:{}})});expect(response.status).toBe(400);
  }finally{proxy.stop();store.close();}
});
