import { existsSync,readFileSync,mkdirSync,writeFileSync,renameSync,unlinkSync } from "node:fs";
import {randomUUID} from "node:crypto";
import { join,resolve,dirname } from "node:path";
import { homedir } from "node:os";
import type { AuthOptions } from "./auth/providers";
export type Config = {port:number;dataDir:string;models:Record<string,string>;retentionDays:number;requireApiKey:boolean;contextWindowTokens?:number;contextFallbackTokens:number;auth:AuthOptions};
export function loadConfig(path?:string,dataDir?:string):Config {
  const root=resolve(dataDir??process.env.TPROXY_DATA_DIR??process.env.GHCP_BRIDGE_DATA_DIR??join(process.env.LOCALAPPDATA??join(homedir(),".local/share"),"TProxy"));
  const file=path??join(root,"config.json");const input=existsSync(file)?JSON.parse(readFileSync(file,"utf8").replace(/^\uFEFF/,"")):{};
  if(!input||typeof input!=="object"||Array.isArray(input))throw new Error("Bridge configuration must be a JSON object");
  if(input.models!==undefined&&(!input.models||typeof input.models!=="object"||Array.isArray(input.models)||Object.values(input.models).some(v=>typeof v!=="string"||!v.trim())))throw new Error("Model mappings must contain non-empty model IDs");
  if(input.auth!==undefined&&(!input.auth||typeof input.auth!=="object"||Array.isArray(input.auth)))throw new Error("auth must be an object");
  const config={port:4141,dataDir:root,retentionDays:90,requireApiKey:true,contextFallbackTokens:200000,auth:{},...input,models:{default:"copilot-auto",sonnet:"copilot-auto",opus:"copilot-auto",haiku:"copilot-auto",...input.models}};
  if(!Number.isInteger(config.port)||config.port<1||config.port>65535||!Number.isInteger(config.retentionDays)||config.retentionDays<1||config.retentionDays>3660||typeof config.requireApiKey!=="boolean")throw new Error("Invalid bridge configuration");
  for(const value of [config.contextWindowTokens,config.contextFallbackTokens])if(value!==undefined&&(!Number.isInteger(value)||value<1000||value>1000000))throw new Error("Invalid context window ceiling or fallback");
  if(typeof config.dataDir!=="string"||!config.dataDir.trim())throw new Error("Invalid data directory");
  config.dataDir=resolve(dataDir??config.dataDir);
  for(const name of ["userDataDirs","sharedDataDirs","extensionPaths","vscodePaths"])if(config.auth[name]!==undefined&&(!Array.isArray(config.auth[name])||config.auth[name].some((v:any)=>typeof v!=="string"||!v.trim())))throw new Error(`auth.${name} must be a list of paths`);
  for(const name of ["githubHost","account"])if(config.auth[name]!==undefined&&(typeof config.auth[name]!=="string"||!config.auth[name].trim()))throw new Error(`Invalid auth.${name}`);
  return config;
}
export function saveConfig(file:string,config:Config){mkdirSync(dirname(file),{recursive:true,mode:0o700});const temp=`${file}.${randomUUID()}.tmp`;
  try{writeFileSync(temp,JSON.stringify(config,null,2)+"\n",{mode:0o600,flag:"wx"});renameSync(temp,file);}finally{if(existsSync(temp))unlinkSync(temp);}}
