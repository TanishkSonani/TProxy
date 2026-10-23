// Controlled integration fixture: inject the exact observed provider overflow once,
// then forward normal traffic. Not part of the production server or shipped CLI.
import { resolve,join } from "node:path";
import { secretStore } from "../src/auth/secure-store";
import { TokenManager } from "../src/auth/token-manager";
import { CopilotClient } from "../src/proxy/copilot";
import { startProxy } from "../src/proxy/server";
const directory=resolve("evidence/private/auth-runtime");
const key=await secretStore(join(directory,"local-api-key")).read();if(!key)throw new Error("Run auth check/start first");
const auth=await new TokenManager(secretStore(directory)).initialize();let injected=false;
const client=new CopilotClient(auth,(async(url:any,init:any)=>{
  if(String(url).endsWith("/responses")&&!injected){injected=true;console.log("Injected captured overflow response once");return Response.json({error:{code:"model_max_prompt_tokens_exceeded",message:"prompt token count of 900002 exceeds the limit of 872000"}},{status:400});}
  console.log("Forwarding",new URL(String(url)).pathname);
  return fetch(url,init);
}) as typeof fetch);
const proxy=await startProxy(auth,{port:4142,key,models:{default:"copilot-auto",haiku:"copilot-auto",sonnet:"copilot-auto",opus:"copilot-auto"}},{client,onStop:()=>process.exit(0)});
console.log("Compaction integration fixture ready on 127.0.0.1:4142");
process.on("SIGINT",()=>{proxy.stop();process.exit(0);});
