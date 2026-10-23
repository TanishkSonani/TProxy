// Explicit live probe: sends only the synthetic marker prompt to the configured bridge.
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {loadConfig} from "../src/config";
import {secretStore} from "../src/auth/secure-store";
import {parseSSE} from "../src/proxy/sse";
const config=loadConfig(),key=await secretStore(join(config.dataDir,"local-api-key")).read();
if(!key)throw new Error("No local bridge credential");
const stop="|END_BRIDGE|";
for(const stream of [false,true]){
  const response=await fetch(`http://127.0.0.1:${config.port}/v1/messages`,{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},
    body:JSON.stringify({model:config.models.default,max_tokens:512,stream,stop_sequences:[stop],metadata:{user_id:randomUUID()},messages:[{role:"user",content:"Output exactly BEFORE_BRIDGE|END_BRIDGE|AFTER_BRIDGE as plain text without quotes or formatting. Do not use tools."}]}),signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw new Error(`Live stop probe failed (${response.status})`);
  let text="",reason:string|undefined,sequence:string|undefined,usage:any;
  if(stream){if(!response.body)throw new Error("Empty stream");let complete=false;for await(const raw of parseSSE(response.body)){const e=JSON.parse(raw.data);if(e.type==="error")throw new Error("Live provider stream failed");if(e.delta?.type==="text_delta")text+=e.delta.text;if(e.type==="message_delta"){reason=e.delta.stop_reason;sequence=e.delta.stop_sequence;usage=e.usage;}if(e.type==="message_stop")complete=true;}if(!complete)throw new Error("Stream did not complete");}
  else {const message=await response.json() as any;text=message.content.filter((b:any)=>b.type==="text").map((b:any)=>b.text).join("");reason=message.stop_reason;sequence=message.stop_sequence;usage=message.usage;}
  if(text!=="BEFORE_BRIDGE"||reason!=="stop_sequence"||sequence!==stop||!Number.isFinite(usage?.output_tokens))throw new Error("Stop sequence semantics or usage did not match");
  console.log(JSON.stringify({stream,text,stop_reason:reason,stop_sequence:sequence,output_tokens:usage.output_tokens}));
}
