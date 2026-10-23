// Controlled integration fixture. Default: inject a captured overflow once.
// --live-overflow: send one synthetic oversized input to Copilot and require its
// actual context-limit rejection before forwarding normal traffic. Not shipped.
import { resolve,join } from "node:path";
import { secretStore } from "../src/auth/secure-store";
import { TokenManager } from "../src/auth/token-manager";
import { CopilotClient } from "../src/proxy/copilot";
import { startProxy } from "../src/proxy/server";
import {appendFileSync} from "node:fs";
import {ApiError} from "../src/proxy/errors";
const directory=resolve("evidence/private/auth-runtime");
const key=await secretStore(join(directory,"local-api-key")).read();if(!key)throw new Error("Run auth check/start first");
const live=process.argv.includes("--live-overflow");
const audit=(value:any)=>{if(live)appendFileSync(join(directory,"live-overflow-audit.jsonl"),JSON.stringify({at:Date.now(),...value})+"\n");};
const auth=await new TokenManager(secretStore(directory)).initialize();let injected=false,failed=false,promptLimit:number|undefined;
const client=new CopilotClient(auth,(async(url:any,init:any)=>{
  const path=new URL(String(url)).pathname,wire=init.body?JSON.parse(init.body):undefined;
  const target=JSON.stringify(wire?.input??[]).includes("REAL_OVERFLOW_TARGET");audit({path,target,injected});
  if(failed)throw new ApiError(400,"invalid_request_error","Live overflow fixture failed validation; stop the fixture and inspect its status");
  if(live&&String(url).endsWith("/auto")){const response=await fetch(url,init);if(response.ok){const data=await response.clone().json() as any;promptLimit=data.selected_model?.capabilities?.limits?.max_prompt_tokens;}return response;}
  if(String(url).endsWith("/responses")&&!injected&&(!live||target)){injected=true;
    if(live){
      if(!Number.isInteger(promptLimit)||promptLimit!<1000||promptLimit!>950000){failed=true;throw new ApiError(400,"invalid_request_error","Live overflow fixture requires an advertised prompt limit between 1000 and 950000");}
      const body=JSON.parse(init.body);body.stream=false;body.input.push({type:"message",role:"user",content:[{type:"input_text",text:" a".repeat(promptLimit!+128)}]});
      const response=await fetch(url,{...init,headers:{...init.headers,Accept:"application/json"},body:JSON.stringify(body)});audit({stage:"oversized-response",status:response.status,advertisedPromptLimit:promptLimit});const raw=await response.clone().text();let data:any;try{data=JSON.parse(raw);}catch{audit({stage:"unexpected-error-format",contentType:response.headers.get("content-type"),length:raw.length});failed=true;throw new ApiError(400,"invalid_request_error","Live overflow response was not JSON");}
      audit({stage:"oversized-error",code:data?.error?.code,type:data?.error?.type,contextMessage:/prompt is too long|maximum context length|prompt token count .* exceeds/i.test(data?.error?.message??"")});
      if(response.status!==400||(!["model_max_prompt_tokens_exceeded","context_length_exceeded","prompt_too_long","max_prompt_tokens_exceeded"].includes(data?.error?.code)&&!/prompt is too long|maximum context length|prompt token count .* exceeds/i.test(data?.error?.message??""))){failed=true;await response.body?.cancel();throw new ApiError(400,"invalid_request_error","Live overflow probe did not return the required context rejection");}
      const result={liveOverflow:true,status:response.status,code:data.error.code,advertisedPromptLimit:promptLimit};audit(result);console.log(JSON.stringify(result));return response;
    }
    console.log("Injected captured overflow response once");return Response.json({error:{code:"model_max_prompt_tokens_exceeded",message:"prompt token count of 900002 exceeds the limit of 872000"}},{status:400});}
  console.log("Forwarding",new URL(String(url)).pathname);
  return fetch(url,init);
}) as typeof fetch);
const proxy=await startProxy(auth,{port:4142,key,models:{default:"copilot-auto",haiku:"copilot-auto",sonnet:"copilot-auto",opus:"copilot-auto"}},{client,onStop:()=>process.exit(0)});
console.log("Compaction integration fixture ready on 127.0.0.1:4142");
process.on("SIGINT",()=>{proxy.stop();process.exit(0);});
