import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { RequestRecord } from "../proxy/server";
const safeEnums=new Set(["user","assistant","system","developer","text","image","tool_use","tool_result","thinking","enabled","disabled","adaptive"]);
const protocolKeys=new Set(["model","messages","system","tools","tool_choice","metadata","content","role","type","text","name","id","tool_use_id","input","input_schema","thinking","signature","source","media_type","data","is_error","max_tokens","stream","temperature","top_p","stop_sequences","budget_tokens","output_config","format","schema","cache_control"]);
const opaqueKeys=new Set(["input","input_schema","schema","metadata"]);
export function redactStructure(value:any,key="",depth=0):any {
  if(depth>16)return "[redacted: depth limit]";
  if(opaqueKeys.has(key))return "[redacted: structured content]";
  if(Array.isArray(value))return value.slice(0,100).map(v=>redactStructure(v,"",depth+1));
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).slice(0,100).map(([k,v],i)=>[protocolKeys.has(k)?k:`[redacted key ${i}]`,redactStructure(v,k,depth+1)]));
  if(typeof value==="string")return ["type","role"].includes(key)&&safeEnums.has(value)?value:`[redacted: ${value.length} chars]`;
  if(typeof value==="number"&&!["max_tokens","budget_tokens","temperature","top_p"].includes(key))return "[redacted: number]";
  return value;
}
export class MetricsStore {
  readonly driver="bun:sqlite";readonly db:Database;
  constructor(readonly file:string){if(file!==":memory:")mkdirSync(dirname(file),{recursive:true,mode:0o700});this.db=new Database(file,{create:true});
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,at INTEGER NOT NULL,model TEXT NOT NULL,status INTEGER NOT NULL,latency REAL NOT NULL,input INTEGER NOT NULL,output INTEGER NOT NULL,tools INTEGER NOT NULL,session TEXT NOT NULL,body TEXT,cache_read INTEGER NOT NULL DEFAULT 0,cache_write INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS requests_at ON requests(at);CREATE INDEX IF NOT EXISTS requests_session ON requests(session);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,at INTEGER NOT NULL,type TEXT NOT NULL,ok INTEGER NOT NULL);PRAGMA user_version=1;`);
  }
  add(row:RequestRecord){const body=row.body===undefined?null:JSON.stringify(redactStructure(row.body)).slice(0,32768);
    this.db.query("INSERT OR IGNORE INTO requests(id,at,model,status,latency,input,output,tools,session,body,cache_read,cache_write) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(row.id,row.at,row.model,row.status,row.latency,row.input,row.output,row.tools,row.session,body,row.cacheRead??0,row.cacheWrite??0);
  }
  refresh(event:{at:number;ok:boolean}){this.db.query("INSERT INTO events(at,type,ok) VALUES(?,'token-refresh',?)").run(event.at,event.ok?1:0);}
  prune(days:number,now=Date.now()){if(!Number.isInteger(days)||days<1)throw new Error("Invalid retention");const boundary=now-days*86400000;
    this.db.transaction(()=>{this.db.query("DELETE FROM requests WHERE at<?").run(boundary);this.db.query("DELETE FROM events WHERE at<?").run(boundary);})();}
  recent(limit=100,offset=0){return this.db.query("SELECT * FROM requests ORDER BY at DESC LIMIT ? OFFSET ?").all(Math.max(1,Math.min(200,limit)),Math.max(0,offset));}
  events(){return this.db.query("SELECT * FROM events ORDER BY at DESC LIMIT 50").all();}
  summary(days=90,now=Date.now()){
    const since=now-Math.max(1,Math.min(3660,days))*86400000;
    const totals:any=this.db.query(`SELECT COUNT(*) requests,COALESCE(SUM(input),0) input,COALESCE(SUM(output),0) output,
      COALESCE(SUM(cache_read),0) cacheRead,COALESCE(SUM(cache_write),0) cacheWrite,COALESCE(SUM(tools),0) tools,
      COALESCE(SUM(status>=400),0) errors,COALESCE(SUM(tools>0),0) toolRequests,
      COUNT(DISTINCT strftime('%Y-%m-%dT%H',at/1000,'unixepoch','localtime')) activeHours FROM requests WHERE at>=?`).get(since);
    const models=this.db.query("SELECT model,COUNT(*) requests,SUM(input) input,SUM(output) output,SUM(status>=400) errors FROM requests WHERE at>=? GROUP BY model ORDER BY requests DESC").all(since);
    const daily=this.db.query("SELECT date(at/1000,'unixepoch','localtime') day,COUNT(*) requests,SUM(input) input,SUM(output) output FROM requests WHERE at>=? GROUP BY day ORDER BY day").all(since);
    const latencies=this.db.query("SELECT latency FROM requests WHERE at>=? ORDER BY latency").all(since) as {latency:number}[];
    const percentile=(p:number)=>latencies.length?latencies[Math.max(0,Math.ceil(latencies.length*p)-1)].latency:null;
    const sessions=this.db.query("SELECT COUNT(*) count,AVG(n) averageRequests,AVG(duration) averageDurationMs FROM (SELECT COUNT(*) n,MAX(at)-MIN(at) duration FROM requests WHERE at>=? AND session<>'' GROUP BY session)").get(since);
    return {totals:{...totals,errorRate:totals.requests?totals.errors/totals.requests:0,toolRatio:totals.requests?totals.toolRequests/totals.requests:0,p50:percentile(.5),p95:percentile(.95)},models,daily,sessions,days,driver:this.driver};
  }
  close(){this.db.close();}
}
