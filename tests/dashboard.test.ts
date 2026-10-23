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
test("yearly activity honors its range and filters while reporting retained-history coverage",async()=>{
  const listener=Bun.listen({hostname:"127.0.0.1",port:0,socket:{data(){}}}),port=listener.port;listener.stop(true);
  const now=Date.now(),from=now-15*86400000,to=now,inside=now-4*86400000;
  const auth:any={status:{login:"fixture"},models:async()=>({data:[]}),stop(){}};const store=new MetricsStore(":memory:");
  for(const row of [
    {id:"inside",at:inside,model:"fixture-model"},
    {id:"outside-range",at:now-40*86400000,model:"fixture-model"},
    {id:"other-model",at:now-3*86400000,model:"other-model"}
  ])store.add({...row,status:200,latency:10,input:2,output:1,tools:0,session:"fixture"});
  const proxy=await startProxy(auth,{port,key:"activity-fixture",models:{}},{metrics:store}),base=`http://127.0.0.1:${port}`,headers={Authorization:"Bearer activity-fixture"};
  try{
    await proxy.startup;
    const response=await fetch(`${base}/api/activity?from=${from}&to=${to}&model=fixture-model`,{headers}),activity=await response.json() as any;
    expect(response.status).toBe(200);expect(activity.days).toBe(365);expect(activity.totals.requests).toBe(1);
    expect(activity.daily).toHaveLength(1);expect(activity.coverageFrom).toBe(now-40*86400000);
    expect((await fetch(`${base}/api/activity?from=${to}&to=${from}`,{headers})).status).toBe(400);
  }finally{proxy.stop();store.close();}
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

test("local health and dashboard remain available when TLS blocks auth initialization",async()=>{
  const listener=Bun.listen({hostname:"127.0.0.1",port:0,socket:{data(){}}}),port=listener.port;listener.stop(true);
  const auth:any={status:{storage:"fixture",refreshEvents:[]},initialize:async()=>{throw new Error("unable to get local issuer certificate");},models:async()=>({data:[]}),stop(){}};
  const proxy=await startProxy(auth,{port,key:"tls-fixture",models:{}},{initializeAuth:()=>auth.initialize()}),base=`http://127.0.0.1:${port}`;
  try{
    await proxy.startup;
    const health=await fetch(base+"/health");expect(health.status).toBe(200);expect(await health.json()).toEqual({status:"ok",service:"tproxy"});
    const dashboard=await fetch(base+"/");expect(dashboard.status).toBe(200);
    const response=await fetch(base+"/api/status",{headers:{Authorization:"Bearer tls-fixture"}}),status=await response.json() as any;
    expect(status.startup.auth.state).toBe("error");expect(status.startup.auth.message).toContain("tls.caFile");expect(status.startup.catalog.state).toBe("waiting");
  }finally{proxy.stop();}
});

test("model discovery reports TLS failure and recovers through dashboard refresh",async()=>{
  const listener=Bun.listen({hostname:"127.0.0.1",port:0,socket:{data(){}}}),port=listener.port;listener.stop(true);
  let fail=true;const auth:any={status:{source:"fixture",storage:"fixture",refreshEvents:[]},initialize:async()=>{},models:async()=>{if(fail)throw new Error("unable to get local issuer certificate");return {data:[]};},account:async()=>{},stop(){}};
  const proxy=await startProxy(auth,{port,key:"catalog-fixture",models:{}},{initializeAuth:()=>auth.initialize()}),base=`http://127.0.0.1:${port}`,headers={Authorization:"Bearer catalog-fixture"};
  try{
    await proxy.startup;
    let status=await(await fetch(base+"/api/status",{headers})).json() as any;
    expect(status.startup.auth.state).toBe("ready");expect(status.startup.catalog.state).toBe("error");expect(status.startup.catalog.message).toContain("tls.caFile");
    expect((await fetch(base+"/api/refresh",{method:"POST",headers})).status).toBe(502);
    status=await(await fetch(base+"/api/status",{headers})).json() as any;
    expect(status.startup.auth.state).toBe("ready");expect(status.startup.catalog.state).toBe("error");
    fail=false;expect((await fetch(base+"/api/refresh",{method:"POST",headers})).status).toBe(200);
    status=await(await fetch(base+"/api/status",{headers})).json() as any;
    expect(status.startup.catalog.state).toBe("ready");expect(status.startup.catalog.message).toBeUndefined();
  }finally{proxy.stop();}
});
test("quota refresh stays authenticated and does not reinitialize credentials or reload models",async()=>{
  const listener=Bun.listen({hostname:"127.0.0.1",port:0,socket:{data(){}}}),port=listener.port;listener.stop(true);
  let quotas=0,models=0;
  const auth:any={status:{source:"fixture",quotaUpdatedAt:1234},models:async()=>{models++;return {data:[]};},refreshQuota:async()=>{quotas++;return auth.status;},initialize:async()=>{throw new Error("Quota must not reinitialize authentication");},stop(){}};
  const proxy=await startProxy(auth,{port,key:"quota-fixture",models:{},requireApiKey:false}),base=`http://127.0.0.1:${port}`;
  try{
    await proxy.startup;expect(models).toBe(1);
    expect((await fetch(base+"/api/quota",{method:"POST"})).status).toBe(401);expect(quotas).toBe(0);
    const response=await fetch(base+"/api/quota",{method:"POST",headers:{Authorization:"Bearer quota-fixture"}});
    expect(response.status).toBe(200);expect((await response.json() as any).quotaUpdatedAt).toBe(1234);expect(quotas).toBe(1);expect(models).toBe(1);
  }finally{proxy.stop();}
});
