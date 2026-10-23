import { existsSync,readFileSync,mkdirSync,writeFileSync } from "node:fs";
import { join,resolve,dirname } from "node:path";
import { homedir } from "node:os";
import type { AuthOptions } from "./auth/providers";
export type Config = {port:number;dataDir:string;models:Record<string,string>;retentionDays:number;requireApiKey:boolean;auth:AuthOptions};
export function loadConfig(path?:string,dataDir?:string):Config {
  const root=resolve(dataDir??process.env.GHCP_BRIDGE_DATA_DIR??join(process.env.LOCALAPPDATA??join(homedir(),".local/share"),"ghcp-bridge"));
  const file=path??join(root,"config.json");const input=existsSync(file)?JSON.parse(readFileSync(file,"utf8").replace(/^\uFEFF/,"")):{};
  const config={port:4141,dataDir:root,retentionDays:90,requireApiKey:true,auth:{},...input,models:{default:"copilot-auto",sonnet:"copilot-auto",opus:"copilot-auto",haiku:"copilot-auto",...input.models}};
  if(!Number.isInteger(config.port)||config.port<1||config.port>65535||!Number.isInteger(config.retentionDays)||config.retentionDays<1)throw new Error("Invalid bridge configuration");
  config.dataDir=resolve(config.dataDir);return config;
}
export function saveConfig(file:string,config:Config){mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(config,null,2)+"\n",{mode:0o600});}
