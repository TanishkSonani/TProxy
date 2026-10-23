import {expect,test} from "bun:test";
import {rootCertificates,getCACertificates} from "node:tls";
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createOutboundFetch} from "../src/auth/https";

test("optional PEM CA roots are validated and passed through without changing other fetch options",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"tproxy-ca-")),file=join(dir,"root.pem"),root=rootCertificates[0],calls:any[]=[];
  const transport=Object.assign(async(_input:any,init:any)=>{calls.push(init);return new Response("ok");},{preconnect(){}}) as typeof fetch;
  try{
    writeFileSync(file,root);
    const outbound=createOutboundFetch(file,transport);
    const response=await outbound("https://example.com",{redirect:"manual",headers:{Accept:"application/json"}});
    expect(await response.text()).toBe("ok");expect(calls[0].redirect).toBe("manual");expect(calls[0].headers.Accept).toBe("application/json");expect(calls[0].tls.ca).toContain(root);for(const cert of getCACertificates("default"))expect(calls[0].tls.ca).toContain(cert);
    const direct=createOutboundFetch(undefined,transport);await direct("https://example.com");expect(calls[1]).toBeUndefined();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("invalid CA files fail closed before an outbound request",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"tproxy-ca-")),file=join(dir,"invalid.pem"),transport=Object.assign(async()=>new Response("unexpected"),{preconnect(){}}) as typeof fetch;
  try{
    writeFileSync(file,"not a PEM certificate");
    await expect(createOutboundFetch(file,transport)("https://example.com")).rejects.toThrow("PEM CA certificates");
  }finally{rmSync(dir,{recursive:true,force:true});}
});

const openssl=Bun.which("openssl");
test.skipIf(!openssl)("real TLS accepts a configured CA but rejects an unknown CA, leaf trust and hostname mismatch",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"tproxy-tls-"));let valid:ReturnType<typeof Bun.serve>|undefined,wrong:ReturnType<typeof Bun.serve>|undefined;
  const run=(args:string[])=>{const result=Bun.spawnSync([openssl!,...args],{cwd:dir,env:{...process.env,OPENSSL_CONF:join(dir,"openssl.cnf")},stdout:"pipe",stderr:"pipe",windowsHide:true});if(result.exitCode!==0)throw new Error("Synthetic TLS fixture generation failed: "+result.stderr.toString().slice(-1000));};
  try{
    writeFileSync(join(dir,"openssl.cnf"),"[req]\ndistinguished_name=dn\n[dn]\n");
    run(["req","-x509","-newkey","rsa:2048","-nodes","-keyout","ca-key.pem","-out","ca.pem","-days","1","-subj","/CN=TProxy Synthetic Test CA","-addext","basicConstraints=critical,CA:TRUE","-addext","keyUsage=critical,keyCertSign,cRLSign"]);
    run(["req","-new","-newkey","rsa:2048","-nodes","-keyout","server-key.pem","-out","server.csr","-subj","/CN=TProxy Synthetic Test Server"]);
    for(const [name,san]of [["valid","IP:127.0.0.1"],["wrong","DNS:wrong.invalid"]]){
      writeFileSync(join(dir,name+".ext"),"basicConstraints=critical,CA:FALSE\nsubjectAltName="+san+"\nextendedKeyUsage=serverAuth\n");
      run(["x509","-req","-in","server.csr","-CA","ca.pem","-CAkey","ca-key.pem","-CAcreateserial","-days","1","-out",name+".pem","-extfile",name+".ext"]);
    }
    const serve=(name:string)=>Bun.serve({hostname:"127.0.0.1",port:0,tls:{key:readFileSync(join(dir,"server-key.pem")),cert:readFileSync(join(dir,name+".pem"))},fetch:()=>new Response("trusted fixture")});
    valid=serve("valid");wrong=serve("wrong");
    const url="https://127.0.0.1:"+valid.port,wrongURL="https://127.0.0.1:"+wrong.port;
    await expect(fetch(url,{signal:AbortSignal.timeout(5000)})).rejects.toThrow();
    const outbound=createOutboundFetch(join(dir,"ca.pem"));
    expect(await(await outbound(url,{signal:AbortSignal.timeout(5000)})).text()).toBe("trusted fixture");
    await expect(outbound(wrongURL,{signal:AbortSignal.timeout(5000)})).rejects.toThrow();
    await expect(createOutboundFetch(join(dir,"valid.pem"))(url)).rejects.toThrow("non-CA");
  }finally{valid?.stop(true);wrong?.stop(true);rmSync(dir,{recursive:true,force:true});}
},15000);
