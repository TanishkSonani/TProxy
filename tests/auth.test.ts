import { expect,test } from "bun:test";
import { TokenManager,copilotOrigin,CredentialRejected } from "../src/auth/token-manager";
import { DeviceFlow } from "../src/auth/device-flow";
import type { SecretStore } from "../src/auth/secure-store";
import { githubApi,existingCredential } from "../src/auth/providers";
test("pinned Copilot identity does not select the unrelated active Git publishing account",async()=>{
  const calls:string[][]=[],vscode={token:"vscode-fixture",source:"vscode",host:"github.com",login:"copilot-user"};
  const credential=await existingCredential({githubHost:"github.com",account:"copilot-user"},{env:{},ghAvailable:true,
    command:async args=>{calls.push(args);return args.includes("--user")?null:"wrong-active-account-token";},
    vscode:async options=>{expect(options.account).toBe("copilot-user");return vscode;}});
  expect(calls).toEqual([["gh","auth","token","--hostname","github.com","--user","copilot-user"]]);expect(credential).toEqual(vscode);
  const pinned=await existingCredential({githubHost:"github.com",account:"copilot-user"},{env:{},ghAvailable:true,command:async()=>"pinned-gh-fixture",vscode:async()=>{throw new Error("Should not fall through");}});
  expect(pinned?.source).toBe("gh");expect(pinned?.login).toBe("copilot-user");
});
class MemoryStore implements SecretStore {kind="test";value:string|null=null;async read(){return this.value;}async write(value:string){this.value=value;}}
function harness(){
  let time=1_800_000_000_000,calls=0,fail=false;const store=new MemoryStore();
  const credential={token:"github-fixture",source:"fixture",host:"github.com",login:"fixture"};
  const transport=async (url:any,init:any)=>{
    expect(init.redirect).toBe("manual");
    if(String(url).endsWith("/v2/token")){calls++;return fail?new Response("unavailable",{status:503}):Response.json({token:`copilot-${calls}`,endpoints:{api:"https://api.business.githubcopilot.com"},expires_at:(time+3600000)/1000,refresh_in:3600});}
    if(String(url).endsWith("/copilot_internal/user"))return Response.json({copilot_plan:"business",quota_snapshots:{premium_interactions:{remaining:10}}});
    return Response.json({login:"fixture"});
  };
  const deps={fetch:transport as any,now:()=>time,provider:async()=>credential,background:false};
  return {store,deps,credential,manager:()=>new TokenManager(store,{},deps),advance:(ms:number)=>time+=ms,calls:()=>calls,fail:()=>fail=true};
}
test("account discovery, secure restart reuse and simultaneous refresh are deterministic",async()=>{
  const h=harness(),first=await h.manager().initialize();expect(first.status.source).toBe("fixture");expect(first.status.plan).toBe("business");
  const second=await h.manager().initialize();expect(h.calls()).toBe(1);expect((await second.get()).api).toBe("https://api.business.githubcopilot.com");
  h.advance(3600000);const values=await Promise.all(Array.from({length:20},()=>second.get()));
  expect(h.calls()).toBe(2);expect(new Set(values.map(v=>v.token)).size).toBe(1);first.stop();second.stop();
});
test("35 days of simulated refresh do not require another login",async()=>{
  const h=harness(),manager=await h.manager().initialize();
  for(let day=0;day<35;day++){h.advance(86400000);await manager.get();}
  expect(h.calls()).toBe(36);expect(manager.status.refreshEvents.every(e=>e.ok)).toBe(true);manager.stop();
});
test("quota-only refresh coalesces callers, caches briefly and respects Retry-After without refreshing model auth",async()=>{
  const h=harness(),original=h.deps.fetch;let quotaCalls=0,mode:"ok"|"limited"|"missing"="ok";
  const manager=new TokenManager(h.store,{}, {...h.deps,fetch:(async(url:any,init:any)=>{
    if(String(url).endsWith("/copilot_internal/user")){quotaCalls++;if(mode==="limited")return new Response("",{status:429,headers:{"retry-after":"90"}});if(mode==="missing")return Response.json({});}
    return original(url,init);
  }) as any});
  try{
    await manager.initialize();const initialAt=manager.status.quotaUpdatedAt;expect(quotaCalls).toBe(1);
    await manager.refreshQuota();expect(quotaCalls).toBe(1);
    h.advance(16000);await Promise.all(Array.from({length:20},()=>manager.refreshQuota()));expect(quotaCalls).toBe(2);expect(h.calls()).toBe(1);expect(manager.status.quotaUpdatedAt).toBeGreaterThan(initialAt!);
    const received=manager.status.quotaUpdatedAt;h.advance(16000);mode="limited";await manager.refreshQuota();
    expect(manager.status.quotaRefresh?.state).toBe("error");expect(manager.status.quotaRefresh?.nextAttemptAt).toBe(h.deps.now()+90000);expect(manager.status.quotaUpdatedAt).toBe(received);
    await manager.refreshQuota();h.advance(89999);await manager.refreshQuota();expect(quotaCalls).toBe(3);
    h.advance(1);mode="ok";await manager.refreshQuota();expect(quotaCalls).toBe(4);expect(manager.status.quotaRefresh?.state).toBe("ready");
    const savedQuota=manager.status.quota,at=manager.status.quotaUpdatedAt;h.advance(16000);mode="missing";await manager.refreshQuota();
    expect(manager.status.quota).toEqual(savedQuota);expect(manager.status.quotaUpdatedAt).toBe(at);expect(manager.status.quotaRefresh?.state).toBe("error");expect(h.calls()).toBe(1);
  }finally{manager.stop();}
});
test("quota refresh failures redact transport details and honor HTTP-date backoff",async()=>{
  const h=harness(),original=h.deps.fetch;let mode:"ok"|"date"|"error"="ok",calls=0;
  const manager=new TokenManager(h.store,{}, {...h.deps,fetch:(async(url:any,init:any)=>{
    if(String(url).endsWith("/copilot_internal/user")){calls++;if(mode==="date")return new Response("",{status:429,headers:{"retry-after":new Date(h.deps.now()+120000).toUTCString()}});if(mode==="error")throw new Error("sensitive-transport-detail");}
    return original(url,init);
  }) as any});
  try{
    await manager.initialize();h.advance(16000);mode="date";await manager.refreshQuota();expect(manager.status.quotaRefresh?.nextAttemptAt).toBe(h.deps.now()+120000);
    h.advance(120000);mode="error";await manager.refreshQuota();expect(manager.status.quotaRefresh?.state).toBe("error");expect(JSON.stringify(manager.status)).not.toContain("sensitive-transport-detail");
    const previous=calls;await manager.refreshQuota();expect(calls).toBe(previous);expect((await manager.get()).token).toBe("copilot-1");
  }finally{manager.stop();}
});
test("refresh failure can use a still-valid token but never an expired token",async()=>{
  const h=harness(),manager=await h.manager().initialize();h.advance(3550000);h.fail();
  expect((await manager.get()).token).toBe("copilot-1");h.advance(60000);await expect(manager.get()).rejects.toThrow();manager.stop();
});
test("malformed cache and wrong account do not silently select a cached identity",async()=>{
  const h=harness();h.store.value=JSON.stringify({version:1});await h.manager().initialize();
  await expect(new TokenManager(h.store,{account:"different"},h.deps).initialize()).rejects.toThrow("account");
});
test("GitHub/EMU host and discovered origin validation fail closed",()=>{
  expect(githubApi("tenant.ghe.com")).toBe("https://api.tenant.ghe.com");
  expect(()=>githubApi("evil.example")).toThrow();
  expect(()=>copilotOrigin("http://api.githubcopilot.com")).toThrow();
  expect(()=>copilotOrigin("https://api.githubcopilot.com.evil.example")).toThrow();
  expect(()=>copilotOrigin("https://secret@api.githubcopilot.com")).toThrow();
});
test("device authorization honors pending/slow_down and returns only after approval",async()=>{
  let now=0;const waits:number[]=[],responses=[{error:"authorization_pending"},{error:"slow_down"},{access_token:"approved-fixture"}];
  const flow=new DeviceFlow("github.com",(async()=>Response.json(responses.shift())) as any);
  const credential=await flow.poll({device_code:"fixture",user_code:"CODE",verification_uri:"https://github.com/login/device",expires_in:100,interval:1},
    {now:()=>now,sleep:async ms=>{waits.push(ms);now+=ms;}});
  expect(waits).toEqual([1000,1000,6000]);expect(credential.source).toBe("device-flow");
});
test("expired or inconsistent cached tokens are refreshed even if refreshAt claims to be in the future",async()=>{
  const h=harness(),first=await h.manager().initialize();first.stop();const cached=JSON.parse(h.store.value!);cached.copilot.expiresAt=h.deps.now()-1;cached.copilot.refreshAt=h.deps.now()+3600000;h.store.value=JSON.stringify(cached);
  const second=await h.manager().initialize();expect(h.calls()).toBe(2);expect((await second.get()).token).toBe("copilot-2");second.stop();
});
test("expires_at without refresh_in remains usable with a safe refresh margin",async()=>{
  const h=harness(),original=h.deps.fetch;const manager=new TokenManager(h.store,{}, {...h.deps,fetch:(async(url:any,init:any)=>{const response=await original(url,init);if(String(url).endsWith("/v2/token")){const data=await response.json();delete data.refresh_in;return Response.json(data);}return response;}) as any});
  await manager.initialize();expect(manager.status.refreshAt!<manager.status.expiresAt!).toBe(true);expect((await manager.get()).token).toBe("copilot-1");manager.stop();
});
test("credential revocation is not hidden by falling back to a still-unexpired Copilot token",async()=>{
  const h=harness(),original=h.deps.fetch;let revoked=false;
  const manager=new TokenManager(h.store,{}, {...h.deps,fetch:(async(url:any,init:any)=>revoked&&String(url).endsWith("/v2/token")?new Response("",{status:401}):original(url,init)) as any});
  await manager.initialize();h.advance(3550000);revoked=true;await expect(manager.get()).rejects.toBeInstanceOf(CredentialRejected);expect(manager.status.expiresAt).toBeUndefined();manager.stop();
});
