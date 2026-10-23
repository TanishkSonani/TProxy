import { expect,test } from "bun:test";
import { TokenManager,copilotOrigin } from "../src/auth/token-manager";
import { DeviceFlow } from "../src/auth/device-flow";
import type { SecretStore } from "../src/auth/secure-store";
import { githubApi } from "../src/auth/providers";
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
