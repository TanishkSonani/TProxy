import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export type ClaudeConnection = { port: number; key: string; model: string; smallModel: string;sonnetModel?:string;opusModel?:string };

// Return a child environment; never mutate the caller's shell or saved credentials.
export function claudeEnvironment(connection: ClaudeConnection,
  inherited: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  if (!Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535)
    throw new Error("Invalid proxy port");
  if (![connection.key, connection.model, connection.smallModel].every(value => value.trim().length > 0))
    throw new Error("Proxy credential and model mappings must be ready before starting Claude Code");
  const env = { ...inherited };
  const conflicts = new Set(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
    "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR", "ANTHROPIC_UNIX_SOCKET", "ANTHROPIC_CUSTOM_HEADERS",
    "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "CLAUDE_CODE_USE_ANTHROPIC_AWS",
    "CLAUDE_CODE_ENABLE_BACKGROUND_PLUGIN_REFRESH"]);
  const overrides = {
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${connection.port}`,
    ANTHROPIC_AUTH_TOKEN: connection.key,
    ANTHROPIC_MODEL: connection.model,
    ANTHROPIC_SMALL_FAST_MODEL: connection.smallModel,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: connection.smallModel,
    ANTHROPIC_DEFAULT_SONNET_MODEL: connection.sonnetModel??connection.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: connection.opusModel??connection.model,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", DISABLE_AUTOUPDATER: "1",
    CLAUDE_CODE_ENABLE_TELEMETRY: "0", OTEL_SDK_DISABLED: "true",
    CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: "1",
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  };
  for (const name of Object.keys(env))
    if (conflicts.has(name.toUpperCase()) || Object.hasOwn(overrides,name.toUpperCase())) delete env[name];
  return { ...env, ...overrides };
}

// Version-sensitive local onboarding state, observed in Claude Code 2.1.269.
// Caller resolves the CLI's actual config path and checks policy/readiness first.
// This does not approve workspace trust, tool execution, MCP servers or OAuth.
export function prepareClaudeOnboarding(configFile: string): { changed: boolean; backup?: string } {
  const original = existsSync(configFile) ? readFileSync(configFile, "utf8") : undefined;
  const config = original === undefined ? {} : JSON.parse(original.replace(/^\uFEFF/, ""));
  if (!config || typeof config !== "object" || Array.isArray(config))
    throw new Error("Claude Code config must be a JSON object; refusing to replace it");
  if (config.hasCompletedOnboarding === true) return { changed: false };
  mkdirSync(dirname(configFile), { recursive: true });
  const suffix = randomUUID();
  const temporary = `${configFile}.ghcp-bridge-${suffix}.tmp`;
  const backup = original === undefined ? undefined : `${configFile}.ghcp-bridge-${suffix}.backup`;
  try {
    if (backup) writeFileSync(backup, original!, { flag: "wx", mode: 0o600 });
    writeFileSync(temporary, JSON.stringify({ ...config, hasCompletedOnboarding: true }, null, 2) + "\n",
      { flag: "wx", mode: 0o600 });
    // Avoid replacing a config changed by another process during preparation.
    const current = existsSync(configFile) ? readFileSync(configFile, "utf8") : undefined;
    if (current !== original) throw new Error("Claude config changed during preparation; retry before launching");
    renameSync(temporary, configFile);
    return { changed: true, ...(backup ? { backup } : {}) };
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
