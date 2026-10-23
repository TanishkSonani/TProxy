import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root=fileURLToPath(new URL(".",import.meta.url));
export default defineConfig({root,build:{outDir:resolve(root,"../dist/dashboard"),emptyOutDir:true},server:{host:"127.0.0.1"}});
