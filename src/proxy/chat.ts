// Adapted Anthropic/Chat Completions mapping from ericc-ch/copilot-api at
// 0ea08febdd7e3e055b03dd298bf57e669500b5c1 (MIT; third_party/licenses/ericc-copilot-api.txt).
// No Claude-model name rewriting or native-Claude translation is imported.
import { ApiError,upstreamError } from "./errors";
import { frame,parseSSE } from "./sse";
import { imagePart,text } from "./responses";
const PREFIX="ghcp-chat-v1:";
function reasoningSignature(value:string,model:string){return PREFIX+Buffer.from(JSON.stringify({model,value})).toString("base64url");}
function image(block:any){const p=imagePart(block);return {type:"image_url",image_url:{url:p.image_url}};}
export function toChat(payload:any,model:string,max:number,caps:any){
  const messages:any[]=[];if(payload.system)messages.push({role:"system",content:text(payload.system)});
  for(const message of payload.messages){
    const content:any[]=[],calls:any[]=[];let reasoning:string|undefined;
    const results:any[]=[];
    for(const block of typeof message.content==="string"?[{type:"text",text:message.content}]:message.content){
      if(block.type==="text")content.push({type:"text",text:block.text});
      else if(block.type==="image"){if(!caps.supports?.vision)throw new ApiError(400,"invalid_request_error","Selected model does not support images");content.push(image(block));}
      else if(block.type==="tool_use")calls.push({id:block.id,type:"function",function:{name:block.name,arguments:JSON.stringify(block.input)}});
      else if(block.type==="tool_result"){
        results.push({role:"tool",tool_call_id:block.tool_use_id,content:(block.is_error?"[Tool error] ":"")+text(block.content)});
        for(const part of Array.isArray(block.content)?block.content:[])if(part.type==="image")content.push(image(part));
      }
      else if(block.type==="thinking"){
        try {if(!block.signature?.startsWith(PREFIX))throw new Error();const decoded=JSON.parse(Buffer.from(block.signature.slice(PREFIX.length),"base64url").toString());if(decoded.model!==model)throw new Error();reasoning=decoded.value;}
        catch{throw new ApiError(400,"invalid_request_error","Reasoning history belongs to another provider or model");}
      }else throw new ApiError(400,"invalid_request_error","Content block is unsupported by this model adapter");
    }
    messages.push(...results);
    if(content.length||calls.length||reasoning)messages.push({role:message.role,content:content.length===1&&content[0].type==="text"?content[0].text:content.length?content:null,
      ...(calls.length?{tool_calls:calls}:{}),...(reasoning?{reasoning_content:reasoning}:{})});
  }
  const result:any={model,messages,max_tokens:max,stream:Boolean(payload.stream)};
  if(payload.stream)result.stream_options={include_usage:true};
  if(payload.tools?.length){if(!caps.supports?.tool_calls)throw new ApiError(400,"invalid_request_error","Selected model does not support tools");result.tools=payload.tools.map((tool:any)=>{if(tool.type&&tool.type!=="custom")throw new ApiError(400,"invalid_request_error","Server tools are unsupported by this adapter");return {type:"function",function:{name:tool.name,description:tool.description,parameters:tool.input_schema}};});}
  if(payload.tool_choice){const t=payload.tool_choice;result.tool_choice=t.type==="tool"?{type:"function",function:{name:t.name}}:t.type==="any"?"required":t.type==="none"?"none":"auto";if(t.disable_parallel_tool_use)result.parallel_tool_calls=false;}
  if(payload.stop_sequences)result.stop=payload.stop_sequences;
  if(payload.temperature!==undefined)result.temperature=payload.temperature;if(payload.top_p!==undefined)result.top_p=payload.top_p;
  const efforts=caps.supports?.reasoning_effort;if(Array.isArray(efforts)){const effort=payload.output_config?.effort;if(effort&&efforts.includes(effort))result.reasoning_effort=effort;}
  if(payload.output_config?.format){const f=payload.output_config.format;if(f.type!=="json_schema")throw new ApiError(400,"invalid_request_error","Unsupported output format");result.response_format={type:"json_schema",json_schema:{name:"response",schema:f.schema,strict:true}};}
  return result;
}
export function chatUsage(usage:any){if(!Number.isFinite(usage?.prompt_tokens)||!Number.isFinite(usage?.completion_tokens))throw new ApiError(502,"api_error","Provider response omitted required token usage");
  const cached=usage.prompt_tokens_details?.cached_tokens;return {input_tokens:Math.max(0,usage.prompt_tokens-(cached??0)),output_tokens:usage.completion_tokens,...(cached!==undefined?{cache_read_input_tokens:cached}:{})};}
export function chatStop(reason:string){return reason==="length"?"max_tokens":["tool_calls","function_call"].includes(reason)?"tool_use":"end_turn";}
export function fromChat(response:any,model:string){const choice=response.choices?.[0];if(!choice?.message)throw new ApiError(502,"api_error","Provider omitted its message");
  const content:any[]=[];if(choice.message.reasoning_content)content.push({type:"thinking",thinking:choice.message.reasoning_content,signature:reasoningSignature(choice.message.reasoning_content,model)});
  if(choice.message.content)content.push({type:"text",text:choice.message.content});if(choice.message.refusal)content.push({type:"text",text:choice.message.refusal});
  for(const call of choice.message.tool_calls??[]){let input;try{input=JSON.parse(call.function.arguments);}catch{throw new ApiError(502,"api_error","Invalid provider tool arguments");}content.push({type:"tool_use",id:call.id,name:call.function.name,input});}
  return {id:response.id,type:"message",role:"assistant",model,content,stop_reason:chatStop(choice.finish_reason),stop_sequence:null,usage:chatUsage(response.usage)};
}
export async function* chatStream(response:Response,model:string,onComplete:(value:any)=>void):AsyncGenerator<string>{
  if(!response.body)throw new ApiError(502,"api_error","Empty provider stream");
  let started=false,index=0,textIndex:number|undefined,reasoningIndex:number|undefined,reasoning="",usage:any,finish:string|undefined,complete=false;
  const calls=new Map<number,{id:string;name:string;arguments:string}>();
  for await(const raw of parseSSE(response.body)){
    if(raw.data==="[DONE]"){complete=true;break;}let data:any;try{data=JSON.parse(raw.data);}catch{throw new ApiError(502,"api_error","Malformed provider stream");}
    if(data.error)throw upstreamError(502,data);
    if(!started){started=true;yield frame({type:"message_start",message:{id:data.id,type:"message",role:"assistant",model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:0,output_tokens:0}}});}
    if(data.usage)usage=data.usage;const choice=data.choices?.[0];if(!choice)continue;const delta=choice.delta??{};
    if(delta.reasoning_content){if(reasoningIndex===undefined){reasoningIndex=index++;yield frame({type:"content_block_start",index:reasoningIndex,content_block:{type:"thinking",thinking:"",signature:""}});}reasoning+=delta.reasoning_content;yield frame({type:"content_block_delta",index:reasoningIndex,delta:{type:"thinking_delta",thinking:delta.reasoning_content}});}
    if(delta.content){if(textIndex===undefined){textIndex=index++;yield frame({type:"content_block_start",index:textIndex,content_block:{type:"text",text:""}});}yield frame({type:"content_block_delta",index:textIndex,delta:{type:"text_delta",text:delta.content}});}
    for(const call of delta.tool_calls??[]){const value=calls.get(call.index)??{id:"",name:"",arguments:""};value.id+=call.id??"";value.name+=call.function?.name??"";value.arguments+=call.function?.arguments??"";if(value.arguments.length>16*1024*1024)throw new ApiError(502,"api_error","Provider tool arguments exceeded size limit");calls.set(call.index,value);}
    if(choice.finish_reason)finish=choice.finish_reason;
  }
  if(!complete||!finish)throw new ApiError(502,"api_error","Provider stream ended before completion");
  if(reasoningIndex!==undefined){yield frame({type:"content_block_delta",index:reasoningIndex,delta:{type:"signature_delta",signature:reasoningSignature(reasoning,model)}});yield frame({type:"content_block_stop",index:reasoningIndex});}
  if(textIndex!==undefined)yield frame({type:"content_block_stop",index:textIndex});
  for(const call of calls.values()){if(!call.id||!call.name)throw new ApiError(502,"api_error","Provider returned incomplete tool metadata");try{JSON.parse(call.arguments);}catch{throw new ApiError(502,"api_error","Provider returned invalid tool arguments");}const i=index++;yield frame({type:"content_block_start",index:i,content_block:{type:"tool_use",id:call.id,name:call.name,input:{}}});yield frame({type:"content_block_delta",index:i,delta:{type:"input_json_delta",partial_json:call.arguments}});yield frame({type:"content_block_stop",index:i});}
  const mappedUsage=chatUsage(usage);yield frame({type:"message_delta",delta:{stop_reason:chatStop(finish),stop_sequence:null},usage:mappedUsage});
  onComplete({usage:mappedUsage,content:[...calls.values()].map(()=>({type:"tool_use"}))});yield frame({type:"message_stop"});
}
