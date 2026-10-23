import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { claudeEnvironment, prepareClaudeOnboarding } from "../src/client/claude-launch";

const temporary: string[] = [];
function configPath() { const dir = mkdtempSync(join(tmpdir(), "bridge-onboarding-")); temporary.push(dir); return join(dir, ".claude.json"); }
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive:true, force:true }); });
const connection = { port:4141, key:"local-test-key", model:"copilot-auto", smallModel:"copilot-auto" };

test("child routing overrides conflicting provider credentials without changing parent or local harness settings", () => {
  const parent = { ANTHROPIC_API_KEY:"old", CLAUDE_CODE_OAUTH_TOKEN:"old-oauth", CLAUDE_CODE_USE_VERTEX:"1",
    anthropic_api_key:"case-variant", anthropic_base_url:"https://old-provider.invalid", CLAUDE_CODE_ENABLE_BACKGROUND_PLUGIN_REFRESH:"1",
    ANTHROPIC_BASE_URL:"https://api.anthropic.com", CLAUDE_CONFIG_DIR:"existing-config", MCP_CUSTOM_ENV:"keep" };
  const env = claudeEnvironment(connection,parent);
  expect(env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:4141");
  expect(env.ANTHROPIC_AUTH_TOKEN).toBe(connection.key);
  expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  expect(env.CLAUDE_CODE_USE_VERTEX).toBeUndefined();
  expect(env.anthropic_api_key).toBeUndefined();
  expect(env.anthropic_base_url).toBeUndefined();
  expect(env.CLAUDE_CODE_ENABLE_BACKGROUND_PLUGIN_REFRESH).toBeUndefined();
  expect(env.CLAUDE_CONFIG_DIR).toBe("existing-config");
  expect(env.MCP_CUSTOM_ENV).toBe("keep");
  expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe("1");
  expect(parent.ANTHROPIC_API_KEY).toBe("old");
  expect(env.CLAUDE_CODE_SIMPLE).toBeUndefined();
});
test("incomplete proxy readiness cannot produce a launch environment", () => {
  expect(() => claudeEnvironment({...connection,key:""})).toThrow();
  expect(() => claudeEnvironment({...connection,port:0})).toThrow();
});
test("fresh config marks only onboarding and does not grant workspace or tool permissions", () => {
  const file=configPath();expect(prepareClaudeOnboarding(file)).toEqual({changed:true});
  expect(JSON.parse(readFileSync(file,"utf8"))).toEqual({hasCompletedOnboarding:true});
});
test("existing fields survive and original bytes are backed up; repeat preparation is a no-op", () => {
  const file=configPath();const original=JSON.stringify({theme:"dark",projects:{example:{hasTrustDialogAccepted:false}},other:42});
  writeFileSync(file,original);const result=prepareClaudeOnboarding(file);
  expect(readFileSync(result.backup!,"utf8")).toBe(original);
  expect(JSON.parse(readFileSync(file,"utf8"))).toEqual({...JSON.parse(original),hasCompletedOnboarding:true});
  const count=readdirSync(dirname(file)).length;
  expect(prepareClaudeOnboarding(file)).toEqual({changed:false});
  expect(readdirSync(dirname(file))).toHaveLength(count);
});
test("malformed config is preserved instead of being reset", () => {
  const file=configPath();writeFileSync(file,"{broken");
  expect(() => prepareClaudeOnboarding(file)).toThrow();
  expect(readFileSync(file,"utf8")).toBe("{broken");
});
