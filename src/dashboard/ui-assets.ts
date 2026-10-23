// Source loader; the binary build replaces this module with embedded Vite assets.
import { resolve } from "node:path";
const root=resolve(import.meta.dir,"../../dist/dashboard");
export async function asset(path:string):Promise<Response|undefined>{
  if(path!=="/"&&!/^\/assets\/[A-Za-z0-9_.-]+$/.test(path))return;
  const file=Bun.file(root+(path==="/"?"/index.html":path));if(await file.exists())return new Response(file,{headers:{"cache-control":path==="/"?"no-store":"public, max-age=31536000, immutable"}});
  if(path==="/")return new Response("Dashboard assets are not built. Run bun run build:ui.",{headers:{"content-type":"text/plain"}});
}
