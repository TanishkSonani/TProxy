#!/usr/bin/env bun
import { existsSync,mkdirSync,writeFileSync,readFileSync,unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join,resolve } from "node:path";
import { loadConfig,saveConfig } from "./config";
import { MetricsStore } from "./dashboard/store";
import { secretStore } from "./auth/secure-store";
import { TokenManager } from "./auth/token-manager";
import { DeviceFlow } from "./auth/device-flow";
import { startProxy } from "./proxy/server";
import { claudeEnvironment,prepareClaudeOnboarding } from "./client/claude-launch";
import { generateEnvScript } from "./client/env-script";
import {notices} from "./notices";
import {checkManagedRouting,readManagedSettings,readExtraSettings} from "./client/managed-settings";
import {withProfileLock} from "./profile-lock";

const args=process.argv.slice(2),command=args.shift()??"start";
if(["--help","help","-h"].includes(command)){
  console.log("GHCP Bridge\nUsage: ghcp-bridge start|stop|status|auth|env|claude|dashboard|licenses\nOptions: --port N --config FILE --data-dir DIR --quiet\nClaude: --claude-config-dir DIR -- [Claude Code arguments]\nDashboard: ghcp-bridge dashboard prints a private access link\nUse ghcp-bridge claude for first-run setup and local routing.");process.exit(0);
}
if(command==="--version"){console.log("ghcp-bridge 0.1.0-preview");process.exit(0);}
if(command==="licenses"){console.log(notices);process.exit(0);}
let configPath:string|undefined,dataDir:string|undefined,port:number|undefined,quiet=false,claudeConfig:string|undefined;
const childArgs:string[]=[];
try {
for(let i=0;i<args.length;i++){
  if(args[i]==="--"){childArgs.push(...args.slice(i+1));break;}
  if(["--config","--data-dir","--port","--claude-config-dir"].includes(args[i])&&(!args[i+1]||args[i+1].startsWith("--")))throw new Error(`Missing value after ${args[i]}`);
  if(args[i]==="--config")configPath=args[++i];else if(args[i]==="--data-dir")dataDir=args[++i];else if(args[i]==="--port")port=Number(args[++i]);
  else if(args[i]==="--quiet")quiet=true;else if(args[i]==="--claude-config-dir")claudeConfig=resolve(args[++i]);else childArgs.push(args[i]);
}
  if(command!=="claude"&&childArgs.length)throw new Error(`Unknown option: ${childArgs[0]}`);
  if(port!==undefined&&(!Number.isInteger(port)||port<1||port>65535))throw new Error("Port must be between 1 and 65535");
  if(!["start","stop","status","auth","env","claude","dashboard"].includes(command))throw new Error("Usage: ghcp-bridge start|stop|status|auth|env|claude|dashboard [--port N] [--config FILE] [--data-dir DIR]");
  const config=loadConfig(configPath,dataDir);if(port!==undefined)config.port=port;
  const runtimeFile=join(config.dataDir,"runtime.json");let activePort=config.port;
  if(command!=="start"&&port===undefined&&existsSync(runtimeFile)){try{const runtime=JSON.parse(readFileSync(runtimeFile,"utf8"));process.kill(runtime.pid,0);if(Number.isInteger(runtime.port)&&runtime.port>=1&&runtime.port<=65535)activePort=runtime.port;}catch{}}
  const keyStore=secretStore(join(config.dataDir,"local-api-key"));const key=await withProfileLock(config.dataDir,async()=>{let value=await keyStore.read();if(!value){value=randomBytes(32).toString("hex");await keyStore.write(value);}return value;});
  const connection={port:activePort,key,model:config.models.default,smallModel:config.models.haiku,sonnetModel:config.models.sonnet,opusModel:config.models.opus,contextWindowTokens:config.contextWindowTokens};
  const url=`http://127.0.0.1:${activePort}`;
  const localRequest=(path:string,method="GET",body?:unknown)=>fetch(url+path,{method,headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(path==="/api/context"?30000:3000)});
  const applyContext=(value:any)=>{if(!Number.isInteger(value.tokens))throw new Error("Bridge did not return a context window");connection.contextWindowTokens=Math.min(config.contextWindowTokens??Infinity,value.tokens);if(value.source==="fallback")console.error("Copilot omitted context metadata for a configured model; using the configured fallback for that model.");};
  if(command==="dashboard"){
    const response=await localRequest("/api/dashboard-link");if(!response.ok)throw new Error(`Dashboard access failed (${response.status})`);console.log((await response.json() as any).url);
  } else if(command==="status"||command==="stop"){
    const response=await localRequest(command==="status"?"/api/status":"/api/stop",command==="status"?"GET":"POST");
    if(!response.ok)throw new Error(`Bridge control request failed (${response.status})`);console.log(JSON.stringify(await response.json(),null,2));
  } else if(command==="env") {
    const response=await localRequest("/api/context","POST",{});if(!response.ok)throw new Error(`Context discovery failed (${response.status})`);applyContext(await response.json());
    const env=claudeEnvironment(connection,{});env.ANTHROPIC_API_KEY=undefined;env.CLAUDE_CODE_OAUTH_TOKEN=undefined;
    console.log(generateEnvScript(env,process.platform==="win32"?"powershell":"bash"));
  } else {
    const auth=new TokenManager(secretStore(config.dataDir),config.auth);
    if(command==="auth") {
      try{await auth.initialize();console.log(JSON.stringify(auth.status,null,2));}
      catch(error){if(!(error instanceof Error)||!error.message.startsWith("AUTH_REQUIRED"))throw error;
        const flow=new DeviceFlow(config.auth.githubHost);const code=await flow.start();console.log(`Open ${code.verification_uri} and enter ${code.user_code}`);
        await auth.useCredential(await flow.poll(code));console.log(JSON.stringify(auth.status,null,2));}
      finally{auth.stop();}
    } else {
      let proxy:Awaited<ReturnType<typeof startProxy>>|undefined;
      const boot=async()=>{
        const metrics=new MetricsStore(join(config.dataDir,"metrics.sqlite"));metrics.prune(config.retentionDays);
        const unsubscribe=auth.onRefresh(event=>metrics.refresh(event));
        const timer=setInterval(()=>metrics.prune(config.retentionDays),6*60*60*1000);timer.unref();
        let closed=false;const cleanup=()=>{if(closed)return;closed=true;clearInterval(timer);unsubscribe();metrics.close();try{if(JSON.parse(readFileSync(runtimeFile,"utf8")).pid===process.pid)unlinkSync(runtimeFile);}catch{}};
        try{try{await auth.initialize();}catch(error){if(!(error instanceof Error)||!error.message.startsWith("AUTH_REQUIRED"))throw error;}
          const running=await startProxy(auth,{...config,key},{metrics,saveSettings:settings=>{Object.assign(config,settings);saveConfig(configPath??join(config.dataDir,"config.json"),config);},onStop:()=>{cleanup();process.exit(0);}});
          writeFileSync(runtimeFile,JSON.stringify({pid:process.pid,port:config.port}),{mode:0o600});
          const stop=running.stop.bind(running);running.stop=()=>{stop();cleanup();};return running;
        }catch(error){cleanup();auth.stop();throw error;}
      };
      if(command==="claude") {
        try {const response=await localRequest("/api/status");if(!response.ok)throw new Error("Bridge running with another credential/profile");}
        catch(error){if(error instanceof Error&&error.message.startsWith("Bridge running"))throw error;proxy=await boot();}
      } else {proxy=await boot();}
      if(command==="start"){
        console.log(`GHCP Bridge listening on ${url}; auth=${auth.status.source}; account=${auth.status.login??"unknown"}`);
        if(!quiet)console.log(`Dashboard: ${proxy!.dashboardURL}\nLaunch with: ghcp-bridge claude\nCopy shell settings with: ghcp-bridge env`);
        process.on("SIGINT",()=>{proxy?.stop();process.exit(0);});process.on("SIGTERM",()=>{proxy?.stop();process.exit(0);});
      } else {
        try {
        const ready=await localRequest("/api/status"),status=ready.ok?await ready.json() as any:null;if(!status?.auth?.source){proxy?.stop();throw new Error(`Connect GitHub at ${url} before launching Claude Code`);}
        const modelFlag=childArgs.findIndex(a=>a==="--model"||a==="-m"),requestedModel=modelFlag>=0?childArgs[modelFlag+1]:childArgs.find(a=>a.startsWith("--model="))?.slice(8);
        const contextResponse=await localRequest("/api/context","POST",requestedModel?{model:requestedModel}:{});
        if(!contextResponse.ok){proxy?.stop();throw new Error(`Copilot context discovery failed (${contextResponse.status})`);}applyContext(await contextResponse.json());
        const binary=Bun.which("claude");if(!binary)throw new Error("Claude Code is not installed or not on PATH");
        const configDir=claudeConfig??process.env.CLAUDE_CONFIG_DIR;const onboarding=configDir?join(configDir,".claude.json"):join(homedir(),".claude.json");
        const env=claudeEnvironment(connection);checkManagedRouting([...await readManagedSettings(),...readExtraSettings(childArgs)],claudeEnvironment(connection,{}));prepareClaudeOnboarding(onboarding);if(configDir)env.CLAUDE_CONFIG_DIR=configDir;
        const routing=claudeEnvironment(connection,{});for(const name of ["ANTHROPIC_API_KEY","CLAUDE_CODE_OAUTH_TOKEN","CLAUDE_CODE_USE_BEDROCK","CLAUDE_CODE_USE_VERTEX","CLAUDE_CODE_USE_FOUNDRY","CLAUDE_CODE_USE_ANTHROPIC_AWS"])routing[name]="";
        mkdirSync(config.dataDir,{recursive:true,mode:0o700});const routingFile=join(config.dataDir,"claude-routing.json");writeFileSync(routingFile,JSON.stringify({env:routing}),{mode:0o600});
        const child=Bun.spawn([binary,"--settings",routingFile,...childArgs],{env,stdin:"inherit",stdout:"inherit",stderr:"inherit",windowsHide:false});
        process.exitCode=await child.exited;
        } finally {proxy?.stop();auth.stop();}
      }
    }
  }
}catch(error){console.error(error instanceof Error?error.message:"Bridge failed");process.exitCode=1;}
