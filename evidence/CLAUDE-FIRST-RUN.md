# Claude Code first-run requirement and probe

Required behavior: after provider redirection is configured and the bridge is ready, a first-time Claude Code CLI user must not need an Anthropic account, API key, browser OAuth flow or manual auth setup. Model/auth requests use the local bridge. A down/unready bridge must produce a local error, with no Anthropic fallback.

## Verified on 2026-10-23

Installed CLI: **Claude Code 2.1.269**, unmodified native executable. A local stub on **127.0.0.1:4199** supplied synthetic Messages JSON/SSE. This tests client startup/routing, not Copilot integration or full harness compatibility.

1. An empty isolated CLAUDE_CONFIG_DIR with ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN skipped sign-in but still showed theme/security onboarding.
2. A second fresh isolated config with only `hasCompletedOnboarding: true` in its `.claude.json` skipped those onboarding screens and reached the normal workspace trust prompt, without an Anthropic login/API-key screen.
3. After accepting trust for the empty synthetic workspace, the normal interactive prompt opened. Sending a synthetic prompt returned **BRIDGE_READY** from the localhost stub. The stub observed HEAD `/api/hello` and authenticated streaming POST `/v1/messages`; no auth endpoint was requested at the stub.
4. No --bare, demo mode, permission bypass, CLI patch, existing-login deletion or production profile change was used. Test sessions and listener were stopped.

The initial fresh profile also downloaded the official plugin marketplace despite the nonessential-traffic flag on this CLI version. Installed-code inspection identified `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL`; the helper now sets it and unsets the opt-in background plugin refresh flag. A subsequent clean-profile print-mode probe returned BRIDGE_READY with no marketplace directory created. Existing installed plugin/hook/MCP definitions are not removed. Test discovery is confined to `tests/` so private capture profiles or downloaded reference tests are never run as project tests.

This establishes observed first-run auth/onboarding behavior and local response routing on this version. It is **not** a complete process-level egress audit or a guarantee for future versions. The final launcher needs a fresh-profile network capture asserting no Anthropic API/auth/telemetry connections. Native workspace trust and tool/MCP permission decisions remain intact.

## Implementation prepared

`src/client/claude-launch.ts` provides child-environment preparation and a minimal onboarding-state merge, including backup and preservation of unrelated config fields. It leaves CLAUDE_CONFIG_DIR/storage location, hooks, MCP configuration and permissions in place. It removes competing inherited Anthropic credentials/provider switches from the child, uses only the proxy-issued bearer credential, and disables nonessential traffic/telemetry/updates and Claude-hosted MCP discovery. Locally configured MCP remains governed by normal Claude settings.

The helper is not yet wired into a finished CLI/proxy. Integration must resolve the actual active config path and version, wait for a healthy authenticated bridge/model mapping, and respect managed settings. User/project env settings can override shell variables; validate the effective route and fail clearly on conflicts instead of bypassing corporate policy. Do not start Claude against a guessed or unready provider.

Proposed UX: `ghcp-bridge claude [args...]` prepares first-run state and starts the existing CLI. For plain `claude` in other terminals, install/merge the provider settings or source the generated environment first: a separately running proxy cannot change an unrelated shell's environment. Persistent setup must preserve and back up existing settings, and provide a reversal path. Do not point the user's normal CLI at the unfinished proxy during development.

## Primary documentation checked

- [Gateway setup](https://code.claude.com/docs/en/llm-gateway-connect): base URL and bearer credential configure gateway access; auth-token env takes precedence over a saved login without the API-key approval path.
- [Environment variables](https://code.claude.com/docs/en/env-vars): nonessential-traffic controls and env/settings precedence. The onboarding marker was verified through installed-code inspection and a local experiment, rather than presented as a documented public setting.

Acceptance additions: fresh interactive profile, existing logged-in profile, conflicting API key/provider configuration, cold proxy, restart, supported CLI versions, no unexpected egress, and preservation of hooks/MCP/tool permissions. Repeat with the real bridge after M2.
