import {expect,test} from "bun:test";
import {clientContextWindow,contextPolicy} from "../src/client/context-window";
import {claudeEnvironment} from "../src/client/claude-launch";
import {startProxy} from "../src/proxy/server";
import {CopilotClient} from "../src/proxy/copilot";
const model=(id:string,context:number,prompt:number,picker=false)=>({id,model_picker_enabled:picker,capabilities:{limits:{max_context_window_tokens:context,max_prompt_tokens:prompt}}});
test("missing Auto metadata uses a labeled fallback without assuming hidden catalog entries are entitled",()=>{
  expect(clientContextWindow([model("hidden",16384,12288)],{default:"copilot-auto"})).toBe(200000);
  expect(clientContextWindow([],{default:"copilot-auto"},128000)).toBe(128000);
  expect(contextPolicy([],{default:"copilot-auto"}).source).toBe("fallback");
  expect(clientContextWindow([],{default:"copilot-auto"},undefined,[],64000)).toBe(64000);
});
test("configured slots use their own limits, not unrelated picker models",()=>{
  expect(clientContextWindow([model("large",1000000,872000),model("small",200000,128000)],{default:"large",haiku:"small"})).toBe(128000);
  expect(clientContextWindow([model("picker",128000,64000,true)],{default:"copilot-auto"})).toBe(200000);
  expect(clientContextWindow([{...model("disabled",16000,12000,true),policy:{state:"disabled"}}],{default:"copilot-auto"})).toBe(200000);
});
test("Copilot metadata can exceed 200k and Auto can resolve limits from the fresh catalog",()=>{
  const large=model("selected",1000000,872000);
  expect(clientContextWindow([large],{default:large.id})).toBe(872000);
  const policy=contextPolicy([large],{default:"copilot-auto"},undefined,[{id:large.id}]);
  expect(policy.tokens).toBe(872000);expect(policy.source).toBe("copilot");expect(policy.ceiling).toBeNull();
  expect(clientContextWindow([large],{default:"selected"},128000)).toBe(128000);
});
test("observed Auto selections lower future launcher windows and invalid provider metadata never raises a limit",()=>{
  const autos=function*(){yield model("selected",128000,64000);};
  expect(clientContextWindow([],{default:"copilot-auto"},200000,autos())).toBe(64000);
  expect(clientContextWindow([{id:"bad",capabilities:{limits:{max_context_window_tokens:NaN,max_prompt_tokens:-1}}}],{default:"bad"})).toBe(200000);
  for(const n of [NaN,0,999,1000001])expect(()=>clientContextWindow([],{},n)).toThrow();
});
test("launcher overrides inherited 1M/disabled compaction flags with truthful window settings",()=>{
  const env=claudeEnvironment({port:4141,key:"fixture",model:"copilot-auto",smallModel:"copilot-auto",contextWindowTokens:128000},{CLAUDE_CODE_MAX_CONTEXT_TOKENS:"1000000",CLAUDE_CODE_AUTO_COMPACT_WINDOW:"1000000",DISABLE_COMPACT:"1",DISABLE_AUTO_COMPACT:"1",CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT:"1"});
  expect(env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("128000");expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("128000");expect(env.CLAUDE_CODE_DISABLE_1M_CONTEXT).toBe("1");expect(env.DISABLE_COMPACT).toBe("");expect(env.DISABLE_AUTO_COMPACT).toBe("");expect(env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT).toBe("");
  expect(claudeEnvironment({port:4141,key:"fixture",model:"copilot-auto",smallModel:"copilot-auto"},{}).CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("200000");
});
test("live context preparation refreshes Copilot metadata, resolves Auto and exposes truthful limits without polling upstream on status",async()=>{
  const listener=Bun.listen({hostname:"127.0.0.1",port:0,socket:{data(){}}}),port=listener.port;listener.stop(true);
  let prompt=872000,models=0,autos=0;
  const auth:any={status:{source:"fixture"},models:async()=>{models++;return {data:[model("selected",1000000,prompt),model("unrelated",128000,64000,true)]};},get:async()=>({token:"fixture",api:"https://api.individual.githubcopilot.com"}),stop(){}};
  const client=new CopilotClient(auth,(async()=>{autos++;return Response.json({selected_model:{...model("selected",1000000,872000),vendor:"OpenAI"},session_token:"do-not-return",expires_at:Date.now()/1000+3600});}) as any);
  const proxy=await startProxy(auth,{port,key:"local",models:{default:"copilot-auto",sonnet:"copilot-auto",opus:"copilot-auto",haiku:"copilot-auto"}},{client});const url=`http://127.0.0.1:${port}`,headers={Authorization:"Bearer local"};
  try{
    let response=await fetch(url+"/api/context",{method:"POST",headers,body:"{}"});let data=await response.json() as any;expect(data.tokens).toBe(872000);expect(data.source).toBe("copilot");expect(JSON.stringify(data)).not.toContain("do-not-return");expect(autos).toBe(1);expect(models).toBe(2);
    await fetch(url+"/api/status",{headers});await fetch(url+"/api/status",{headers});expect(models).toBe(2);expect(autos).toBe(1);
    response=await fetch(url+"/api/context",{method:"POST",headers,body:JSON.stringify({model:"unrelated"})});data=await response.json();expect(data.tokens).toBe(64000);
    prompt=768000;response=await fetch(url+"/api/context",{method:"POST",headers,body:"{}"});data=await response.json();expect(data.tokens).toBe(768000);expect(autos).toBe(1);
    response=await fetch(url+"/api/env",{headers});const env=await response.json() as any;expect(env.script).toContain("768000");
  }finally{proxy.stop();}
});
