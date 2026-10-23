import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

export interface SecretStore { read(): Promise<string | null>; write(value: string): Promise<void>; kind: string }

// Secrets travel over stdin/stdout pipes, never arguments or diagnostic output.
export async function powershell(script: string, input = ""): Promise<string> {
  const encoded = Buffer.from("$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::InputEncoding=[Text.Encoding]::UTF8; [Console]::OutputEncoding=New-Object Text.UTF8Encoding($false);\n"+script,"utf16le").toString("base64");
  const child = Bun.spawn(["powershell.exe","-NoProfile","-NonInteractive","-EncodedCommand",encoded],
    {stdin:"pipe",stdout:"pipe",stderr:"pipe",windowsHide:true});
  child.stdin.write(input); child.stdin.end();
  const [out,,code] = await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
  if (code !== 0) throw new Error(`Windows protected credential operation failed (${code})`);
  return out.trim();
}

const credentialApi = `
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Runtime.InteropServices.ComTypes;
public static class BridgeCredentials {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct Credential {
  public uint Flags, Type; public string TargetName, Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
  public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist, AttributeCount;
  public IntPtr Attributes; public string TargetAlias, UserName;
 }
 [DllImport("advapi32.dll",EntryPoint="CredReadW",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool Read(string target,uint type,uint flags,out IntPtr pointer);
 [DllImport("advapi32.dll",EntryPoint="CredWriteW",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool Write(ref Credential credential,uint flags);
 [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr pointer);
}
'@
$request=([Console]::In.ReadToEnd() | ConvertFrom-Json)
`;

export class WindowsCredentialStore implements SecretStore {
  kind = "windows-credential-manager";
  constructor(readonly target: string) {}
  async read() {
    const result = await powershell(credentialApi + `
$p=[IntPtr]::Zero
if(-not [BridgeCredentials]::Read($request.target,1,0,[ref]$p)) {
 if([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 1168){exit 0}; exit 1
}
try {
 $c=[Runtime.InteropServices.Marshal]::PtrToStructure($p,[type][BridgeCredentials+Credential])
 $bytes=New-Object byte[] $c.CredentialBlobSize
 [Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob,$bytes,0,$bytes.Length)
 [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))
} finally {[BridgeCredentials]::CredFree($p)}
`,JSON.stringify({target:this.target}));
    return result || null;
  }
  async write(value: string) {
    if (Buffer.byteLength(value)>5120) throw new Error("Credential record exceeds Windows vault capacity");
    await powershell(credentialApi + `
$bytes=[Text.Encoding]::UTF8.GetBytes($request.value)
$p=[Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
try {
 [Runtime.InteropServices.Marshal]::Copy($bytes,0,$p,$bytes.Length)
 $c=New-Object BridgeCredentials+Credential
 $c.Type=1; $c.TargetName=$request.target; $c.CredentialBlob=$p; $c.CredentialBlobSize=$bytes.Length
 $c.Persist=2; $c.UserName='ghcp-bridge'
 if(-not [BridgeCredentials]::Write([ref]$c,0)){exit 1}
} finally {[Runtime.InteropServices.Marshal]::FreeHGlobal($p)}
`,JSON.stringify({target:this.target,value}));
  }
}

export class FileSecretStore implements SecretStore {
  kind = "restricted-file";
  constructor(readonly directory: string) {}
  async read() { const file=join(this.directory,"credentials.json");return existsSync(file)?readFileSync(file,"utf8"):null; }
  async write(value: string) {
    mkdirSync(this.directory,{recursive:true,mode:0o700});chmodSync(this.directory,0o700);
    const file=join(this.directory,"credentials.json"), temp=`${file}.${randomUUID()}.tmp`;
    try {writeFileSync(temp,value,{mode:0o600,flag:"wx"});renameSync(temp,file);chmodSync(file,0o600);}
    finally {if(existsSync(temp))unlinkSync(temp);}
  }
}

export function secretStore(directory: string): SecretStore {
  const profile=createHash("sha256").update(directory).digest("hex").slice(0,24);
  if(process.platform==="win32") return new WindowsCredentialStore(`ghcp-bridge:${profile}`);
  // Protected file is the explicitly supported fallback when an OS vault adapter is unavailable.
  return new FileSecretStore(directory);
}

export async function windowsUnprotect(data: Uint8Array): Promise<Buffer> {
  const result=await powershell(`Add-Type -AssemblyName System.Security
$value=[Convert]::FromBase64String([Console]::In.ReadToEnd())
$plain=[Security.Cryptography.ProtectedData]::Unprotect($value,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($plain))`,Buffer.from(data).toString("base64"));
  return Buffer.from(result,"base64");
}
