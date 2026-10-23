import { mkdirSync, writeFileSync } from "node:fs";
import { discoverCopilot, discoveryArgs } from "./discover-copilot";

// Credential values are never printed. gh auth status may validate existing logins.
const installations = discoverCopilot({ ...discoveryArgs(process.argv.slice(2)),
  launchers: ["code", "code-insiders", "code-oss"].map(name => Bun.which(name)).filter(Boolean) as string[] });
const extensions = installations.map(item => item.path);
const gh = Bun.which("gh") ? Bun.spawnSync(["gh", "auth", "status"], { stdout: "pipe", stderr: "pipe" }) : null;
const report = {
  recordedAt: new Date().toISOString(),
  runtime: { bun: Bun.version, platform: process.platform, architecture: process.arch },
  extensions,
  installations,
  credentialPresence: {
    GH_TOKEN: Boolean(process.env.GH_TOKEN),
    GITHUB_TOKEN: Boolean(process.env.GITHUB_TOKEN),
    ghAuthenticated: gh?.exitCode === 0,
  },
  tools: Object.fromEntries(["gh", "git", "node", "npx", "python", "mitmdump", "cargo", "claude"]
    .map(name => [name, Boolean(Bun.which(name))])),
  liveCaptureReady: extensions.length > 0 && Boolean(Bun.which("mitmdump")),
};
mkdirSync("evidence/private", { recursive: true });
writeFileSync("evidence/private/preflight.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
