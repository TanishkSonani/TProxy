import { createHmac,randomUUID,timingSafeEqual } from "node:crypto";
import { TokenManager } from "../auth/token-manager";
import { CopilotClient } from "./copilot";
import { ApiError,clampTokens,errorBody,errorResponse,hasImages,initiator,upstreamError } from "./errors";
import { eventStream,parseSSE,frame } from "./sse";
import { toResponses,fromResponses,responsesStream,text } from "./responses";
import { toChat,fromChat,chatStream } from "./chat";
import { asset } from "../dashboard/ui-assets";
import type { MetricsStore,MetricsFilter } from "../dashboard/store";
import { claudeEnvironment } from "../client/claude-launch";
import { generateEnvScript } from "../client/env-script";
import { DeviceFlow } from "../auth/device-flow";
import {stopSequences} from "./stop-sequences";
import {contextPolicy,modelContext} from "../client/context-window";
import {readJSON,validateMessages} from "./validate";

export type ProxyConfig={port:number;key:string;models:Record<string,string>;claudeMin?:number;claudeMax?:number;requireApiKey?:boolean;retentionDays?:number;contextWindowTokens?:number;contextFallbackTokens?:number;tls?:{caFile?:string}};
export type RequestRecord={id:string;at:number;model:string;status:number;latency:number;input:number;output:number;tools:number;session:string;estimated?:boolean;body?:unknown;cacheRead?:number;cacheWrite?:number};
type AutoSelection={model:any;token:string;expires:number};
type StartupState={state:"starting"|"ready"|"needs_auth"|"waiting"|"loading"|"error";message?:string;updatedAt?:number};
function startupMessage(error:unknown){
  const message=error instanceof Error?error.message:"Unknown upstream startup failure";
  if(/certificate|TLS CA|CERT_|ERR_TLS_|SSL_/i.test(message))
    return "TLS certificate verification or CA configuration failed. Check the host's approved system trust or configure tls.caFile with an approved PEM CA bundle; certificate and hostname checks stay enabled.";
  if(message.startsWith("AUTH_REQUIRED"))return "No reusable GitHub login was found. Connect GitHub from the dashboard.";
  if(/credential was rejected|token exchange rejected \((401|403)\)/i.test(message))return "GitHub rejected the selected credential. Reconnect that account or check its access.";
  return "Upstream initialization failed. Check connectivity, proxy configuration and account access, then retry.";
}
export async function startProxy(auth:TokenManager,config:ProxyConfig,options:{client?:CopilotClient;transport?:typeof fetch;initializeAuth?:()=>Promise<unknown>;record?:(row:RequestRecord)=>void;onStop?:()=>void;metrics?:MetricsStore;saveSettings?:(settings:{port:number;models:Record<string,string>;retentionDays:number;requireApiKey:boolean})=>void}={}) {
  if(!Number.isInteger(config.port)||config.port<1||config.port>65535||!config.key)throw new Error("Invalid proxy configuration");
  const client=options.client??new CopilotClient(auth,options.transport);let catalog:any={data:[]};
  let modelMap=new Map<string,any>(),catalogAt=0;
  let authStartup:StartupState={state:options.initializeAuth?"starting":"ready"},catalogStartup:StartupState={state:"waiting"};
  let catalogInflight:Promise<void>|undefined;
  async function refreshCatalog(){
    if(catalogInflight)return catalogInflight;
    catalogStartup={state:"loading"};
    catalogInflight=(async()=>{
      try{catalog=await auth.models();modelMap=new Map((catalog.data??[]).map((m:any)=>[m.id,m]));catalogAt=Date.now();catalogStartup={state:"ready",updatedAt:catalogAt};}
      catch(error){catalogStartup={state:"error",message:startupMessage(error)};throw error;}
    })();
    try{await catalogInflight;}finally{catalogInflight=undefined;}
  }
  async function initializeUpstream(){
    if(options.initializeAuth){
      authStartup={state:"starting"};
      try{await options.initializeAuth();authStartup={state:auth.status.source?"ready":"needs_auth",...(auth.status.source?{}:{message:"Connect GitHub from the dashboard to authenticate."})};}
      catch(error){authStartup=error instanceof Error&&error.message.startsWith("AUTH_REQUIRED")?{state:"needs_auth",message:startupMessage(error)}:{state:"error",message:startupMessage(error)};catalogStartup={state:"waiting"};return;}
      if(authStartup.state==="needs_auth")return;
    }
    try{await refreshCatalog();}catch{}
  }
  let startup:Promise<void>;
  const selections=new Map<string,AutoSelection>(),selectionInflight=new Map<string,Promise<AutoSelection>>();
  let autoContextAt=0,autoContext:AutoSelection|undefined,contextInflight:Promise<void>|undefined;
  const context= (mapping=config.models)=>({...contextPolicy(modelMap.values(),mapping,config.contextWindowTokens,[...(autoContext&&autoContext.expires>Date.now()+30000&&Date.now()-autoContextAt<300000?[autoContext.model]:[]),...[...selections.values()].filter(s=>s.expires>Date.now()+30000).map(s=>s.model)],config.contextFallbackTokens),fetchedAt:catalogAt,autoDiscoveredAt:autoContextAt||null});
  const autoReady=()=>autoContext&&autoContext.expires>Date.now()+30000&&Date.now()-autoContextAt<300000;
  const hydrate=(model:any)=>{const base=modelMap.get(model.id);return {...base,...model,capabilities:{...base?.capabilities,...model.capabilities,limits:{...base?.capabilities?.limits,...model.capabilities?.limits},supports:{...base?.capabilities?.supports,...model.capabilities?.supports}}};};
  async function discoverContext(needsAuto=Object.values(config.models).includes("copilot-auto")){
    if(contextInflight){await contextInflight;if(needsAuto&&!autoReady())return discoverContext(true);return;}
    contextInflight=(async()=>{
      await refreshCatalog();
      if(needsAuto&&!autoReady()){
        const result=await client.json("/auto",{prompt:"Determine the model for an interactive coding session",tier:"balance"},{"X-Initiator":"user"},AbortSignal.timeout(20000));
        if(typeof result.selected_model?.id!=="string"||!result.selected_model.id||typeof result.session_token!=="string"||!result.session_token||!Number.isFinite(Number(result.expires_at))||Number(result.expires_at)*1000<=Date.now()+30000)throw new ApiError(502,"api_error","Provider Auto discovery was invalid");
        autoContext={model:hydrate(result.selected_model),token:result.session_token,expires:Number(result.expires_at)*1000};autoContextAt=Date.now();
      }
    })();try{await contextInflight;}finally{contextInflight=undefined;}
  }
  const dashboardKey=randomUUID()+randomUUID(),booted=Date.now();
  let pendingPort=config.port,metricsError=false;
  let deviceState:any=null,deviceAbort:AbortController|undefined;
  const equals=(a:string,b:string)=>Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
  const sessionKey=(payload:any)=>createHmac("sha256",config.key).update(String(payload.metadata?.user_id??JSON.stringify(payload.messages?.find((m:any)=>m.role==="user")??randomUUID()))).digest("hex");
  async function select(payload:any,signal:AbortSignal) {
    const mapped=config.models[payload.model]??payload.model;
    if(mapped!=="copilot-auto"){
      let model=modelMap.get(mapped);
      if(!model||Date.now()-catalogAt>300000){await refreshCatalog();model=modelMap.get(mapped);}
      if(!model||model.policy?.state==="disabled")throw new ApiError(400,"invalid_request_error","The selected model is unavailable for this account");
      return {model,token:undefined,session:sessionKey(payload)};
    }
    const session=sessionKey(payload),cached=selections.get(session);
    if(cached&&cached.expires>Date.now()+30000)return {...cached,session};
    let pending=selectionInflight.get(session);
    if(!pending){pending=(async()=>{const prompt=[...payload.messages].reverse().filter(m=>m.role==="user").map(m=>text(m.content)).find(Boolean)??"Continue the coding task";
      const result=await client.json("/auto",{prompt,tier:"balance"},{"X-Initiator":"user"},signal);
      if(typeof result.selected_model?.id!=="string"||!result.selected_model.id||typeof result.session_token!=="string"||!result.session_token||!Number.isFinite(Number(result.expires_at))||Number(result.expires_at)*1000<=Date.now()+30000)throw new ApiError(502,"api_error","Provider Auto selection was invalid");
      const selection={model:hydrate(result.selected_model),token:result.session_token,expires:Number(result.expires_at)*1000};
      if(selections.size>=1000)selections.delete(selections.keys().next().value!);selections.set(session,selection);return selection;
    })();selectionInflight.set(session,pending);pending.finally(()=>selectionInflight.delete(session)).catch(()=>{});}
    return {...await pending,session};
  }
  let server:ReturnType<typeof Bun.serve>;
  server=Bun.serve({hostname:"127.0.0.1",port:config.port,idleTimeout:255,maxRequestBodySize:64*1024*1024,
    error(error){return errorResponse(new ApiError((error as any).status===413?413:500,"api_error","Local request could not be processed"),randomUUID());},
    async fetch(request){const id=randomUUID(),started=Date.now(),url=new URL(request.url);let selected="unknown",session="",recorded=false,requestBody:unknown,streaming=false;
      const record=(message:any,status=200)=>{if(recorded||url.pathname!=="/v1/messages")return;recorded=true;const row={id,at:started,model:selected,status,latency:Date.now()-started,
        input:message?.usage?.input_tokens??0,output:message?.usage?.output_tokens??0,tools:message?.content?.filter((b:any)=>b.type==="tool_use").length??0,session,body:requestBody,cacheRead:message?.usage?.cache_read_input_tokens??0,cacheWrite:message?.usage?.cache_creation_input_tokens??0};
        try{options.metrics?.add(row);options.record?.(row);}catch{metricsError=true;}};
      const controller=new AbortController();const abort=()=>controller.abort();request.signal.addEventListener("abort",abort,{once:true});
      try {
        const host=request.headers.get("host");if(![`127.0.0.1:${config.port}`,`localhost:${config.port}`].includes(host??""))throw new ApiError(403,"permission_error","Invalid local host");
        const origin=request.headers.get("origin");if(origin&&!([`http://127.0.0.1:${config.port}`,`http://localhost:${config.port}`].includes(origin)))throw new ApiError(403,"permission_error","Cross-origin requests are not allowed");
        if(url.pathname==="/health"||url.pathname==="/api/hello")return Response.json({status:"ok",service:"tproxy"});
        if(request.method==="GET"&&(url.pathname==="/"||url.pathname.startsWith("/assets/"))){const response=await asset(url.pathname);if(response){
          response.headers.set("referrer-policy","no-referrer");
          response.headers.set("content-security-policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
          response.headers.set("x-content-type-options","nosniff");return response;}}
        const supplied=request.headers.get("authorization")?.replace(/^Bearer /i,"")??request.headers.get("x-api-key")??"";
        const cookie=request.headers.get("cookie")?.split(";").map(v=>v.trim()).find(v=>v.startsWith("ghcp_dashboard="))?.slice("ghcp_dashboard=".length)??"";
        const authenticated=equals(supplied,config.key)||equals(cookie,dashboardKey);
        if(url.pathname==="/api/session"&&request.method==="POST"){
          if(!equals(supplied,dashboardKey)&&!equals(supplied,config.key))throw new ApiError(401,"authentication_error","Open an authenticated dashboard link from tproxy dashboard");
          return Response.json({connected:true},{headers:{"cache-control":"no-store","set-cookie":`ghcp_dashboard=${dashboardKey}; HttpOnly; SameSite=Strict; Path=/`}});
        }
        if(!authenticated && (config.requireApiKey!==false||url.pathname.startsWith("/api/")))throw new ApiError(401,"authentication_error","Invalid local proxy credential");
        if(url.pathname.startsWith("/api/")){
          const json=(value:any)=>Response.json(value,{headers:{"cache-control":"no-store"}});
          if(url.pathname==="/api/dashboard-link")return json({url:`http://127.0.0.1:${config.port}/#session=${dashboardKey}`});
          if(url.pathname==="/api/status")return json({running:true,port:config.port,uptimeMs:Date.now()-booted,contextWindowTokens:context().tokens,context:context(),auth:auth.status,startup:{auth:authStartup,catalog:catalogStartup},device:deviceState,limits:client.observedLimits,limitsObservedAt:client.limitsObservedAt??null,metrics:{driver:options.metrics?.driver??null,error:metricsError}});
          if(url.pathname==="/api/context"&&request.method==="POST"){
            const input=await readJSON(request,65536);if(!input||typeof input!=="object"||Array.isArray(input)||(input.model!==undefined&&typeof input.model!=="string"))throw new ApiError(400,"invalid_request_error","Context options must be an object with an optional model string");
            const mapping=input?.model?{...config.models,default:config.models[input.model]??input.model}:config.models;
            await discoverContext(Object.values(mapping).includes("copilot-auto"));return json(context(mapping));
          }
          if(url.pathname==="/api/summary"||url.pathname==="/api/logs"||url.pathname==="/api/activity"){
            const filter:MetricsFilter={};
            for(const key of ["from","to"] as const){const value=url.searchParams.get(key);if(value!==null){const n=Number(value);if(!/^\d+$/.test(value)||!Number.isSafeInteger(n)||n>8640000000000000)throw new ApiError(400,"invalid_request_error","Invalid date range");filter[key]=n;}}
            if(filter.from!==undefined&&filter.to!==undefined&&(filter.from>=filter.to||filter.to-filter.from>3660*86400000))throw new ApiError(400,"invalid_request_error","Invalid date range");
            const model=url.searchParams.get("model"),status=url.searchParams.get("status");
            if(model){if(model.length>200)throw new ApiError(400,"invalid_request_error","Invalid model filter");filter.model=model;}
            if(status){if(!["success","error","429"].includes(status))throw new ApiError(400,"invalid_request_error","Invalid status filter");filter.status=status as MetricsFilter["status"];}
            return url.pathname==="/api/summary"?json(options.metrics?.summary(90,Date.now(),filter)??null):url.pathname==="/api/activity"?json(options.metrics?.summary(365,Date.now(),filter)??null):json({requests:options.metrics?.recent(200,0,filter)??[],events:options.metrics?.events()??[],limit:200});
          }
          if(url.pathname==="/api/catalog")return json([...modelMap.values()].map(m=>({id:m.id,name:m.name,vendor:m.vendor,policy:m.policy,picker:m.model_picker_enabled,endpoints:m.supported_endpoints,limits:m.capabilities?.limits})));
          if(url.pathname==="/api/quota"&&request.method==="POST"){
            if(typeof auth.refreshQuota!=="function")throw new ApiError(503,"api_error","Account quota refresh is unavailable");
            await startup;return json(await auth.refreshQuota());
          }
          if(url.pathname==="/api/refresh"&&request.method==="POST"){
            try{
              if(typeof (auth as any).initialize==="function"){authStartup={state:"starting"};await auth.initialize();authStartup={state:auth.status.source?"ready":"needs_auth"};}
              else await auth.account();
            }catch(error){authStartup=error instanceof Error&&error.message.startsWith("AUTH_REQUIRED")?{state:"needs_auth",message:startupMessage(error)}:{state:"error",message:startupMessage(error)};throw error;}
            await refreshCatalog();
            return json(auth.status);
          }
          if(url.pathname==="/api/auth/start"&&request.method==="POST"){
            if(auth.status.source)throw new ApiError(409,"invalid_request_error","An existing GitHub credential is already selected");
            if(deviceState?.state==="pending")return json(deviceState);
            const flow=new DeviceFlow(auth.status.host??"github.com",options.transport),code=await flow.start();deviceAbort=new AbortController();
            deviceState={state:"pending",url:code.verification_uri,code:code.user_code,expiresAt:Date.now()+code.expires_in*1000};
            void flow.poll(code,{signal:deviceAbort.signal}).then(async credential=>{await auth.useCredential(credential);authStartup={state:"ready"};deviceState={state:"complete"};void refreshCatalog().catch(()=>{});}).catch(error=>{authStartup={state:"error",message:startupMessage(error)};deviceState={state:"failed"};});
            return json(deviceState);
          }
          if(url.pathname==="/api/env"){
            await discoverContext();
            const shell=url.searchParams.get("shell")??"powershell";if(!["powershell","bash","cmd"].includes(shell))throw new ApiError(400,"invalid_request_error","Unknown shell");
            const env=claudeEnvironment({port:config.port,key:config.key,model:config.models.default,smallModel:config.models.haiku,sonnetModel:config.models.sonnet,opusModel:config.models.opus,contextWindowTokens:context().tokens},{});env.ANTHROPIC_API_KEY=undefined;env.CLAUDE_CODE_OAUTH_TOKEN=undefined;
            return json({script:generateEnvScript(env,shell as "powershell"|"bash"|"cmd")});
          }
          if(url.pathname==="/api/settings"){
            if(request.method==="POST"){
              const input=await readJSON(request,65536);
              if(!Number.isInteger(input?.port)||input.port<1||input.port>65535||!Number.isInteger(input.retentionDays)||input.retentionDays<1||input.retentionDays>3660||typeof input.requireApiKey!=="boolean")throw new ApiError(400,"invalid_request_error","Invalid port, retention or API-key setting");
              const models:Record<string,string>={};for(const slot of ["default","sonnet","opus","haiku"]){const value=input.models?.[slot];if(typeof value!=="string"||(value!=="copilot-auto"&&(!modelMap.has(value)||modelMap.get(value).policy?.state==="disabled")))throw new ApiError(400,"invalid_request_error","Unknown or disabled model mapping");models[slot]=value;}
              options.saveSettings?.({port:input.port,retentionDays:input.retentionDays,requireApiKey:input.requireApiKey,models});
              config.models=models;config.retentionDays=input.retentionDays;config.requireApiKey=input.requireApiKey;pendingPort=input.port;options.metrics?.prune(input.retentionDays);
            } else if(request.method!=="GET")throw new ApiError(405,"invalid_request_error","Method not allowed");
            return json({port:pendingPort,activePort:config.port,retentionDays:config.retentionDays??90,requireApiKey:config.requireApiKey!==false,models:config.models,restartRequired:pendingPort!==config.port});
          }
        }
        if(url.pathname==="/api/stop"&&request.method==="POST"){setTimeout(()=>{deviceAbort?.abort();auth.stop();server.stop(true);options.onStop?.();},100);return Response.json({stopping:true});}
        if(url.pathname==="/v1/models"&&request.method==="GET")return Response.json({data:[{id:"copilot-auto",type:"model",display_name:"Copilot Auto",created_at:"2026-10-23T00:00:00Z",max_input_tokens:autoContext?modelContext(autoContext.model)?.tokens:undefined},
          ...[...modelMap.values()].filter((m:any)=>m.policy?.state!=="disabled"&&m.model_picker_enabled).map((m:any)=>({id:m.id,type:"model",display_name:m.name??m.id,created_at:"2026-10-23T00:00:00Z",max_input_tokens:modelContext(m)?.tokens,max_tokens:m.vendor==="Anthropic"?Math.min(config.claudeMax??4096,m.capabilities?.limits?.max_output_tokens??4096):m.capabilities?.limits?.max_output_tokens}))],has_more:false});
        if(!["/v1/messages","/v1/messages/count_tokens"].includes(url.pathname)||request.method!=="POST")throw new ApiError(404,"not_found_error","Unknown endpoint");
        const payload=await readJSON(request);
        requestBody=payload;
        if(!auth.status.source&&auth instanceof TokenManager)throw new ApiError(401,"authentication_error","Connect GitHub in the local bridge dashboard first");
        validateMessages(payload,url.pathname.endsWith("count_tokens"));
        if(url.pathname.endsWith("count_tokens")){
          const mapped=config.models[payload.model]??payload.model,model=modelMap.get(mapped);
          if(model?.vendor==="Anthropic"){
            const response=await client.request("/v1/messages/count_tokens",{...payload,model:mapped},{"anthropic-version":request.headers.get("anthropic-version")??"2023-06-01"},controller.signal);
            if(response.ok)return Response.json(await response.json(),{headers:{"request-id":response.headers.get("request-id")??id}});
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
            if(complete)break;
          }if(!complete)throw new ApiError(502,"api_error","Provider stream ended before message_stop");
        }
        async function* stream(){try{yield* (path==="/responses"?responsesStream(response,selected,record,stopSequences(payload.stop_sequences)):path==="/chat/completions"?chatStream(response,selected,record):nativeStream());}
          catch(error){record(null,errorResponse(error,id).status);yield frame(errorBody(error));}
          finally{abort();request.signal.removeEventListener("abort",abort);}}
        streaming=true;return new Response(eventStream(stream(),()=>{record(null,499);abort();}),{headers:{"content-type":"text/event-stream","cache-control":"no-cache","request-id":responseId}});
      } catch(error){const response=errorResponse(error,id);record(null,request.signal.aborted?499:response.status);return response;}
      finally{if(!streaming){abort();request.signal.removeEventListener("abort",abort);}}
    }});
  startup=initializeUpstream();
  return {server,client,config,startup,dashboardURL:`http://127.0.0.1:${config.port}/#session=${dashboardKey}`,stop(){deviceAbort?.abort();server.stop(true);auth.stop();}};
}
