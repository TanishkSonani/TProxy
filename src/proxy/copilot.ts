import { TokenManager } from "../auth/token-manager";
import { ApiError,upstreamError } from "./errors";
export class CopilotClient {
  observedLimits:Record<string,string>={};
  limitsObservedAt:number|null=null;
  constructor(readonly auth:TokenManager,private transport:typeof fetch=fetch){}
  async request(path:string,body?:any,headers:Record<string,string>={},signal?:AbortSignal):Promise<Response> {
    if(!["/models","/auto","/responses","/chat/completions","/v1/messages","/v1/messages/count_tokens"].includes(path))throw new ApiError(400,"invalid_request_error","Unsupported provider path");
    let authRetried=false;
    for(let attempt=0;attempt<3;attempt++){
      signal?.throwIfAborted();
      const token=await this.auth.get();
      const response=await this.transport(token.api+path,{method:body===undefined?"GET":"POST",redirect:"manual",signal:signal?AbortSignal.any([signal,AbortSignal.timeout(300000)]):AbortSignal.timeout(300000),
        headers:{Authorization:`Bearer ${token.token}`,"Content-Type":"application/json",Accept:body?.stream?"text/event-stream":"application/json",
          "Copilot-Integration-Id":"vscode-chat","Editor-Version":"vscode/1.143.1","Editor-Plugin-Version":"copilot-chat/0.71.0",
          "User-Agent":"GitHubCopilotChat/0.71.0","X-GitHub-Api-Version":"2026-08-01","OpenAI-Intent":"conversation-panel",...headers},
        body:body===undefined?undefined:JSON.stringify(body)});
      for(const [key,value]of response.headers)if(key.startsWith("x-ratelimit-")||key==="retry-after"){this.observedLimits[key]=value;this.limitsObservedAt=Date.now();}
      if(response.status===401&&!authRetried){authRetried=true;await response.body?.cancel();await this.auth.refresh(true);continue;}
      if([500,502,503,504].includes(response.status)&&attempt<2){
        const retry=response.headers.get("retry-after");let delay=retry?Number(retry)*1000:NaN;
        if(!Number.isFinite(delay)&&retry)delay=Date.parse(retry)-Date.now();if(!Number.isFinite(delay))delay=250*2**attempt;
        // Large Retry-After is returned rather than retried prematurely.
        if(delay>30000)return response;await response.body?.cancel();
        await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new Error("Request cancelled"));};const timer=setTimeout(()=>{signal?.removeEventListener("abort",abort);resolve();},Math.max(0,delay));if(signal?.aborted)abort();else signal?.addEventListener("abort",abort,{once:true});});continue;
      }
      return response;
    }
    throw new ApiError(502,"api_error","Provider request could not complete");
  }
  async json(path:string,body?:any,headers?:Record<string,string>,signal?:AbortSignal){const response=await this.request(path,body,headers,signal);let data:any;
    try{data=await response.json();}catch{throw new ApiError(502,"api_error","Provider returned an invalid response");}
    if(!response.ok)throw upstreamError(response.status,data,response.headers.get("retry-after")??undefined);return data;
  }
}
