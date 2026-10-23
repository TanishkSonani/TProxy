// Adapted protocol mapping/state structure from caozhiyuan/copilot-api at
// 64e38da1eb79eeda6c8b660d585754c0c8f5dc00, responses[-stream]-translation.ts.
// MIT; see third_party/licenses/caozhiyuan-copilot-api.txt. No prompt injection,
// external counting, forced 12800-token minimum, or tool-search shim is imported.
import { ApiError,upstreamError } from "./errors";
import { parseSSE,frame } from "./sse";
import {stopSequences,stopMessage,stopStream} from "./stop-sequences";
const CARRIER="ghcp-responses-v1:";
function carry(item:any,model:string){return CARRIER+Buffer.from(JSON.stringify({model,item})).toString("base64url");}
function uncarry(signature:string,model:string){
  if(!signature?.startsWith(CARRIER))throw new ApiError(400,"invalid_request_error","Thinking history from another provider cannot be replayed on this model");
  try {const data=JSON.parse(Buffer.from(signature.slice(CARRIER.length),"base64url").toString());if(data.model!==model||data.item?.type!=="reasoning")throw new Error();return data.item;}
  catch{throw new ApiError(400,"invalid_request_error","Reasoning history belongs to another model or is invalid");}
}
export function imagePart(block:any){const source=block.source;if(source?.type==="base64")return {type:"input_image",image_url:`data:${source.media_type};base64,${source.data}`};
  throw new ApiError(400,"invalid_request_error","Only base64 image sources are supported by this adapter");}
export function text(value:any):string {if(typeof value==="string")return value;return (value??[]).filter((b:any)=>b.type==="text").map((b:any)=>b.text).join("\n");}
export function toResponses(payload:any,model:string,max:number,capabilities:any):any {
  const input:any[]=[];
  for(const message of payload.messages){
    let content:any[]=[];const flush=()=>{if(content.length){input.push({type:"message",role:message.role,content});content=[];}};
    for(const block of typeof message.content==="string"?[{type:"text",text:message.content}]:message.content){
      if(block.type==="text")content.push({type:message.role==="assistant"?"output_text":"input_text",text:block.text});
      else if(block.type==="image"){if(!capabilities.supports?.vision)throw new ApiError(400,"invalid_request_error","Selected model does not support images");content.push(imagePart(block));}
      else if(block.type==="tool_use"){flush();input.push({type:"function_call",call_id:block.id,name:block.name,arguments:JSON.stringify(block.input)});}
      else if(block.type==="tool_result"){flush();let output:any=typeof block.content==="string"?block.content:(block.content??[]).map((b:any)=>b.type==="text"?{type:"input_text",text:b.text}:imagePart(b));
        if(block.is_error)output="[Tool error] "+(typeof output==="string"?output:JSON.stringify(output));input.push({type:"function_call_output",call_id:block.tool_use_id,output});}
      else if(block.type==="thinking"){flush();input.push(uncarry(block.signature,model));}
      else throw new ApiError(400,"invalid_request_error",`Unsupported content block for selected model: ${String(block.type).slice(0,50)}`);
    }flush();
  }
  const result:any={model,input,max_output_tokens:max,stream:Boolean(payload.stream),store:false,include:["reasoning.encrypted_content"]};
  if(payload.system)result.instructions=text(payload.system);
  if(payload.tools?.length){if(!capabilities.supports?.tool_calls)throw new ApiError(400,"invalid_request_error","Selected model does not support tools");
    result.tools=payload.tools.map((t:any)=>{if(t.type && t.type!=="custom")throw new ApiError(400,"invalid_request_error","Server-executed tools are not supported by this adapter");return {type:"function",name:t.name,description:t.description,parameters:t.input_schema,strict:false};});}
  if(payload.tool_choice){const t=payload.tool_choice;result.tool_choice=t.type==="tool"?{type:"function",name:t.name}:t.type==="any"?"required":t.type==="none"?"none":"auto";if(t.disable_parallel_tool_use)result.parallel_tool_calls=false;}
  const efforts=capabilities.supports?.reasoning_effort;
  if(Array.isArray(efforts)&&efforts.length){const requested=payload.output_config?.effort??(payload.thinking?.type==="disabled"?"none":"medium");
    result.reasoning={effort:efforts.includes(requested)?requested:efforts.includes("medium")?"medium":efforts[0]};}
  if(payload.temperature!==undefined && !result.reasoning)result.temperature=payload.temperature;
  if(payload.top_p!==undefined && !result.reasoning)result.top_p=payload.top_p;
  stopSequences(payload.stop_sequences); // Responses has no upstream stop parameter; enforce on returned text.
  if(payload.output_config?.format){const f=payload.output_config.format;if(f.type!=="json_schema")throw new ApiError(400,"invalid_request_error","Unsupported output format");result.text={format:{type:"json_schema",name:"response",schema:f.schema,strict:true}};}
  return result;
}
export function responsesUsage(response:any){
  const u=response.usage;if(!u||!Number.isFinite(u.input_tokens)||!Number.isFinite(u.output_tokens))throw new ApiError(502,"api_error","Provider response omitted required token usage");
  const cached=u.input_tokens_details?.cached_tokens??0,write=u.input_tokens_details?.cache_write_tokens??0;
  return {input_tokens:Math.max(0,u.input_tokens-cached-write),output_tokens:u.output_tokens,
    ...(u.input_tokens_details?.cached_tokens!==undefined?{cache_read_input_tokens:cached}:{}),
    ...(u.input_tokens_details?.cache_write_tokens!==undefined?{cache_creation_input_tokens:write}:{})};
}
export function stopReason(response:any,hasTools=false){if(response.status==="incomplete"&&response.incomplete_details?.reason==="max_output_tokens")return "max_tokens";
  if(response.status!=="completed")throw new ApiError(502,"api_error","Provider generation did not complete");
  return hasTools||response.output?.some((i:any)=>i.type==="function_call")?"tool_use":"end_turn";}
export function fromResponses(response:any,model:string,sequences:readonly string[]=[]){
  const content:any[]=[];
  for(const item of response.output??[]){
    if(item.type==="message")for(const part of item.content??[])if(part.type==="output_text")content.push({type:"text",text:part.text});else if(part.type==="refusal")content.push({type:"text",text:part.refusal});
    if(item.type==="function_call"){let input;try{input=JSON.parse(item.arguments);}catch{throw new ApiError(502,"api_error","Provider returned invalid tool arguments");}content.push({type:"tool_use",id:item.call_id,name:item.name,input});}
    if(item.type==="reasoning")content.push({type:"thinking",thinking:(item.summary??[]).map((s:any)=>s.text??"").join("\n"),signature:carry(item,model)});
  }
  return stopMessage({id:response.id,type:"message",role:"assistant",model,content,stop_reason:stopReason(response),stop_sequence:null,usage:responsesUsage(response)},sequences);
}

export async function* responsesStream(response:Response,model:string,onComplete:(message:any)=>void,sequences:readonly string[]=[]):AsyncGenerator<string> {
  if(sequences.length){yield* stopStream(rawResponsesStream(response,model,()=>{}),sequences,onComplete);return;}
  yield* rawResponsesStream(response,model,onComplete);
}
async function* rawResponsesStream(response:Response,model:string,onComplete:(message:any)=>void):AsyncGenerator<string> {
  if(!response.body)throw new ApiError(502,"api_error","Provider returned an empty stream");
  let started=false,completed=false,next=0,hasTools=false;
  const blocks=new Map<string,{index:number;open:boolean;delta:boolean;item?:any}>();
  const start=()=>frame({type:"message_start",message:{id:"msg_bridge_pending",type:"message",role:"assistant",model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:0,output_tokens:0}}});
  const open=(key:string,block:any,item?:any)=>{const state={index:next++,open:true,delta:false,item};blocks.set(key,state);return frame({type:"content_block_start",index:state.index,content_block:block});};
  const close=(key:string)=>{const b=blocks.get(key);if(b?.open){b.open=false;return frame({type:"content_block_stop",index:b.index});}return "";};
  for await(const raw of parseSSE(response.body)){
    let event:any;try{event=JSON.parse(raw.data);}catch{throw new ApiError(502,"api_error","Provider returned malformed stream JSON");}
    if(!started){started=true;const initial=event.response;yield initial?frame({type:"message_start",message:{id:initial.id,type:"message",role:"assistant",model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:0,output_tokens:0}}}):start();}
    const index=String(event.output_index),item=event.item;
    if(event.type==="response.output_item.added"){
      if(item.type==="function_call"){hasTools=true;yield open("tool:"+index,{type:"tool_use",id:item.call_id,name:item.name,input:{}},item);}
      if(item.type==="reasoning")yield open("reason:"+index,{type:"thinking",thinking:"",signature:""},item);
    }
    if(event.type==="response.output_text.delta"||event.type==="response.refusal.delta"){
      const key=`text:${index}:${event.content_index??0}`;if(!blocks.has(key))yield open(key,{type:"text",text:""});const b=blocks.get(key)!;b.delta=true;
      yield frame({type:"content_block_delta",index:b.index,delta:{type:"text_delta",text:event.delta}});
    }
    if(event.type==="response.function_call_arguments.delta"){
      const b=blocks.get("tool:"+index);if(!b)throw new ApiError(502,"api_error","Provider tool delta arrived before its call");b.delta=true;
      yield frame({type:"content_block_delta",index:b.index,delta:{type:"input_json_delta",partial_json:event.delta}});
    }
    if(event.type==="response.reasoning_summary_text.delta"){
      const key="reason:"+index;if(!blocks.has(key))yield open(key,{type:"thinking",thinking:"",signature:""});const b=blocks.get(key)!;b.delta=true;
      yield frame({type:"content_block_delta",index:b.index,delta:{type:"thinking_delta",thinking:event.delta}});
    }
    if(event.type==="response.output_text.done"){
      const key=`text:${index}:${event.content_index??0}`;if(!blocks.has(key))yield open(key,{type:"text",text:""});const b=blocks.get(key)!;
      if(!b.delta&&event.text)yield frame({type:"content_block_delta",index:b.index,delta:{type:"text_delta",text:event.text}});
      const end=close(key);if(end)yield end;
    }
    if(event.type==="response.output_item.done"){
      if(item.type==="function_call") {const key="tool:"+index;const b=blocks.get(key);if(b&&!b.delta&&item.arguments)yield frame({type:"content_block_delta",index:b.index,delta:{type:"input_json_delta",partial_json:item.arguments}});const end=close(key);if(end)yield end;}
      if(item.type==="reasoning") {const key="reason:"+index;if(!blocks.has(key))yield open(key,{type:"thinking",thinking:"",signature:""});const b=blocks.get(key)!;
        if(!b.delta){const summary=(item.summary??[]).map((s:any)=>s.text??"").join("\n");if(summary)yield frame({type:"content_block_delta",index:b.index,delta:{type:"thinking_delta",thinking:summary}});}
        yield frame({type:"content_block_delta",index:b.index,delta:{type:"signature_delta",signature:carry(item,model)}});const end=close(key);if(end)yield end;
      }
    }
    if(event.type==="error"||event.type==="response.failed")throw upstreamError(502,event.response??event);
    if(event.type==="response.completed"||event.type==="response.incomplete"){
      const final=event.response;const reason=stopReason(final,hasTools);const usage=responsesUsage(final);
      for(const [key]of blocks){const end=close(key);if(end)yield end;}
      yield frame({type:"message_delta",delta:{stop_reason:reason,stop_sequence:null},usage});
      completed=true;onComplete({usage,model,content:(final.output??[]).filter((item:any)=>item.type==="function_call").map(()=>({type:"tool_use"}))});
      yield frame({type:"message_stop"});break;
    }
  }
  if(!completed)throw new ApiError(502,"api_error","Provider stream ended before completion");
}
