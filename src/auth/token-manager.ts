import { existingCredential, githubApi, type AuthOptions, type Credential } from "./providers";
import type { SecretStore } from "./secure-store";

export type CopilotToken = { token: string; api: string; expiresAt: number; refreshAt: number };
type Cache = { version:1; credential:Credential; copilot:CopilotToken };
export class CredentialRejected extends Error {constructor(readonly status:number){super("GitHub credential was rejected; reconnect GitHub");}}
export type AuthStatus = { source?:string; login?:string; host?:string; api?:string; expiresAt?:number;
  refreshAt?:number; storage:string; plan?:string; sku?:string; organizations?:unknown; quota?:unknown; quotaUpdatedAt?:number;
  quotaRefresh?:{state:"refreshing"|"ready"|"error";attemptedAt:number;nextAttemptAt?:number;message?:string};
  refreshEvents:{at:number;ok:boolean}[] };
export function copilotOrigin(value: unknown): string {
  if(typeof value!=="string")throw new Error("Token exchange did not return endpoints.api");
  const url=new URL(value);
  if(url.protocol!=="https:"||url.username||url.password||url.port||url.search||url.hash||url.pathname!=="/"||
    !(url.hostname.endsWith(".githubcopilot.com")||url.hostname.endsWith(".ghe.com")))
    throw new Error("Unverified Copilot API origin; refusing to forward credentials");
  return url.origin;
}

export class TokenManager {
  private credential?:Credential;private token?:CopilotToken;private inflight?:Promise<CopilotToken>;private timer?:ReturnType<typeof setTimeout>;
  private stopped=false;
  private quotaInflight?:Promise<AuthStatus>;private quotaFailures=0;
  private listeners=new Set<(event:{at:number;ok:boolean})=>void>();
  status:AuthStatus;
  constructor(private store:SecretStore, private options:AuthOptions={}, private deps:{fetch?:typeof fetch;now?:()=>number;provider?:(options:AuthOptions)=>Promise<Credential|null>;background?:boolean}={}) {
    this.status={storage:store.kind,refreshEvents:[],host:options.githubHost??process.env.GH_HOST??"github.com"};
  }
  private now(){return (this.deps.now??Date.now)();}
  private async request(url:string,token:string,github:boolean,body?:unknown,signal?:AbortSignal) {
    return (this.deps.fetch??fetch)(url,{method:body===undefined?"GET":"POST",redirect:"manual",
      headers:{Authorization:`${github?"token":"Bearer"} ${token}`,Accept:"application/json","Content-Type":"application/json",
        "User-Agent":"GitHubCopilotChat/0.71.0","Editor-Version":"vscode/1.143.1","Editor-Plugin-Version":"copilot-chat/0.71.0",
        "Copilot-Integration-Id":"vscode-chat","X-GitHub-Api-Version":url.endsWith("/user")&&!url.includes("copilot_internal")?"2022-11-28":"2026-08-01"},
      body:body===undefined?undefined:JSON.stringify(body),signal:signal??AbortSignal.timeout(30000)});
  }
  async initialize() {
    let cached:Cache|undefined;
    try {const candidate=JSON.parse(await this.store.read()??"null");
      if(candidate?.version===1 && typeof candidate.credential?.token==="string" && typeof candidate.credential?.host==="string" &&
        typeof candidate.copilot?.token==="string" && typeof candidate.copilot?.api==="string" && Number.isFinite(candidate.copilot.expiresAt) && Number.isFinite(candidate.copilot.refreshAt))cached=candidate;
    }catch{}
    this.credential=await (this.deps.provider??existingCredential)(this.options)??
      (cached?.version===1 && cached.credential.host===(this.options.githubHost??process.env.GH_HOST??"github.com") &&
        (!this.options.account||cached.credential.login===this.options.account)?cached.credential:undefined);
    if(!this.credential)throw new Error("AUTH_REQUIRED: no reusable GitHub login; run ghcp-bridge auth");
    githubApi(this.credential.host);
    this.status={...this.status,source:this.credential.source,login:this.credential.login,host:this.credential.host};
    if(cached?.version===1 && cached.credential.token===this.credential.token && cached.copilot.refreshAt>this.now() && cached.copilot.expiresAt>this.now() && cached.copilot.refreshAt<cached.copilot.expiresAt) {
      copilotOrigin(cached.copilot.api);this.token=cached.copilot;this.publish();this.schedule();
    } else await this.refresh();
    await this.account();
    if(this.options.account && this.status.login!==this.options.account)throw new Error("Configured GitHub account does not match the reusable credential");
    return this;
  }
  async useCredential(credential:Credential) {githubApi(credential.host);this.credential=credential;this.token=undefined;
    this.status.login=credential.login;await this.refresh();await this.account();}
  private publish(){if(this.token)Object.assign(this.status,{api:this.token.api,expiresAt:this.token.expiresAt,refreshAt:this.token.refreshAt});}
  private schedule(delay?:number) {
    clearTimeout(this.timer);if(this.stopped||this.deps.background===false)return;
    this.timer=setTimeout(()=>{this.refresh().catch(()=>{this.schedule(30000);});},delay??Math.max(1000,(this.token?.refreshAt??this.now())-this.now()));
    this.timer.unref();
  }
  async refresh(force=false):Promise<CopilotToken> {
    if(this.inflight)return this.inflight;
    if(!force && this.token && this.token.refreshAt>this.now()){this.schedule();return this.token;}
    if(!this.credential)throw new Error("AUTH_REQUIRED");
    this.inflight=(async()=>{
      try {
        let response=await this.request(githubApi(this.credential!.host)+"/copilot_internal/v2/token",this.credential!.token,true);
        if(response.status===401||response.status===403) {
          const renewed=await (this.deps.provider??existingCredential)(this.options);
          if(renewed && renewed.token!==this.credential!.token && renewed.host===this.credential!.host &&
            (!renewed.login || !this.status.login || renewed.login===this.status.login)) {
            this.credential=renewed;response=await this.request(githubApi(renewed.host)+"/copilot_internal/v2/token",renewed.token,true);
          }
        }
        if(response.status===401||response.status===403){this.token=undefined;this.status.expiresAt=undefined;this.status.refreshAt=undefined;throw new CredentialRejected(response.status);}
        if(!response.ok)throw new Error(`GitHub token exchange rejected (${response.status})`);
        const data=await response.json() as any;
        if(typeof data.token!=="string"||!data.token)throw new Error("Malformed Copilot token exchange");
        const api=copilotOrigin(data.endpoints?.api),now=this.now();
        const expiresAt=Number.isFinite(Number(data.expires_at))?Number(data.expires_at)*1000:now+Number(data.refresh_in)*1000;
        const refreshIn=Number(data.refresh_in),refreshAt=Math.min(expiresAt-Math.min(60000,Math.max(1000,(expiresAt-now)/10)),Number.isFinite(refreshIn)&&refreshIn>0?now+Math.max(1,refreshIn-60)*1000:Infinity);
        if(!Number.isFinite(expiresAt)||!Number.isFinite(refreshAt)||expiresAt<=now)throw new Error("Invalid token expiry");
        const token={token:data.token,api,expiresAt,refreshAt};
        await this.store.write(JSON.stringify({version:1,credential:this.credential,copilot:token}));
        this.token=token;Object.assign(this.status,{source:this.credential!.source,host:this.credential!.host});this.publish();
        this.event(true);this.schedule();return token;
      } catch(error){this.event(false);throw error;}
      finally{this.inflight=undefined;}
    })();return this.inflight;
  }
  onRefresh(listener:(event:{at:number;ok:boolean})=>void){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  private event(ok:boolean){const event={at:this.now(),ok};this.status.refreshEvents.push(event);this.status.refreshEvents=this.status.refreshEvents.slice(-100);for(const listener of this.listeners){try{listener(event);}catch{}}}
  async get():Promise<CopilotToken> {
    if(!this.token||this.token.refreshAt<=this.now()||this.token.expiresAt<=this.now()) {
      try{return await this.refresh();}catch(error){if(!this.token||this.token.expiresAt<=this.now())throw error;}
    }
    return this.token!;
  }
  async account() {
    if(!this.credential)return;
    const base=githubApi(this.credential.host);
    const responses=await Promise.allSettled([this.request(base+"/user",this.credential.token,true),this.request(base+"/copilot_internal/user",this.credential.token,true)]);
    for(let i=0;i<responses.length;i++){const result=responses[i];if(result.status!=="fulfilled"||!result.value.ok)continue;
      try {const data=await result.value.json() as any;if(i===0)this.status.login=data.login;
        else this.applyQuota(data);}catch{}
    }
  }
  private applyQuota(data:any){
    if(!data?.quota_snapshots||typeof data.quota_snapshots!=="object"||Array.isArray(data.quota_snapshots))return false;
    for(const [field,key]of [["plan","copilot_plan"],["sku","access_type_sku"],["organizations","organization_login_list"]] as const)if(data[key]!==undefined)(this.status as any)[field]=data[key];
    const at=this.now();this.status.quota=data.quota_snapshots;this.status.quotaUpdatedAt=at;
    this.status.quotaRefresh={state:"ready",attemptedAt:at,nextAttemptAt:at+15000};this.quotaFailures=0;return true;
  }
  async refreshQuota():Promise<AuthStatus>{
    if(this.quotaInflight)return this.quotaInflight;
    if((this.status.quotaRefresh?.nextAttemptAt??0)>this.now())return this.status;
    this.quotaInflight=(async()=>{
      const at=this.now();let retryAfter:string|null=null,message="Account quota could not be refreshed. Last received data is retained.";
      this.status.quotaRefresh={state:"refreshing",attemptedAt:at};
      try{
        if(!this.credential){message="Connect a GitHub account to retrieve quota data.";throw new Error("No credential");}
        const response=await this.request(githubApi(this.credential.host)+"/copilot_internal/user",this.credential.token,true);
        retryAfter=response.headers.get("retry-after");
        if(!response.ok){
          if(response.status===429)message="GitHub rate-limited quota refresh. Automatic retry will wait.";
          else if([401,403].includes(response.status))message="GitHub denied quota access for the selected account. Model authentication was not changed by this check.";
          await response.body?.cancel();throw new Error("Quota request rejected");
        }
        if(!this.applyQuota(await response.json())){message="GitHub did not return quota data. Last received data is retained.";throw new Error("Missing quota");}
      }catch{
        const failedAt=this.now(),backoff=Math.min(300000,30000*2**Math.min(this.quotaFailures++,4));
        let delay=retryAfter!==null?Number(retryAfter)*1000:NaN;
        if(!Number.isFinite(delay)&&retryAfter)delay=Date.parse(retryAfter)-failedAt;
        this.status.quotaRefresh={state:"error",attemptedAt:at,message,nextAttemptAt:failedAt+Math.min(8640000000000000-failedAt,Math.max(backoff,Number.isFinite(delay)?delay:0))};
      }
      return this.status;
    })();
    try{return await this.quotaInflight;}finally{this.quotaInflight=undefined;}
  }
  async models(){const token=await this.get();const response=await this.request(token.api+"/models",token.token,false);if(!response.ok)throw new Error(`Model discovery failed (${response.status})`);return response.json() as Promise<any>;}
  stop(){this.stopped=true;clearTimeout(this.timer);}
}
