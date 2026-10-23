import { Database } from "bun:sqlite";
import { createDecipheriv } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { discoverCopilot } from "../../scripts/discover-copilot";
import { windowsUnprotect } from "./secure-store";

export type Credential = { token: string; source: string; host: string; login?: string };
export type AuthOptions = { githubHost?: string; userDataDirs?: string[]; sharedDataDirs?: string[];
  extensionPaths?: string[]; vscodePaths?: string[]; account?: string };

export function githubApi(host: string): string {
  if(host==="github.com") return "https://api.github.com";
  if(/^[a-z0-9-]+\.ghe\.com$/i.test(host))return `https://api.${host}`;
  throw new Error("Unverified GitHub host; configure a verified GitHub Cloud or EMU host");
}

async function command(args: string[]) {
  const child=Bun.spawn(args,{stdout:"pipe",stderr:"pipe",windowsHide:true});
  const timer=setTimeout(()=>child.kill(),10000);
  try {const [out,,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);return code===0?out.trim():null;}
  finally{clearTimeout(timer);}
}

export async function vscodeCredential(options: AuthOptions): Promise<Credential | null> {
  if(process.platform!=="win32")return null;
  const appData=process.env.APPDATA??join(homedir(),"AppData/Roaming");
  const users=new Set([...(options.userDataDirs??[]),join(appData,"Code"),join(appData,"Code - Insiders")]);
  const shared=new Set([...(options.sharedDataDirs??[]),join(homedir(),".vscode-shared")]);
  if(process.env.VSCODE_PORTABLE){users.add(join(process.env.VSCODE_PORTABLE,"user-data"));shared.add(join(process.env.VSCODE_PORTABLE,"shared-data"));}
  for(const install of discoverCopilot({paths:options.extensionPaths,vscodePaths:options.vscodePaths})) {
    try {const product=JSON.parse(readFileSync(join(dirname(dirname(install.path)),"product.json"),"utf8"));
      if(product.sharedDataFolderName)shared.add(join(homedir(),product.sharedDataFolderName));
    } catch {}
  }
  const provider=options.githubHost && options.githubHost!=="github.com"?"github-enterprise":"github";
  const labels=[`secret://${JSON.stringify({extensionId:"vscode.github-authentication",key:provider+".auth"})}`];
  for(const userDir of users) {
    const state=join(userDir,"Local State");if(!existsSync(state))continue;
    let key:Buffer;
    try {const encoded=Buffer.from(JSON.parse(readFileSync(state,"utf8")).os_crypt.encrypted_key,"base64");
      if(encoded.subarray(0,5).toString()!=="DPAPI")continue;key=await windowsUnprotect(encoded.subarray(5));
    } catch {continue;}
    for(const database of [...[...shared].map(path=>join(path,"sharedStorage/state.vscdb")),join(userDir,"User/globalStorage/state.vscdb")]) {
      if(!existsSync(database))continue;
      let db:Database|undefined;
      try {
        db=new Database(database,{readonly:true});
        for(const label of labels){
          const row=db.query("SELECT value FROM ItemTable WHERE key=?").get(label) as {value:string}|null;
          if(!row)continue;const bytes=Buffer.from(JSON.parse(row.value).data);
          if(bytes.subarray(0,3).toString()!=="v10")continue;
          const decipher=createDecipheriv("aes-256-gcm",key,bytes.subarray(3,15));decipher.setAuthTag(bytes.subarray(-16));
          const sessions=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(15,-16)),decipher.final()]).toString());
          const matches=sessions.filter((item:any)=>item.accessToken && (!options.account || item.account?.label===options.account));
          if(matches.length>1)throw new Error("Multiple VS Code accounts found; select account in configuration");
          if(matches.length===1)return {token:matches[0].accessToken,source:"vscode",host:options.githubHost??"github.com",login:matches[0].account?.label};
        }
      } catch(error) {if(error instanceof Error && error.message.startsWith("Multiple"))throw error;}
      finally {db?.close();}
    }
  }
  return null;
}

export async function existingCredential(options: AuthOptions = {}): Promise<Credential|null> {
  const host=options.githubHost??process.env.GH_HOST??"github.com";githubApi(host);
  for(const name of ["GH_TOKEN","GITHUB_TOKEN"])if(process.env[name]?.trim())return {token:process.env[name]!.trim(),source:name,host};
  if(Bun.which("gh")) {
    let selected=host;
    if(!options.githubHost && !process.env.GH_HOST) {
      const status=await command(["gh","auth","status","--json","hosts"]);
      try {const hosts=Object.keys(JSON.parse(status??"{}").hosts??{});if(hosts.length>1)throw new Error("Multiple gh hosts; select githubHost");if(hosts.length===1)selected=hosts[0];}
      catch(error){if(error instanceof Error && error.message.startsWith("Multiple"))throw error;}
    }
    githubApi(selected);const token=await command(["gh","auth","token","--hostname",selected]);
    if(token)return {token,source:"gh",host:selected};
  }
  return vscodeCredential({...options,githubHost:host});
}
