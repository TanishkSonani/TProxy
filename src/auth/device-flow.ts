// Adapted device-flow sequence from ericc-ch/copilot-api at 0ea08febdd7e3e055b03dd298bf57e669500b5c1.
// Copyright (c) 2025 Erick Christian Purwanto; MIT, third_party/licenses/ericc-copilot-api.txt.
import { githubApi, type Credential } from "./providers";
export type DeviceCode = { device_code:string;user_code:string;verification_uri:string;expires_in:number;interval:number };
export class DeviceFlow {
  constructor(private host="github.com",private transport:typeof fetch=fetch) {githubApi(host);}
  private async post(path:string,body:Record<string,string>) {
    return this.transport(`https://${this.host}${path}`,{method:"POST",redirect:"manual",
      headers:{Accept:"application/json","Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams(body),signal:AbortSignal.timeout(30000)});
  }
  async start():Promise<DeviceCode> {
    const response=await this.post("/login/device/code",{client_id:"Iv1.b507a08c87ecfe98",scope:"read:user"});
    if(!response.ok)throw new Error(`GitHub device authorization unavailable (${response.status})`);
    const data=await response.json() as DeviceCode;
    if(!data.device_code||!data.user_code||!Number.isFinite(data.expires_in)||data.expires_in<=0||!Number.isFinite(data.interval)||data.interval<1||new URL(data.verification_uri).origin!==`https://${this.host}`)
      throw new Error("Invalid GitHub device authorization response");
    return data;
  }
  async poll(code:DeviceCode,options:{signal?:AbortSignal;now?:()=>number;sleep?:(ms:number)=>Promise<void>}={}):Promise<Credential> {
    const now=options.now??Date.now,deadline=now()+code.expires_in*1000;let interval=code.interval;
    while(now()<deadline) {
      options.signal?.throwIfAborted();
      await (options.sleep??(ms=>new Promise<void>((resolve,reject)=>{
        const done=()=>{options.signal?.removeEventListener("abort",abort);resolve();};
        const timer=setTimeout(done,ms);
        const abort=()=>{clearTimeout(timer);reject(new Error("Authorization cancelled"));};options.signal?.addEventListener("abort",abort,{once:true});
      })))(interval*1000);
      options.signal?.throwIfAborted();if(now()>=deadline)break;
      const response=await this.post("/login/oauth/access_token",{client_id:"Iv1.b507a08c87ecfe98",device_code:code.device_code,grant_type:"urn:ietf:params:oauth:grant-type:device_code"});
      if(!response.ok)throw new Error(`GitHub device polling failed (${response.status})`);
      const data=await response.json() as any;
      if(typeof data.access_token==="string"&&data.access_token)return {token:data.access_token,source:"device-flow",host:this.host};
      if(data.error==="authorization_pending")continue;
      if(data.error==="slow_down"){interval+=5;continue;}
      throw new Error(data.error==="access_denied"?"GitHub authorization denied":"GitHub device authorization expired or failed");
    }
    throw new Error("GitHub device authorization expired");
  }
}
