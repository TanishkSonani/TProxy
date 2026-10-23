export class ApiError extends Error {
  constructor(readonly status:number,readonly type:string,message:string,readonly retryAfter?:string){super(message);}
}
export function upstreamError(status:number,body:any,retryAfter?:string):ApiError {
  const code=body?.error?.code??body?.code;
  const message=typeof body?.error?.message==="string"?body.error.message:"";
  if(["model_max_prompt_tokens_exceeded","context_length_exceeded","prompt_too_long","max_prompt_tokens_exceeded"].includes(code)||/prompt is too long|maximum context length|prompt token count .* exceeds/i.test(message))
    return new ApiError(400,"invalid_request_error","prompt is too long");
  if(status===429)return new ApiError(429,"rate_limit_error","Rate limit exceeded",retryAfter);
  if(status===401)return new ApiError(401,"authentication_error","Provider authentication expired or was rejected");
  if(status===403)return new ApiError(403,"permission_error","This account is not permitted to use the requested feature");
  if(code==="model_not_supported")return new ApiError(400,"invalid_request_error","The selected model is not available for this account");
  if(status===529||status===503)return new ApiError(529,"overloaded_error","Provider is temporarily overloaded",retryAfter);
  if(status>=500)return new ApiError(502,"api_error","Provider request failed",retryAfter);
  return new ApiError(status===413?413:400,status===413?"request_too_large":"invalid_request_error","Provider rejected the request");
}
export function errorBody(error:unknown){const e=error instanceof ApiError?error:new ApiError(502,"api_error","Provider connection failed");return {type:"error",error:{type:e.type,message:e.message}};}
export function errorResponse(error:unknown,id:string){const e=error instanceof ApiError?error:new ApiError(502,"api_error","Provider connection failed");return Response.json(errorBody(e),{status:e.status,headers:{"request-id":id,...(e.retryAfter?{"retry-after":e.retryAfter}:{})}});}
export function initiator(messages:any[]):"user"|"agent" {
  const last=messages.filter(m=>m.role==="user"||m.role==="assistant").at(-1);return last?.role==="user"&&Array.isArray(last.content)&&last.content.length>0&&last.content.every((b:any)=>b.type==="tool_result")?"agent":"user";
}
export function hasImages(value:any):boolean {if(Array.isArray(value))return value.some(hasImages);if(value&&typeof value==="object")return value.type==="image"||Object.values(value).some(hasImages);return false;}
export function clampTokens(value:unknown,min:number,max:number):number {if(!Number.isInteger(value)||Number(value)<1)throw new ApiError(400,"invalid_request_error","max_tokens must be a positive integer");return Math.min(max,Math.max(min,Number(value)));}
