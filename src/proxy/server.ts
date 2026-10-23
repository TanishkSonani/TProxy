import { createHmac,randomUUID,timingSafeEqual } from "node:crypto";
import { TokenManager } from "../auth/token-manager";
import { CopilotClient } from "./copilot";
import { ApiError,clampTokens,errorBody,errorResponse,hasImages,initiator,upstreamError } from "./errors";
import { eventStream,parseSSE,frame } from "./sse";
import { toResponses,fromResponses,responsesStream,text } from "./responses";
import { toChat,fromChat,chatStream } from "./chat";
import { asset } from "../dashboard/ui-assets";
import type { MetricsStore } from "../dashboard/store";
import { claudeEnvironment } from "../client/claude-launch";
import { generateEnvScript } from "../client/env-script";
import { DeviceFlow } from "../auth/device-flow";
import {stopSequences} from "./stop-sequences";

export type ProxyConfig={port:number;key:string;models:Record<string,string>;claudeMin?:number;claudeMax?:number;requireApiKey?:boolean;retentionDays?:number};
export type RequestRecord={id:string;at:number;model:string;status:number;latency:number;input:number;output:number;tools:number;session:string;estimated?:boolean;body?:unknown;cacheRead?:number;cacheWrite?:number};
type AutoSelection={model:any;token:string;expires:number};
export async function startProxy(auth:TokenManager,config:ProxyConfig,options:{client?:CopilotClient;record?:(row:RequestRecord)=>void;onStop?:()=>void;metrics?:MetricsStore;saveSettings?:(settings:{port:number;models:Record<string,string>;retentionDays:number;requireApiKey:boolean})=>void}={}) {
  if(!Number.isInteger(config.port)||config.port<1||config.port>65535||!config.key)throw new Error("Invalid proxy configuration");
  const client=options.client??new CopilotClient(auth);let catalog:any;
  try{catalog=await auth.models();}catch(error){if(!(error instanceof Error)||!error.message.startsWith("AUTH_REQUIRED"))throw error;catalog={data:[]};}
  let modelMap=new Map<string,any>((catalog.data??[]).map((m:any)=>[m.id,m]));
  const selections=new Map<string,AutoSelection>(),selectionInflight=new Map<string,Promise<AutoSelection>>();
  const dashboardKey=randomUUID()+randomUUID(),booted=Date.now();
  let pendingPort=config.port,metricsError=false;
  let deviceState:any=null,deviceAbort:AbortController|undefined;
  const equals=(a:string,b:string)=>Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
  const sessionKey=(payload:any)=>createHmac("sha256",config.key).update(String(payload.metadata?.user_id??JSON.stringify(payload.messages?.find((m:any)=>m.role==="user")??randomUUID()))).digest("hex");
  async function select(payload:any,signal:AbortSignal) {
    const mapped=config.models[payload.model]??payload.model;
    if(mapped!=="copilot-auto"){
      let model=modelMap.get(mapped);
      if(!model){catalog=await auth.models();modelMap=new Map((catalog.data??[]).map((m:any)=>[m.id,m]));model=modelMap.get(mapped);}
      if(!model||model.policy?.state==="disabled")throw new ApiError(400,"invalid_request_error","The selected model is unavailable for this account");
      return {model,token:undefined,session:sessionKey(payload)};
    }
    const session=sessionKey(payload),cached=selections.get(session);
    if(cached&&cached.expires>Date.now()+30000)return {...cached,session};
    let pending=selectionInflight.get(session);
    if(!pending){pending=(async()=>{const prompt=[...payload.messages].reverse().filter(m=>m.role==="user").map(m=>text(m.content)).find(Boolean)??"Continue the coding task";
      const result=await client.json("/auto",{prompt,tier:"balance"},{"X-Initiator":"user"},signal);
      if(!result.selected_model?.id||typeof result.session_token!=="string"||!Number.isFinite(Number(result.expires_at)))throw new ApiError(502,"api_error","Provider Auto selection was invalid");
      const selection={model:result.selected_model,token:result.session_token,expires:Number(result.expires_at)*1000};
      if(selections.size>=1000)selections.delete(selections.keys().next().value!);selections.set(session,selection);return selection;
    })();selectionInflight.set(session,pending);pending.finally(()=>selectionInflight.delete(session)).catch(()=>{});}
    return {...await pending,session};
  }
  let server:ReturnType<typeof Bun.serve>;
  server=Bun.serve({hostname:"127.0.0.1",port:config.port,idleTimeout:255,maxRequestBodySize:64*1024*1024,
    error(error){return errorResponse(new ApiError((error as any).status===413?413:500,"api_error","Local request could not be processed"),randomUUID());},
    async fetch(request){const id=randomUUID(),started=Date.now(),url=new URL(request.url);let selected="unknown",session="",recorded=false,requestBody:unknown;
      const record=(message:any,status=200)=>{if(recorded||url.pathname!=="/v1/messages")return;recorded=true;const row={id,at:started,model:selected,status,latency:Date.now()-started,
        input:message?.usage?.input_tokens??0,output:message?.usage?.output_tokens??0,tools:message?.content?.filter((b:any)=>b.type==="tool_use").length??0,session,body:requestBody,cacheRead:message?.usage?.cache_read_input_tokens??0,cacheWrite:message?.usage?.cache_creation_input_tokens??0};
        try{options.metrics?.add(row);options.record?.(row);}catch{metricsError=true;}};
      const controller=new AbortController();const abort=()=>controller.abort();request.signal.addEventListener("abort",abort,{once:true});
      try {
        const host=request.headers.get("host");if(![`127.0.0.1:${config.port}`,`localhost:${config.port}`].includes(host??""))throw new ApiError(403,"permission_error","Invalid local host");
        const origin=request.headers.get("origin");if(origin&&!([`http://127.0.0.1:${config.port}`,`http://localhost:${config.port}`].includes(origin)))throw new ApiError(403,"permission_error","Cross-origin requests are not allowed");
        if(url.pathname==="/health"||url.pathname==="/api/hello")return Response.json({status:"ok",service:"ghcp-bridge"});
        if(request.method==="GET"&&(url.pathname==="/"||url.pathname.startsWith("/assets/"))){const response=await asset(url.pathname);if(response){
          if(url.pathname==="/")response.headers.set("set-cookie",`ghcp_dashboard=${dashboardKey}; HttpOnly; SameSite=Strict; Path=/`);
          response.headers.set("content-security-policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
          response.headers.set("x-content-type-options","nosniff");return response;}}
        const supplied=request.headers.get("authorization")?.replace(/^Bearer /i,"")??request.headers.get("x-api-key")??"";
        const cookie=request.headers.get("cookie")?.split(";").map(v=>v.trim()).find(v=>v.startsWith("ghcp_dashboard="))?.slice("ghcp_dashboard=".length)??"";
        const authenticated=equals(supplied,config.key)||equals(cookie,dashboardKey);
        if(!authenticated && (config.requireApiKey!==false||url.pathname.startsWith("/api/")))throw new ApiError(401,"authentication_error","Invalid local proxy credential");
        if(url.pathname.startsWith("/api/")){
          const json=(value:any)=>Response.json(value,{headers:{"cache-control":"no-store"}});
          if(url.pathname==="/api/status")return json({running:true,port:config.port,uptimeMs:Date.now()-booted,auth:auth.status,device:deviceState,limits:client.observedLimits,metrics:{driver:options.metrics?.driver??null,error:metricsError}});
          if(url.pathname==="/api/summary")return json(options.metrics?.summary()??null);
          if(url.pathname==="/api/logs")return json({requests:options.metrics?.recent()??[],events:options.metrics?.events()??[]});
          if(url.pathname==="/api/catalog")return json([...modelMap.values()].map(m=>({id:m.id,name:m.name,vendor:m.vendor,policy:m.policy,picker:m.model_picker_enabled,endpoints:m.supported_endpoints})));
          if(url.pathname==="/api/refresh"&&request.method==="POST"){await auth.account();return json(auth.status);}
          if(url.pathname==="/api/auth/start"&&request.method==="POST"){
            if(auth.status.source)throw new ApiError(409,"invalid_request_error","An existing GitHub credential is already selected");
            if(deviceState?.state==="pending")return json(deviceState);
            const flow=new DeviceFlow(auth.status.host??"github.com"),code=await flow.start();deviceAbort=new AbortController();
            deviceState={state:"pending",url:code.verification_uri,code:code.user_code,expiresAt:Date.now()+code.expires_in*1000};
            void flow.poll(code,{signal:deviceAbort.signal}).then(async credential=>{await auth.useCredential(credential);catalog=await auth.models();modelMap=new Map((catalog.data??[]).map((m:any)=>[m.id,m]));deviceState={state:"complete"};}).catch(()=>{deviceState={state:"failed"};});
            return json(deviceState);
          }
          if(url.pathname==="/api/env"){
            const shell=url.searchParams.get("shell")??"powershell";if(!["powershell","bash","cmd"].includes(shell))throw new ApiError(400,"invalid_request_error","Unknown shell");
            const env=claudeEnvironment({port:config.port,key:config.key,model:config.models.default,smallModel:config.models.haiku,sonnetModel:config.models.sonnet,opusModel:config.models.opus},{});env.ANTHROPIC_API_KEY=undefined;env.CLAUDE_CODE_OAUTH_TOKEN=undefined;
            return json({script:generateEnvScript(env,shell as "powershell"|"bash"|"cmd")});
          }
          if(url.pathname==="/api/settings"){
            if(request.method==="POST"){
              const input=await request.json() as any;
              if(!Number.isInteger(input?.port)||input.port<1||input.port>65535||!Number.isInteger(input.retentionDays)||input.retentionDays<1||input.retentionDays>3660||typeof input.requireApiKey!=="boolean")throw new ApiError(400,"invalid_request_error","Invalid port, retention or API-key setting");
              const models:Record<string,string>={};for(const slot of ["default","sonnet","opus","haiku"]){const value=input.models?.[slot];if(typeof value!=="string"||(value!=="copilot-auto"&&(!modelMap.has(value)||modelMap.get(value).policy?.state==="disabled")))throw new ApiError(400,"invalid_request_error","Unknown or disabled model mapping");models[slot]=value;}
              options.saveSettings?.({port:input.port,retentionDays:input.retentionDays,requireApiKey:input.requireApiKey,models});
              config.models=models;config.retentionDays=input.retentionDays;config.requireApiKey=input.requireApiKey;pendingPort=input.port;options.metrics?.prune(input.retentionDays);
            } else if(request.method!=="GET")throw new ApiError(405,"invalid_request_error","Method not allowed");
            return json({port:pendingPort,activePort:config.port,retentionDays:config.retentionDays??90,requireApiKey:config.requireApiKey!==false,models:config.models,restartRequired:pendingPort!==config.port});
          }
        }
        if(url.pathname==="/api/stop"&&request.method==="POST"){setTimeout(()=>{deviceAbort?.abort();auth.stop();server.stop(true);options.onStop?.();},100);return Response.json({stopping:true});}
        if(url.pathname==="/v1/models"&&request.method==="GET")return Response.json({data:[{id:"copilot-auto",type:"model",display_name:"Copilot Auto",created_at:"2026-10-23T00:00:00Z"},
          ...[...modelMap.values()].filter((m:any)=>m.policy?.state!=="disabled"&&m.model_picker_enabled).map((m:any)=>({id:m.id,type:"model",display_name:m.name??m.id,created_at:"2026-10-23T00:00:00Z"}))],has_more:false});
        if(!["/v1/messages","/v1/messages/count_tokens"].includes(url.pathname)||request.method!=="POST")throw new ApiError(404,"not_found_error","Unknown endpoint");
        const bytes=await request.arrayBuffer();if(bytes.byteLength>32*1024*1024)throw new ApiError(413,"request_too_large","Request exceeds 32 MB");let payload:any;
        try{payload=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new ApiError(400,"invalid_request_error","Request body must be valid JSON");}
        requestBody=payload;
        if(!auth.status.source&&auth instanceof TokenManager)throw new ApiError(401,"authentication_error","Connect GitHub in the local bridge dashboard first");
        if(typeof payload?.model!=="string")throw new ApiError(400,"invalid_request_error","model must be a string");
        if(!Array.isArray(payload.messages)||!payload.messages.length)throw new ApiError(400,"invalid_request_error","messages must be a non-empty array");
        if(payload.messages.some((m:any)=>!["user","assistant","system","developer"].includes(m.role)))throw new ApiError(400,"invalid_request_error","Unsupported message role");
        if(payload.messages.some((m:any)=>!(typeof m.content==="string"||Array.isArray(m.content))))throw new ApiError(400,"invalid_request_error","message content must be text or content blocks");
        if(url.pathname.endsWith("count_tokens")){
          const mapped=config.models[payload.model]??payload.model,model=modelMap.get(mapped);
          if(model?.vendor==="Anthropic"){
            const response=await client.request("/v1/messages/count_tokens",{...payload,model:mapped},{"anthropic-version":request.headers.get("anthropic-version")??"2023-06-01"},controller.signal);
            if(response.ok)return new Response(response.body,{headers:{"content-type":"application/json","request-id":response.headers.get("request-id")??id}});
            if(![400,404,405,501].includes(response.status)){let data;try{data=await response.json();}catch{}throw upstreamError(response.status,data,response.headers.get("retry-after")??undefined);}
            await response.body?.cancel();
          }
          const estimate=Math.ceil(Buffer.byteLength(JSON.stringify({system:payload.system,messages:payload.messages,tools:payload.tools}))/3)+16*payload.messages.length;
          return Response.json({input_tokens:estimate},{headers:{"x-ghcp-token-count":"estimated","request-id":id}});
        }
        const selection=await select(payload,controller.signal);selected=selection.model.id;session=selection.session;
        const native=selection.model.vendor==="Anthropic",endpoints=selection.model.supported_endpoints??[];
        const headers:Record<string,string>={"X-Initiator":initiator(payload.messages),"X-Request-Id":id};
        if(selection.token)headers["Copilot-Session-Token"]=selection.token;if(hasImages(payload.messages))headers["Copilot-Vision-Request"]="true";
        let path:string,body:any;
        if(native||endpoints.includes("/v1/messages")){
          if(!endpoints.includes("/v1/messages"))throw new ApiError(400,"invalid_request_error","Selected Claude model has no native Messages endpoint");
          if(payload.messages.some((m:any)=>Array.isArray(m.content)&&m.content.some((b:any)=>b.type==="thinking"&&/^ghcp-(responses|chat)-v1:/.test(b.signature??""))))throw new ApiError(400,"invalid_request_error","Other-provider reasoning history cannot be sent to a native Claude model");
          const max=clampTokens(payload.max_tokens,config.claudeMin??100,Math.min(config.claudeMax??4096,selection.model.capabilities?.limits?.max_output_tokens??4096));
          body={...payload,model:selected,max_tokens:max};
          if(body.thinking?.type==="enabled"&&(max<=1024||body.thinking.budget_tokens<1024))throw new ApiError(400,"invalid_request_error","Thinking requires a budget of at least 1024 and a larger output limit");
          if(body.thinking?.type==="enabled"&&body.thinking.budget_tokens>=max)body.thinking={...body.thinking,budget_tokens:max-1};
          path="/v1/messages";headers["anthropic-version"]=request.headers.get("anthropic-version")??"2023-06-01";
          if(request.headers.has("anthropic-beta"))headers["anthropic-beta"]=request.headers.get("anthropic-beta")!;
        } else if(endpoints.includes("/responses")){
          path="/responses";const max=clampTokens(payload.max_tokens,16,selection.model.capabilities?.limits?.max_output_tokens??4096);
          body=toResponses(payload,selected,max,selection.model.capabilities??{});
        } else if(endpoints.includes("/chat/completions")){
          path="/chat/completions";const max=clampTokens(payload.max_tokens,1,selection.model.capabilities?.limits?.max_output_tokens??4096);
          body=toChat(payload,selected,max,selection.model.capabilities??{});
        } else throw new ApiError(400,"invalid_request_error","This model's protocol adapter is not available yet");
        const response=await client.request(path,body,headers,controller.signal);
        const responseId=response.headers.get("request-id")??response.headers.get("x-request-id")??id;
        if(!response.ok){let data;try{data=await response.json();}catch{}throw upstreamError(response.status,data,response.headers.get("retry-after")??undefined);}
        if(!payload.stream){const data=await response.json();const message=path==="/responses"?fromResponses(data,selected,stopSequences(payload.stop_sequences)):path==="/chat/completions"?fromChat(data,selected):data;record(message);return Response.json(message,{headers:{"request-id":responseId}});}
        async function* nativeStream(){let complete=false;const final:any={usage:{},content:[]};
          if(!response.body)throw new ApiError(502,"api_error","Empty provider stream");
          for await(const raw of parseSSE(response.body)){let event:any;try{event=JSON.parse(raw.data);}catch{throw new ApiError(502,"api_error","Malformed provider stream");}
            if(event.type==="error")throw upstreamError(400,event);
            if(event.type==="message_start")Object.assign(final.usage,event.message?.usage);
            if(event.type==="content_block_start"&&event.content_block?.type==="tool_use")final.content.push(event.content_block);
            if(event.type==="message_delta")Object.assign(final.usage,event.usage);
            if(event.type==="message_stop"){complete=true;record(final);}
            yield `event: ${raw.event==="message"?event.type:raw.event}\ndata: ${raw.data}\n\n`;
          }if(!complete)throw new ApiError(502,"api_error","Provider stream ended before message_stop");
        }
        async function* stream(){try{yield* (path==="/responses"?responsesStream(response,selected,record,stopSequences(payload.stop_sequences)):path==="/chat/completions"?chatStream(response,selected,record):nativeStream());}
          catch(error){record(null,error instanceof ApiError?error.status:502);yield frame(errorBody(error));}
          finally{abort();request.signal.removeEventListener("abort",abort);}}
        return new Response(eventStream(stream(),()=>{record(null,499);abort();}),{headers:{"content-type":"text/event-stream","cache-control":"no-cache","request-id":responseId}});
      } catch(error){record(null,error instanceof ApiError?error.status:502);abort();request.signal.removeEventListener("abort",abort);return errorResponse(error,id);}
    }});
  return {server,client,config,stop(){deviceAbort?.abort();server.stop(true);auth.stop();}};
}
