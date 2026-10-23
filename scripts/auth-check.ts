import { resolve } from "node:path";
import { secretStore } from "../src/auth/secure-store";
import { TokenManager } from "../src/auth/token-manager";
const manager=new TokenManager(secretStore(resolve("evidence/private/auth-runtime")));
try {await manager.initialize();const models=await manager.models();console.log(JSON.stringify({...manager.status,advertisedModels:models.data?.length},null,2));}
catch(error){console.error(error instanceof Error?error.message:"Authentication failed");process.exitCode=1;}
finally{manager.stop();}
