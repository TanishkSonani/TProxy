import { X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getCACertificates } from "node:tls";

type BunFetchInit=RequestInit&{tls?:{ca?:string|string[];[key:string]:unknown}};
const certificate=/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

export function createOutboundFetch(caFile?:string,transport:typeof fetch=fetch):typeof fetch {
  if(!caFile)return transport;
  const path=resolve(caFile);let caPromise:Promise<string[]>|undefined;
  const loadCA=()=>caPromise??=(async()=>{
    const contents=await readFile(path,"utf8"),blocks=contents.match(certificate)??[];
    if(!blocks.length||contents.replace(certificate,"").trim())throw new Error("The configured TLS CA file must contain only PEM CA certificates");
    try {
      if(blocks.some(block=>!new X509Certificate(block).ca))throw new Error("The configured TLS CA file contains a non-CA certificate");
    } catch(error) {
      if(error instanceof Error&&error.message.includes("non-CA"))throw error;
      throw new Error("The configured TLS CA file contains an invalid certificate");
    }
    // Per-request CA options must preserve the runtime's bundled, system and
    // environment-configured roots. The compiled CLI enables --use-system-ca.
    return [...new Set([...getCACertificates("default"),...blocks])];
  })();
  const outbound=async(input:RequestInfo|URL,init?:RequestInit)=>{
    const ca=await loadCA(),options=(init??{}) as BunFetchInit;
    return transport(input,{...options,tls:{...options.tls,ca}} as BunFetchInit);
  };
  return Object.assign(outbound,{preconnect:transport.preconnect.bind(transport)}) as typeof fetch;
}
