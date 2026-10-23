import {existsSync,readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {resolve,join,sep} from "node:path";
import {Database} from "bun:sqlite";
import {secretStore} from "./auth/secure-store";
import type {SecretStore} from "./auth/secure-store";
import {saveConfig} from "./config";
export async function migrateLegacyData(destination:string,legacy=join(process.env.LOCALAPPDATA??"","ghcp-bridge"),stores:(directory:string)=>SecretStore=secretStore){
  const source=resolve(legacy),target=resolve(destination);
  if(source===target||target.startsWith(source+sep)||source.startsWith(target+sep))throw new Error("Migration requires separate source and destination profiles");
  if(!existsSync(source))return {migrated:false,reason:"No legacy profile found"};
  for(const file of ["metrics.sqlite","config.json"])if(existsSync(join(target,file)))throw new Error("TProxy already has data; migration will not overwrite it");
  if(existsSync(join(source,"runtime.json"))){const runtime=JSON.parse(readFileSync(join(source,"runtime.json"),"utf8"));let alive=true;try{process.kill(runtime.pid,0);}catch(e){alive=(e as any).code!=="ESRCH";}if(alive)throw new Error("Stop the legacy server before migrating its database");}
  // SQLite serialization includes committed WAL contents in a standalone snapshot.
  mkdirSync(target,{recursive:true,mode:0o700});
  for(const part of ["","local-api-key"]){const value=await stores(join(source,part)).read();if(value!==null)await stores(join(target,part)).write(value);}
  if(existsSync(join(source,"metrics.sqlite"))){const old=new Database(join(source,"metrics.sqlite"),{readonly:true});try{const out=join(target,"metrics.sqlite");writeFileSync(out,old.serialize(),{mode:0o600,flag:"wx"});const check=new Database(out,{readonly:true});try{const result=check.query("PRAGMA quick_check").get() as any;if(result.quick_check!=="ok")throw new Error("Migrated SQLite history failed integrity checking");}finally{check.close();}}finally{old.close();}}
  if(existsSync(join(source,"config.json"))){const config=JSON.parse(readFileSync(join(source,"config.json"),"utf8").replace(/^\uFEFF/,""));config.dataDir=target;saveConfig(join(target,"config.json"),config);}
  return {migrated:true,historyPreserved:existsSync(join(target,"metrics.sqlite")),legacyRetained:true};
}
