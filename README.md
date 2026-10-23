# GHCP → Claude Bridge

A localhost gateway that runs the installed Claude Code CLI against account-entitled GitHub Copilot models. Claude models use Copilot's native Messages endpoint; other models have separate Responses and Chat Completions adapters. Metrics stay in local SQLite WAL.

**Preview: working Windows binary, with acceptance checks outstanding.** Real Claude Code chat, streaming, Read/Edit/Bash, a foreground subagent, token usage and automatic compaction recovery have passed through Copilot Auto. The tested free account selects `gpt-6-luna`; native Claude calls are rejected by its account path. Free, individual paid, business and enterprise share endpoint discovery, subject to actual entitlements. Other plans have not been tested live.

Current acceptance scope is Windows + Copilot Free + Auto; native Claude entitlement and macOS/Linux acceptance are deferred. Auto-mode classification for Bash, Agent and subagent hand-back has now passed live after fixing local Responses stop-sequence handling. See [classifier diagnosis and verification](evidence/AUTO-MODE-CLASSIFIER.md). The fix preserves Claude's safety checks; it does not bypass unavailable or denied classification.

## Run on Windows

```powershell
.\dist\ghcp-bridge-windows-x64.exe start
```

Open [the dashboard](http://127.0.0.1:4141). In another terminal:

```powershell
.\dist\ghcp-bridge-windows-x64.exe claude
```

The launcher reuses the installed `claude`, prepares first-run onboarding and supplies the local proxy credential. It preserves normal Claude storage, hooks, local MCP and tool permissions. A new workspace can still ask for normal trust. Use the launcher for first-run setup; starting the proxy alone cannot change another terminal's environment.

```powershell
.\dist\ghcp-bridge-windows-x64.exe status
.\dist\ghcp-bridge-windows-x64.exe stop
.\dist\ghcp-bridge-windows-x64.exe auth
.\dist\ghcp-bridge-windows-x64.exe env
.\dist\ghcp-bridge-windows-x64.exe claude -- --model copilot-auto
```

`start` runs in the foreground. `claude` can start an owned proxy and stop it when Claude exits. There is no tray or autostart service. Commands accept `--port N`, `--config FILE` and `--data-dir DIR`. Default Windows storage is `%LOCALAPPDATA%\ghcp-bridge`; credentials are in Windows Credential Manager. Retention defaults to 90 days. A small runtime file tracks the active port when a saved port change is pending.

`env` prints shell settings, including a secret local proxy key. Keep that output out of logs/source control. It sets `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL` and model slots, and clears conflicting API-key/OAuth/provider variables. Environment setup alone can still show first-run onboarding. A complete audit that Claude makes no Anthropic/background connections remains pending.

## Authentication and discovery

Order: `GH_TOKEN` / `GITHUB_TOKEN`, `gh auth token`, Windows VS Code GitHub session, then explicit OAuth device authorization. Existing logins are tried before offering device flow. Copilot tokens refresh and are cached in the Windows vault. macOS/Linux currently use a restricted 0600-file fallback; their VS Code session decryption is not implemented.

The upstream host comes from token exchange endpoints, including business/enterprise hosts. Configure `auth.githubHost` for EMU, or select a logged-in gh host. Multiple identities require a choice. Copilot discovery uses manifest identity across bundled/versioned, portable, Stable/Insiders, custom and PATH layouts. Extension location and sign-in storage are separate.

Example configuration; every auth override is optional:

```json
{
  "port": 4141,
  "retentionDays": 90,
  "requireApiKey": true,
  "models": {"default":"copilot-auto","sonnet":"copilot-auto","opus":"copilot-auto","haiku":"copilot-auto"},
  "auth": {
    "githubHost": "github.com",
    "vscodePaths": ["D:\\Apps\\VS Code"],
    "extensionPaths": ["D:\\Custom Extensions"],
    "userDataDirs": ["D:\\VSCodeData"],
    "sharedDataDirs": ["D:\\VSCodeSharedData"]
  }
}
```

`GHCP_COPILOT_PATH`, `GHCP_VSCODE_PATH`, `VSCODE_EXTENSIONS` and `VSCODE_PORTABLE` are also supported. Remote/WSL credentials must be accessed where the bridge runs; it does not inspect another machine automatically. Arbitrary undiscoverable locations require an explicit path.

## Dashboard

Five offline React views: Status, Usage, Live log, Limits and Settings. They display account/auth/TTL, shell setup, per-model totals, activity heatmap, daily series, p50/p95 latency, errors, tool ratio, session spans, redacted requests, refresh events, observed headers and returned account quota. Premium estimates are N/A; billing is not invented. Model mappings apply immediately; port changes require restart.

Request-body string values are redacted before SQLite insertion. This preview uses Bun's `bun:sqlite` because `better-sqlite3` failed to install without Windows C++ tools. The user approved this driver change; see [M3 findings](evidence/M3-DASHBOARD.md). Management requires a local session or proxy key even when model API-key enforcement is disabled. No external fonts, scripts, CDN calls or dashboard telemetry are used.

## Develop and build

```powershell
bun install --frozen-lockfile
bun test
bun run typecheck
bun run build
bun run build:all
```

`build` creates the host executable. `build:all` creates Windows x64, macOS arm64/x64 and Linux arm64/x64 executables plus checksums under `dist/`. UI and license notices are embedded; binaries need no Bun installation or asset folder. Only Windows has been runtime tested; other targets still need platform testing. See [packaging evidence](evidence/M4-PACKAGING.md).

For source execution, run `bun run build:ui`, then `bun run start` and `bun run claude` in separate terminals. `research:preflight`, `research:discover` and `research:extension` inspect local prerequisites/static source without model calls. Private captures, credentials and test profiles are ignored under `evidence/private/` and `.research/`.

## Evidence and remaining acceptance

[PROTOCOL.md](PROTOCOL.md) distinguishes observations from assumptions. See [M1 auth](evidence/M1-AUTH.md), [M2 proxy](evidence/M2-PROXY.md), [M3 dashboard](evidence/M3-DASHBOARD.md), and [first-run findings](evidence/CLAUDE-FIRST-RUN.md).

- Native Claude is mock-tested but unavailable on the tested account. No live native Claude success is claimed.
- Auto-compaction recovered from an injected captured real overflow error, then continued with real Copilot calls. This was not a 900k-token live CLI conversation.
- Reasoning history is replayable within its provider/model; crossing vendors can require a fresh conversation. Provider-specific server tools and full Anthropic feature parity are not established.
- Claude's dollar figures for custom model IDs are estimates with unknown cost basis, not Copilot charges. Interactive `/usage` displays real token counts; cross-vendor `/model` still needs an entitled account.
- Refresh coverage simulates 35 days; it is not a completed soak. Visual browser QA and a complete process-level egress audit remain pending. Managed corporate settings can prevent provider redirection.

Reuse is tracked in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); `ghcp-bridge licenses` prints bundled notices.

Unsupported by GitHub. Use may violate Copilot terms and corporate policy, may be audit-logged, and may risk seat enforcement. Keep usage interactive and low-volume. Account entitlements and organization policy are never bypassed.
