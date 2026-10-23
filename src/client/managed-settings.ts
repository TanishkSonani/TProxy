import {existsSync,readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";
import {powershell} from "../auth/secure-store";
export type ManagedDocument={source:string;settings:Record<string,any>};
export function readExtraSettings(args:string[]):ManagedDocument[]{
  const documents:ManagedDocument[]=[];
  for(let i=0;i<args.length;i++){
    const value=args[i]==="--settings"?args[++i]:args[i].startsWith("--settings=")?args[i].slice(11):undefined;
    if(value===undefined)continue;
    try{const text=value.trim().startsWith("{")?value:readFileSync(value,"utf8").replace(/^\uFEFF/,"");documents.push({source:`command-line settings ${documents.length+1}`,settings:JSON.parse(text)});}catch{throw new Error("Cannot read or parse a command-line --settings value");}
  }
  return documents;
}
export function checkManagedRouting(documents:ManagedDocument[],routing:Record<string,string|undefined>){
  const expected=new Map(Object.entries(routing).map(([key,value])=>[key.toUpperCase(),value??""]));
  const providerKeys=new Set(["ANTHROPIC_API_KEY","CLAUDE_CODE_OAUTH_TOKEN","CLAUDE_CODE_USE_BEDROCK","CLAUDE_CODE_USE_VERTEX","CLAUDE_CODE_USE_FOUNDRY","CLAUDE_CODE_USE_ANTHROPIC_AWS","ANTHROPIC_CUSTOM_HEADERS","ANTHROPIC_UNIX_SOCKET"]);
  for(const {source,settings} of documents){
    if(!settings||typeof settings!=="object"||Array.isArray(settings))throw new Error(`Cannot verify managed settings object: ${source}`);
    for(const [key,value] of Object.entries(settings.env??{})){
      const name=key.toUpperCase(),want=expected.get(name);
      if((expected.has(name)&&String(value??"")!==want)||(providerKeys.has(name)&&String(value??"")!==""&&String(value)!=="0"))throw new Error(`Managed setting ${key} conflicts with local bridge routing (${source}). The policy was not modified.`);
    }
    if(settings.policyHelper||settings.apiKeyHelper)throw new Error(`Authentication/policy helper requires administrator verification before bridge launch (${source}).`);
  }
}
export async function readManagedSettings():Promise<ManagedDocument[]>{
  const directory=process.platform==="win32"?join(process.env.ProgramFiles??"C:/Program Files","ClaudeCode"):process.platform==="darwin"?"/Library/Application Support/ClaudeCode":"/etc/claude-code";
  const files=[join(directory,"managed-settings.json")],dropins=join(directory,"managed-settings.d");
  if(existsSync(dropins))files.push(...readdirSync(dropins).filter(p=>!p.startsWith(".")&&p.endsWith(".json")).sort().map(p=>join(dropins,p)));
  const documents:ManagedDocument[]=[];
  for(const file of files){if(!existsSync(file))continue;try{const text=readFileSync(file,"utf8").replace(/^\uFEFF/,"");documents.push({source:file,settings:text.trim()?JSON.parse(text):{}});}catch{throw new Error(`Cannot read or parse managed policy: ${file}`);}}
  if(process.platform==="win32"){
    const values=JSON.parse(await powershell(`$items=@(); foreach($hive in @([Microsoft.Win32.Registry]::LocalMachine,[Microsoft.Win32.Registry]::CurrentUser)) {
 $key=$hive.OpenSubKey('SOFTWARE\\Policies\\ClaudeCode'); if($null -ne $key) {try {$value=$key.GetValue('Settings'); if($null -ne $value){$items+=@{source=$key.Name;value=$value}}} finally {$key.Dispose()}}
}; [Console]::Out.Write((ConvertTo-Json -InputObject @($items) -Compress))`));
    for(const item of values){try{documents.push({source:item.source,settings:JSON.parse(item.value)});}catch{throw new Error(`Cannot parse managed registry policy: ${item.source}`);}}
  }
  return documents;
}
