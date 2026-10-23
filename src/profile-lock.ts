import {mkdirSync,openSync,closeSync,writeFileSync,readFileSync,unlinkSync} from "node:fs";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
export async function withProfileLock<T>(directory:string,action:()=>Promise<T>,timeout=30000):Promise<T>{
  mkdirSync(directory,{recursive:true,mode:0o700});const file=join(directory,".credential-init.lock"),token=randomUUID(),deadline=Date.now()+timeout;
  for(;;){
    try{const fd=openSync(file,"wx",0o600);try{writeFileSync(fd,JSON.stringify({pid:process.pid,token}));}finally{closeSync(fd);}break;}
    catch(error){if((error as any).code!=="EEXIST")throw error;
      try{const original=readFileSync(file,"utf8"),owner=JSON.parse(original);if(Number.isInteger(owner.pid)&&owner.pid>0){let dead=false;try{process.kill(owner.pid,0);}catch(e){dead=(e as any).code==="ESRCH";}if(dead&&readFileSync(file,"utf8")===original){unlinkSync(file);continue;}}}catch{}
      if(Date.now()>=deadline)throw new Error("Bridge profile is busy initializing credentials; retry after the other process finishes");
      await new Promise(r=>setTimeout(r,25));
    }
  }
  try{return await action();}finally{try{if(JSON.parse(readFileSync(file,"utf8")).token===token)unlinkSync(file);}catch{}}
}
