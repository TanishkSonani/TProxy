import {test,expect,afterEach} from "bun:test";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {join,resolve,sep} from "node:path";
import {tmpdir} from "node:os";
import {Database} from "bun:sqlite";
import {migrateLegacyData} from "../src/migrate";
const temporary:string[]=[];
afterEach(()=>{for(const dir of temporary.splice(0)){if(!resolve(dir).startsWith(resolve(tmpdir())+sep))throw new Error("Unsafe cleanup path");rmSync(dir,{recursive:true,force:true});}});
function fixture(){const root=mkdtempSync(join(tmpdir(),"tproxy-migration-"));temporary.push(root);const source=join(root,"legacy"),target=join(root,"TProxy");mkdirSync(source);const values=new Map<string,string>();const stores=(path:string)=>({kind:"memory",read:async()=>values.get(path)??null,write:async(value:string)=>{values.set(path,value);}});return {source,target,values,stores};}
test("TProxy migration preserves WAL history and both protected records without changing the legacy profile",async()=>{
  const f=fixture(),db=new Database(join(f.source,"metrics.sqlite"));db.exec("PRAGMA journal_mode=WAL; CREATE TABLE example(value TEXT); INSERT INTO example VALUES('history intact');");
  f.values.set(f.source,"protected-auth-fixture");f.values.set(join(f.source,"local-api-key"),"same-key");writeFileSync(join(f.source,"config.json"),JSON.stringify({port:4141,dataDir:f.source}));
  try{const result=await migrateLegacyData(f.target,f.source,f.stores);expect(result.migrated).toBe(true);expect(f.values.get(f.target)).toBe("protected-auth-fixture");expect(f.values.get(join(f.target,"local-api-key"))).toBe("same-key");
    const copied=new Database(join(f.target,"metrics.sqlite"),{readonly:true});try{expect((copied.query("SELECT value FROM example").get() as any).value).toBe("history intact");}finally{copied.close();}
    expect(JSON.parse(readFileSync(join(f.target,"config.json"),"utf8")).dataDir).toBe(resolve(f.target));expect(JSON.parse(readFileSync(join(f.source,"config.json"),"utf8")).dataDir).toBe(f.source);
    await expect(migrateLegacyData(f.target,f.source,f.stores)).rejects.toThrow("will not overwrite");
  }finally{db.close();}
});
test("migration refuses a running legacy server and overlapping paths",async()=>{
  const f=fixture();writeFileSync(join(f.source,"runtime.json"),JSON.stringify({pid:process.pid,port:4141}));
  await expect(migrateLegacyData(f.target,f.source,f.stores)).rejects.toThrow("Stop the legacy server");
  await expect(migrateLegacyData(join(f.source,"nested"),f.source,f.stores)).rejects.toThrow("separate");
});
