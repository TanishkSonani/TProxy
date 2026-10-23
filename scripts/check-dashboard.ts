import {resolve,join} from "node:path";
import {secretStore} from "../src/auth/secure-store";
const root=resolve(process.argv[2]??"evidence/private/auth-runtime"),port=Number(process.argv[3]??4141);
const key=await secretStore(join(root,"local-api-key")).read();if(!key)throw new Error("No local credential");
const base=`http://127.0.0.1:${port}`;
const get=async(path:string)=>{const r=await fetch(base+path,{headers:{Authorization:`Bearer ${key}`}});if(!r.ok)throw new Error(`Dashboard check failed (${r.status})`);return r.json() as any;};
const [status,summary,logs]=await Promise.all([get("/api/status"),get("/api/summary"),get("/api/logs")]);
const rootResponse=await fetch(base+"/"),html=await rootResponse.text();
const assets=[...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(m=>m[1]);
if(assets.length<2)throw new Error("Missing UI assets");for(const path of assets){const r=await fetch(base+path);if(!r.ok)throw new Error("Missing UI asset");}
if(rootResponse.headers.has("set-cookie"))throw new Error("Dashboard granted unauthenticated access");
const session=await fetch(base+"/api/session",{method:"POST",headers:{Authorization:`Bearer ${key}`}});if(!session.headers.get("set-cookie")?.includes("HttpOnly"))throw new Error("Missing authenticated dashboard session");
if((await fetch(base+"/api/status")).status!==401)throw new Error("Management authentication missing");
console.log(JSON.stringify({account:status.auth.login,plan:status.auth.plan,driver:status.metrics.driver,requests:summary.totals.requests,input:summary.totals.input,output:summary.totals.output,latestModel:logs.requests[0]?.model,assets:assets.length},null,2));
