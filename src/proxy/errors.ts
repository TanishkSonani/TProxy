import {CredentialRejected} from "../auth/token-manager";
export class ApiError extends Error {
  constructor(readonly status:number,readonly type:string,message:string,readonly retryAfter?:string){super(message);}
}
export function upstreamError(status:number,body:any,retryAfter?:string):ApiError {
  const code=body?.error?.code??body?.code;
  const message=typeof body?.error?.message==="string"?body.error.message:"";
  if(["model_max_prompt_tokens_exceeded","context_length_exceeded","prompt_too_long","max_prompt_tokens_exceeded"].includes(code)||/prompt is too long|maximum context length|prompt token count .* exceeds/i.test(message))
    return new ApiError(400,"invalid_request_error","prompt is too long");
  if(status===429||body?.error?.type==="rate_limit_error")return new ApiError(429,"rate_limit_error","Rate limit exceeded",retryAfter);
  if(status===401||body?.error?.type==="authentication_error")return new ApiError(401,"authentication_error","Provider authentication expired or was rejected");
  if(status===403||body?.error?.type==="permission_error")return new ApiError(403,"permission_error","This account is not permitted to use the requested feature");
  if(code==="model_not_supported")return new ApiError(400,"invalid_request_error","The selected model is not available for this account");
  if(status===529||status===503||body?.error?.type==="overloaded_error")return new ApiError(529,"overloaded_error","Provider is temporarily overloaded",retryAfter);
  if(status>=500)return new ApiError(502,"api_error","Provider request failed",retryAfter);
  return new ApiError(status===413?413:400,status===413?"request_too_large":"invalid_request_error","Provider rejected the request");
}
const mapped=(error:unknown)=>error instanceof ApiError?error:error instanceof CredentialRejected?new ApiError(error.status,error.status===403?"permission_error":"authentication_error",error.message):new ApiError(502,"api_error","Provider connection failed");
export function errorBody(error:unknown){const e=mapped(error);return {type:"error",error:{type:e.type,message:e.message}};}
export function errorResponse(error:unknown,id:string){const e=mapped(error);return Response.json(errorBody(e),{status:e.status,headers:{"request-id":id,...(e.retryAfter?{"retry-after":e.retryAfter}:{})}});}
export function initiator(messages:any[]):"user"|"agent" {
  const last=messages.filter(m=>m.role==="user"||m.role==="assistant").at(-1);return last?.role==="user"&&Array.isArray(last.content)&&last.content.length>0&&last.content.every((b:any)=>b.type==="tool_result")?"agent":"user";
}
export function hasImages(value:any):boolean {if(Array.isArray(value))return value.some(hasImages);if(value&&typeof value==="object")return value.type==="image"||Object.values(value).some(hasImages);return false;}
export function clampTokens(value:unknown,min:number,max:number):number {if(!Number.isInteger(value)||Number(value)<1)throw new ApiError(400,"invalid_request_error","max_tokens must be a positive integer");if(!Number.isSafeInteger(min)||!Number.isSafeInteger(max)||min<1||max<min)throw new ApiError(502,"api_error","Provider advertised invalid output limits");return Math.min(max,Math.max(min,Number(value)));}
