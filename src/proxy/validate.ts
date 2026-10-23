import {ApiError} from "./errors";
import {stopSequences} from "./stop-sequences";
const invalid=(message:string):never=>{throw new ApiError(400,"invalid_request_error",message);};
export async function readJSON(request:Request,maxBytes=32*1024*1024){
  const bytes=await request.arrayBuffer();if(bytes.byteLength>maxBytes)throw new ApiError(413,"request_too_large","Request body exceeds the supported size");
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{return invalid("Request body must be valid JSON");}
}
export function validateMessages(payload:any,count=false){
  if(!payload||typeof payload!=="object"||Array.isArray(payload))invalid("Request body must be an object");
  if(typeof payload.model!=="string"||!payload.model.trim())invalid("model must be a non-empty string");
  if(payload.stream!==undefined&&typeof payload.stream!=="boolean")invalid("stream must be a boolean");
  if(!count&&(!Number.isInteger(payload.max_tokens)||payload.max_tokens<1))invalid("max_tokens must be a positive integer");
  if(!Array.isArray(payload.messages)||!payload.messages.length)invalid("messages must be a non-empty array");
  stopSequences(payload.stop_sequences);
  if(payload.metadata!==undefined&&(!payload.metadata||typeof payload.metadata!=="object"||Array.isArray(payload.metadata)))invalid("metadata must be an object");
  if(payload.metadata?.user_id!==undefined&&typeof payload.metadata.user_id!=="string")invalid("metadata.user_id must be a string");
  for(const m of payload.messages){
    if(!m||typeof m!=="object"||!["user","assistant","system","developer"].includes(m.role))invalid("Unsupported message role");
    if(typeof m.content!=="string"&&!Array.isArray(m.content))invalid("message content must be text or content blocks");
    if(Array.isArray(m.content))for(const b of m.content){
      if(!b||typeof b!=="object"||typeof b.type!=="string")invalid("Content blocks must contain a type");
      if(b.type==="text"&&typeof b.text!=="string")invalid("Text blocks must contain text");
      if(b.type==="tool_use"&&(typeof b.id!=="string"||!b.id||typeof b.name!=="string"||!b.name||!b.input||typeof b.input!=="object"||Array.isArray(b.input)))invalid("Invalid tool_use block");
      if(b.type==="tool_result"&&(typeof b.tool_use_id!=="string"||!b.tool_use_id||(b.content!==undefined&&typeof b.content!=="string"&&!Array.isArray(b.content))))invalid("Invalid tool_result block");
    }
  }
  if(payload.tools!==undefined&&(!Array.isArray(payload.tools)||payload.tools.some((t:any)=>!t||typeof t!=="object"||typeof t.name!=="string"||!t.name)))invalid("Invalid tool definitions");
  if(payload.thinking?.type==="enabled"&&(!Number.isInteger(payload.thinking.budget_tokens)||payload.thinking.budget_tokens<1024))invalid("Thinking requires a valid budget of at least 1024 tokens");
}
