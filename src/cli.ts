#!/usr/bin/env bun
import { existsSync,mkdirSync,writeFileSync } from "node:fs";
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

const args=process.argv.slice(2),command=args.shift()??"start";
let configPath:string|undefined,dataDir:string|undefined,port:number|undefined,quiet=false,claudeConfig:string|undefined;
const childArgs:string[]=[];
for(let i=0;i<args.length;i++){
  if(args[i]==="--"){childArgs.push(...args.slice(i+1));break;}
  if(args[i]==="--config")configPath=args[++i];else if(args[i]==="--data-dir")dataDir=args[++i];else if(args[i]==="--port")port=Number(args[++i]);
  else if(args[i]==="--quiet")quiet=true;else if(args[i]==="--claude-config-dir")claudeConfig=resolve(args[++i]);else childArgs.push(args[i]);
}
try {
  if(!["start","stop","status","auth","env","claude"].includes(command))throw new Error("Usage: ghcp-bridge start|stop|status|auth|env|claude [--port N] [--config FILE] [--data-dir DIR]");
  const config=loadConfig(configPath,dataDir);if(port!==undefined)config.port=port;
  const keyStore=secretStore(join(config.dataDir,"local-api-key"));let key=await keyStore.read();if(!key){key=randomBytes(32).toString("hex");await keyStore.write(key);}
  const connection={port:config.port,key,model:config.models.default,smallModel:config.models.haiku,sonnetModel:config.models.sonnet,opusModel:config.models.opus};
  const url=`http://127.0.0.1:${config.port}`;
  const localRequest=(path:string,method="GET")=>fetch(url+path,{method,headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(3000)});
  if(command==="status"||command==="stop"){
    const response=await localRequest(command==="status"?"/api/status":"/api/stop",command==="status"?"GET":"POST");
    if(!response.ok)throw new Error(`Bridge control request failed (${response.status})`);console.log(JSON.stringify(await response.json(),null,2));
  } else if(command==="env") {
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
        let closed=false;const cleanup=()=>{if(closed)return;closed=true;clearInterval(timer);unsubscribe();metrics.close();};
        try{try{await auth.initialize();}catch(error){if(!(error instanceof Error)||!error.message.startsWith("AUTH_REQUIRED"))throw error;}
          const running=await startProxy(auth,{...config,key},{metrics,saveSettings:settings=>{Object.assign(config,settings);saveConfig(configPath??join(config.dataDir,"config.json"),config);},onStop:()=>{cleanup();process.exit(0);}});
          const stop=running.stop.bind(running);running.stop=()=>{stop();cleanup();};return running;
        }catch(error){cleanup();auth.stop();throw error;}
      };
      if(command==="claude") {
        try {const response=await localRequest("/api/status");if(!response.ok)throw new Error("Bridge running with another credential/profile");}
        catch(error){if(error instanceof Error&&error.message.startsWith("Bridge running"))throw error;proxy=await boot();}
      } else {proxy=await boot();}
      if(command==="start"){
        console.log(`GHCP Bridge listening on ${url}; auth=${auth.status.source}; account=${auth.status.login??"unknown"}`);
        if(!quiet)console.log("Launch with: ghcp-bridge claude\nCopy shell settings with: ghcp-bridge env");
        process.on("SIGINT",()=>{proxy?.stop();process.exit(0);});process.on("SIGTERM",()=>{proxy?.stop();process.exit(0);});
      } else {
        const binary=Bun.which("claude");if(!binary)throw new Error("Claude Code is not installed or not on PATH");
        const configDir=claudeConfig??process.env.CLAUDE_CONFIG_DIR;const onboarding=configDir?join(configDir,".claude.json"):join(homedir(),".claude.json");
        prepareClaudeOnboarding(onboarding);const env=claudeEnvironment(connection);if(configDir)env.CLAUDE_CONFIG_DIR=configDir;
        const routing=claudeEnvironment(connection,{});for(const name of ["ANTHROPIC_API_KEY","CLAUDE_CODE_OAUTH_TOKEN","CLAUDE_CODE_USE_BEDROCK","CLAUDE_CODE_USE_VERTEX","CLAUDE_CODE_USE_FOUNDRY","CLAUDE_CODE_USE_ANTHROPIC_AWS"])routing[name]="";
        mkdirSync(config.dataDir,{recursive:true,mode:0o700});const routingFile=join(config.dataDir,"claude-routing.json");writeFileSync(routingFile,JSON.stringify({env:routing}),{mode:0o600});
        const child=Bun.spawn([binary,"--settings",routingFile,...childArgs],{env,stdin:"inherit",stdout:"inherit",stderr:"inherit",windowsHide:false});
        try{process.exitCode=await child.exited;}finally{proxy?.stop();auth.stop();}
      }
    }
  }
}catch(error){console.error(error instanceof Error?error.message:"Bridge failed");process.exitCode=1;}
