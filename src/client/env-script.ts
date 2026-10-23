// Adapted from ericc-ch/copilot-api src/lib/shell.ts at 0ea08febdd7e3e055b03dd298bf57e669500b5c1.
// Copyright (c) 2025 Erick Christian Purwanto. MIT; see third_party/licenses/ericc-copilot-api.txt.
// Changes: explicit shell selection, safe quoting, unset support, no WMIC subprocess.
export type ShellName = "bash" | "zsh" | "sh" | "fish" | "powershell" | "cmd";
export function generateEnvScript(envVars: Record<string, string | undefined>, shell: ShellName): string {
  const lines = Object.entries(envVars).map(([key,value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error("Invalid environment variable name");
    if (value?.includes("\0")) throw new Error("Environment values cannot contain NUL");
    switch (shell) {
      case "powershell":
        return value === undefined ? `Remove-Item Env:${key} -ErrorAction SilentlyContinue`
          : `$env:${key} = '${value.replace(/'/g, "''")}'`;
      case "cmd":
        if (value !== undefined && /[\r\n"%!]/.test(value)) throw new Error("Value cannot be exported safely to CMD; select PowerShell");
        return `set "${key}=${value ?? ""}"`;
      case "fish":
        return value === undefined ? `set -e ${key}`
          : `set -gx ${key} '${value.replace(/\\/g,"\\\\").replace(/'/g,"\\'")}'`;
      default:
        return value === undefined ? `unset ${key}` : `export ${key}='${value.replace(/'/g,"'\\''")}'`;
    }
  });
  return [...lines,"claude"].join("\n");
}
