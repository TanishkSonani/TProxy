import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type DiscoveryOptions = {
  paths?: string[];
  vscodePaths?: string[];
  home?: string;
  env?: Record<string, string | undefined>;
  launchers?: string[];
  defaults?: boolean;
};
export type Installation = { path: string; version: string; main: string; sources: string[] };

// Inspect only known layout boundaries and immediate children, never an entire drive.
// Identity comes from package.json, so renamed/UUID extension directories work too.
export function discoverCopilot(options: DiscoveryOptions = {}): Installation[] {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const found = new Map<string, Installation>();
  const inspect = (path: string, source: string) => {
    try {
      const pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
      if (String(pkg.publisher).toLowerCase() !== "github" || pkg.name !== "copilot-chat") return;
      const canonical = realpathSync(path);
      const previous = found.get(canonical);
      if (previous) { if (!previous.sources.includes(source)) previous.sources.push(source); return; }
      found.set(canonical, { path: canonical, version: String(pkg.version ?? "unknown"),
        main: typeof pkg.main === "string" ? pkg.main : "./dist/extension", sources: [source] });
    } catch { /* Missing, inaccessible or malformed candidates are not installations. */ }
  };
  const directory = (path: string, source: string) => {
    inspect(path, source);
    try {
      for (const child of readdirSync(path, { withFileTypes: true })) {
        if (child.isDirectory() || child.isSymbolicLink()) inspect(join(path, child.name), source);
      }
    } catch { /* Discovery continues across inaccessible locations. */ }
  };
  const layout = (root: string, source: string) => {
    directory(root, source);
    for (const suffix of ["extensions", "data/extensions", "resources/app/extensions",
      "Contents/Resources/app/extensions", ".vscode/extensions", "app/extensions"]) {
      directory(join(root, suffix), source);
    }
  };
  const installation = (input: string, source: string) => {
    let root = resolve(input);
    try { root = realpathSync(root); if (statSync(root).isFile()) root = dirname(root); } catch { return; }
    layout(root, source);
    // CLI launchers live in bin, including macOS's app/Contents/Resources/app/bin.
    if (root.endsWith("/bin") || root.endsWith("\\bin")) layout(dirname(root), source);
    try {
      for (const child of readdirSync(root, { withFileTypes: true })) {
        if (child.isDirectory() && /^[a-f0-9]{8,40}$/i.test(child.name)) layout(join(root, child.name), source);
      }
    } catch { /* Optional installation. */ }
  };
  for (const path of [...(options.paths ?? []), env.GHCP_COPILOT_PATH, env.VSCODE_EXTENSIONS].filter(Boolean) as string[])
    directory(resolve(path), "explicit extension path");
  for (const path of [...(options.vscodePaths ?? []), env.GHCP_VSCODE_PATH, env.VSCODE_PORTABLE].filter(Boolean) as string[])
    installation(path, "explicit VS Code/portable path");
  for (const path of options.launchers ?? []) installation(path, "PATH launcher");
  if (options.defaults !== false) {
    for (const name of [".vscode", ".vscode-insiders", ".vscode-server", ".vscode-server-insiders", ".vscode-oss"])
      directory(join(home, name, "extensions"), "standard extension directory");
    const locations = [
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs/Microsoft VS Code"),
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs/Microsoft VS Code Insiders"),
      ...[env.ProgramFiles, env["ProgramFiles(x86)"]].filter(Boolean).flatMap(base =>
        [join(base!, "Microsoft VS Code"), join(base!, "Microsoft VS Code Insiders")]),
      "/Applications/Visual Studio Code.app", "/Applications/Visual Studio Code - Insiders.app",
      join(home, "Applications/Visual Studio Code.app"),
      "/usr/share/code", "/usr/share/code-insiders", "/usr/lib/code", "/opt/visual-studio-code",
      "/snap/code/current/usr/share/code",
    ].filter(Boolean) as string[];
    for (const path of locations) installation(path, "standard application directory");
  }
  return [...found.values()];
}

export function discoveryArgs(args: string[]) {
  const paths: string[] = [], vscodePaths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (!["--extension-path", "--vscode-path"].includes(args[i])) throw new Error(`Unknown option: ${args[i]}`);
    const flag = args[i], value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing path after ${flag}`);
    (flag === "--extension-path" ? paths : vscodePaths).push(value);
  }
  return { paths, vscodePaths };
}

if (import.meta.main) {
  const launchers = ["code", "code-insiders", "code-oss"].map(name => Bun.which(name)).filter(Boolean) as string[];
  console.log(JSON.stringify(discoverCopilot({ ...discoveryArgs(process.argv.slice(2)), launchers }), null, 2));
}
