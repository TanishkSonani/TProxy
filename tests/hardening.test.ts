import {test,expect,afterEach} from "bun:test";
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync} from "node:fs";
import {join,resolve,sep} from "node:path";
import {tmpdir} from "node:os";
import {loadConfig,saveConfig} from "../src/config";
import {validateMessages} from "../src/proxy/validate";
import {CopilotClient} from "../src/proxy/copilot";
import {parseSSE,eventStream,frame} from "../src/proxy/sse";
import {upstreamError} from "../src/proxy/errors";
import {redactStructure} from "../src/dashboard/store";
import {checkManagedRouting,readExtraSettings} from "../src/client/managed-settings";
import {WindowsProtectedStore} from "../src/auth/secure-store";
import {startProxy} from "../src/proxy/server";
import {responsesStream} from "../src/proxy/responses";
import {chatStream} from "../src/proxy/chat";
import {withProfileLock} from "../src/profile-lock";
const temporary:string[]=[];
afterEach(()=>{for(const dir of temporary.splice(0)){if(!resolve(dir).startsWith(resolve(tmpdir())+sep))throw new Error("Unsafe test cleanup path");rmSync(dir,{recursive:true,force:true});}});
test("configuration rejects ambiguous types and explicit data-dir wins over the config file",()=>{
  const dir=mkdtempSync(join(tmpdir(),"bridge-config-"));temporary.push(dir);const file=join(dir,"config.json");
  for(const input of [null,[],{requireApiKey:"false"},{models:{default:5}},{models:null},{auth:[]},{auth:{vscodePaths:"D:/custom"}},{tls:[]},{tls:{caFile:" "}},{retentionDays:3661},{dataDir:5}]){
    writeFileSync(file,JSON.stringify(input));expect(()=>loadConfig(file,dir)).toThrow();
  }
  writeFileSync(file,JSON.stringify({dataDir:"D:/old-profile",models:{default:"custom"},tls:{caFile:"certs/org-root.pem"}}));
  const config=loadConfig(file,dir);expect(config.dataDir).toBe(resolve(dir));expect(config.tls.caFile).toBe(resolve(dir,"certs/org-root.pem"));saveConfig(file,config);expect(JSON.parse(readFileSync(file,"utf8")).models.default).toBe("custom");expect(readdirSync(dir).filter(p=>p.endsWith(".tmp"))).toHaveLength(0);
  const previous=process.env.TPROXY_CA_FILE;
  try{process.env.TPROXY_CA_FILE=join(dir,"approved-root.pem");expect(loadConfig(file,dir).tls.caFile).toBe(resolve(dir,"approved-root.pem"));}
  finally{if(previous===undefined)delete process.env.TPROXY_CA_FILE;else process.env.TPROXY_CA_FILE=previous;}
});
test("malformed message/block/tool types fail as client errors before provider dispatch",()=>{
  const good={model:"fixture",max_tokens:100,messages:[{role:"user",content:"hello"}]};
  for(const body of [null,[],{...good,model:""},{...good,messages:[null]},{...good,messages:[{role:"user",content:[null]}]},{...good,messages:[{role:"user",content:[{type:"text",text:1}]}]},{...good,stream:"false"},{...good,metadata:[]},{...good,tools:[null]},{...good,thinking:{type:"enabled",budget_tokens:NaN}}])expect(()=>validateMessages(body)).toThrow();
  expect(()=>validateMessages({...good,messages:[{role:"user",content:[{type:"tool_result",tool_use_id:"call"}]}]})).not.toThrow();
});
test("provider retries remain bounded, refresh auth after a preceding 5xx, and never retry 429 or follow redirects",async()=>{
  let calls=0,refreshes=0;const auth:any={get:async()=>({token:"fixture",api:"https://api.business.githubcopilot.com"}),refresh:async()=>{refreshes++;}};
  const client=new CopilotClient(auth,(async(_url:any,init:any)=>{calls++;expect(init.redirect).toBe("manual");return new Response("",{status:[503,401,200][calls-1],headers:{"retry-after":"0"}});}) as any);
  expect((await client.request("/responses",{})).status).toBe(200);expect(calls).toBe(3);expect(refreshes).toBe(1);
  for(const status of [429,302,400]){calls=0;const once=new CopilotClient(auth,(async()=>{calls++;return new Response("",{status,headers:{"retry-after":"3600",location:"https://foreign.invalid"}});}) as any);expect((await once.request("/responses",{})).status).toBe(status);expect(calls).toBe(1);}
  calls=0;const abort=new AbortController();abort.abort();await expect(client.request("/responses",{}, {},abort.signal)).rejects.toThrow();expect(calls).toBe(0);
});
test("native streamed error types retain rate-limit and overload semantics without private details",()=>{
  expect(upstreamError(400,{error:{type:"rate_limit_error",message:"private provider text"}}).status).toBe(429);
  const overload=upstreamError(400,{error:{type:"overloaded_error",message:"private provider text"}});expect(overload.status).toBe(529);expect(overload.message).not.toContain("private");
});
test("SSE accepts byte-fragmented CR-only records and rejects oversized complete events",async()=>{
  const bytes=new TextEncoder().encode("event: sample\rdata: one\rdata: two\r\r");
  const body=new ReadableStream<Uint8Array>({start(c){for(const byte of bytes)c.enqueue(Uint8Array.of(byte));c.close();}});const result=[];for await(const e of parseSSE(body))result.push(e);expect(result).toEqual([{event:"sample",data:"one\ntwo"}]);
  const consume=async()=>{for await(const _ of parseSSE(new Response("data: "+"x".repeat(16*1024*1024)+"\n\n").body!)){};};await expect(consume()).rejects.toThrow("size");
});
test("consumer cancellation aborts a pending generation without waiting for a stalled iterator",async()=>{
  let wake!:()=>void,aborted=false;const waiting=new Promise<void>(r=>wake=r);
  async function* generate(){await waiting;yield frame({type:"message_stop"});}
  const reader=eventStream(generate(),()=>{aborted=true;wake();}).getReader();const pending=reader.read();await reader.cancel();await pending;expect(aborted).toBe(true);
});
test("request log redaction hides user-controlled keys, tool numbers and nested content",()=>{
  const redacted=JSON.stringify(redactStructure({messages:[{role:"assistant",content:[{type:"tool_use",id:"private-id",name:"private",input:{"secret-property":123456}}]}],"user-secret-key":42,metadata:{user_id:"private-account"}}));
  for(const secret of ["secret-property","123456","user-secret-key","private-id","private-account"])expect(redacted).not.toContain(secret);
  expect(redacted).toContain("tool_use");
  let nested:any="sensitive";for(let i=0;i<1000;i++)nested={content:nested};expect(JSON.stringify(redactStructure(nested))).toContain("depth limit");
});
test("managed routing conflicts fail before launch without exposing secret values or changing policy",()=>{
  const settings={env:{ANTHROPIC_BASE_URL:"https://managed.invalid",ANTHROPIC_AUTH_TOKEN:"managed-secret"},permissions:{deny:["Bash(*)"]}},original=JSON.stringify(settings);
  let message="";try{checkManagedRouting([{source:"fixture policy",settings}],{ANTHROPIC_BASE_URL:"http://127.0.0.1:4141",ANTHROPIC_AUTH_TOKEN:"local-secret"});}catch(e){message=String(e);}
  expect(message).toContain("conflicts");expect(message).not.toContain("managed-secret");expect(message).not.toContain("local-secret");expect(JSON.stringify(settings)).toBe(original);
  expect(()=>checkManagedRouting([{source:"permission-only policy",settings:{permissions:{deny:["Bash(*)"]}}}],{})).not.toThrow();
  expect(()=>checkManagedRouting([{source:"helper",settings:{policyHelper:"corp-policy"}}],{})).toThrow("administrator verification");
});
test("large Windows credential records use a DPAPI file instead of exceeding vault capacity or writing plaintext",async()=>{
  if(process.platform!=="win32")return;
  const dir=mkdtempSync(join(tmpdir(),"bridge-dpapi-"));temporary.push(dir);const store=new WindowsProtectedStore(dir,"ghcp-bridge:oversize-fixture");
  const value="synthetic-enterprise-secret-".repeat(500);await store.write(value);expect(readFileSync(join(dir,"credentials.dpapi")).includes(Buffer.from("synthetic-enterprise-secret"))).toBe(false);expect(await store.read()).toBe(value);
});
test("Auto can return partial model metadata and the bridge hydrates protocol/limits from the discovered catalog",async()=>{
  const listener=Bun.listen({hostname:"127.0.0.1",port:0,socket:{data(){}}}),port=listener.port;listener.stop(true);
  const auth:any={status:{},models:async()=>({data:[{id:"selected",vendor:"OpenAI",supported_endpoints:["/responses"],capabilities:{limits:{max_output_tokens:2048},supports:{tool_calls:true}}}]}),get:async()=>({token:"fixture",api:"https://api.individual.githubcopilot.com"}),stop(){}};
  const client=new CopilotClient(auth,(async(url:any,init:any)=>String(url).endsWith("/auto")?Response.json({selected_model:{id:"selected"},session_token:"fixture",expires_at:Date.now()/1000+3600}):Response.json({id:"resp",status:"completed",usage:{input_tokens:1,output_tokens:1},output:[{type:"message",content:[{type:"output_text",text:"ready"}]}]})) as any);
  const proxy=await startProxy(auth,{port,key:"fixture",models:{}},{client});try{const response=await fetch(`http://127.0.0.1:${port}/v1/messages`,{method:"POST",headers:{Authorization:"Bearer fixture"},body:JSON.stringify({model:"copilot-auto",max_tokens:100,messages:[{role:"user",content:"test"}]})});expect(response.status).toBe(200);expect((await response.json() as any).content[0].text).toBe("ready");}finally{proxy.stop();}
});
test("malformed provider tool JSON is rejected without inventing a repaired tool call",async()=>{
  const consume=async(source:AsyncIterable<string>)=>{for await(const _ of source){};};
  const item={type:"function_call",call_id:"a",name:"Bash",arguments:"{broken"};
  await expect(consume(responsesStream(new Response([{type:"response.output_item.added",output_index:0,item},{type:"response.output_item.done",output_index:0,item}].map(frame).join("")),"fixture",()=>{}))).rejects.toThrow("invalid tool arguments");
  const chunk={id:"x",choices:[{delta:{tool_calls:[{index:0,id:"a",function:{name:"Bash",arguments:"{broken"}}]},finish_reason:"tool_calls"}],usage:{prompt_tokens:1,completion_tokens:1}};
  await expect(consume(chatStream(new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`),"fixture",()=>{}))).rejects.toThrow("invalid tool arguments");
});
test("concurrent cold profile initializations serialize key creation and release locks after errors",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"bridge-profile-"));temporary.push(dir);let stored:string|undefined,created=0;
  const initialize=()=>withProfileLock(dir,async()=>{if(!stored){await new Promise(r=>setTimeout(r,10));stored="key-"+(++created);}return stored;});
  expect(new Set(await Promise.all(Array.from({length:5},initialize))).size).toBe(1);expect(created).toBe(1);
  await expect(withProfileLock(dir,async()=>{throw new Error("synthetic failure");})).rejects.toThrow("synthetic");expect(await initialize()).toBe("key-1");
});
test("extra Claude settings cannot silently override the bridge route or expose their secret values",()=>{
  const documents=readExtraSettings(["--settings",JSON.stringify({env:{ANTHROPIC_BASE_URL:"https://foreign.invalid",ANTHROPIC_AUTH_TOKEN:"private-fixture"}})]);
  expect(()=>checkManagedRouting(documents,{ANTHROPIC_BASE_URL:"http://127.0.0.1:4141"})).toThrow("conflicts");
  expect(()=>readExtraSettings(["--settings={broken"])).toThrow("Cannot read or parse");
  expect(()=>checkManagedRouting(readExtraSettings(["--settings",JSON.stringify({hooks:{},permissions:{deny:["Bash(*)"]}})]),{})).not.toThrow();
});
