# GHCP → Claude Bridge

Local bridge research for Claude Code using account-entitled GitHub Copilot models, including non-Anthropic models. Required plans: individual free, individual paid, business and enterprise. Availability depends on the authenticated account's models, protocol capabilities and policy.

**Current state: M2 proxy checkpoint works from source; dashboard/packaging are in progress.** Real Claude Code chat, Read/Edit/Bash, a foreground subagent and automatic recovery from an injected captured overflow error passed through the proxy. Existing VS Code auth and Windows Credential Manager cache work across restarts. See [M2 findings and remaining gates](evidence/M2-PROXY.md), [M1 auth](evidence/M1-AUTH.md), and [PROTOCOL.md](PROTOCOL.md). Native Claude generation is still unavailable in the tested account path.

From the repository, run `bun install`, then `bun run start` in one terminal and `bun run claude` in another. The launcher uses your existing Claude executable, sets local routing and avoids Anthropic sign-in. Alternatively, `bun src/cli.ts claude` starts an owned proxy for that session if none is running. `bun src/cli.ts status`, `stop`, `auth`, and `env` provide management. Default data storage is the user's local ghcp-bridge directory; `--data-dir`, `--config` and `--port` override it. API keys are stored in the OS vault on Windows; do not paste `env` output into logs or commit it.

```powershell
bun run research:preflight
bun run research:extension
```

These dependency-free research commands inspect local prerequisites/static source and write ignored evidence. No model calls, OAuth, credential decryption, network listener, telemetry or Claude configuration changes are performed.

Copilot discovery uses manifest identity rather than a fixed folder name. It checks standard Stable/Insiders extension directories, bundled/versioned application directories, portable layouts, and applications found through PATH on Windows, macOS and Linux. Remote/WSL storage is checked on the host where the bridge runs; it does not access another machine automatically.

For custom installations or extension directories, supply paths explicitly (spaces are supported):

```powershell
bun run research:discover --vscode-path "D:\Apps\VS Code Portable"
bun run research:preflight --extension-path "D:\Custom Extensions"
bun run research:extension --extension-path "D:\Custom Extensions\github.copilot-chat-version"
```

Paths can be repeated. `GHCP_COPILOT_PATH` supplies an extension root or extensions directory; `GHCP_VSCODE_PATH` supplies an application root or executable. Discovery also accepts `VSCODE_EXTENSIONS` and `VSCODE_PORTABLE`. Static inspection requires selecting an exact extension when discovery finds multiple copies, avoiding accidental analysis of an old build. Planned M1 authentication will use the matching VS Code user-data/profile independently of the extension location; moving the extension does not move its stored sign-in. Environment/gh authentication will not require an installed extension.

Build order: M0 protocol verification → M1 existing-session auth → M2 native streaming proxy → M3 local SQLite/React dashboard → M4 compiled CLI packaging. Do not advance a milestone based on assumed live compatibility.

Architecture target: one Bun/TypeScript process bound to 127.0.0.1:4141; native `/v1/messages` forwarding for Claude models, and protocol adapters for other account-enabled models; local SQLite WAL metrics; embedded offline React/Vite UI; OS-protected credentials. Claude model traffic never uses OpenAI translation. Conversation truncation stays with Claude Code. See [model routing requirements](evidence/MODEL-ROUTING.md); adapters are planned, not implemented or validated yet.

First-use requirement: the launcher prepares local provider credentials and onboarding so Claude Code needs no Anthropic sign-in. Startup helpers and a fresh interactive test against a localhost stub are in place; they are not yet integrated into a finished launcher. See [first-run findings](evidence/CLAUDE-FIRST-RUN.md). Code reuse is tracked in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Unsupported by GitHub. Use may violate Copilot terms and corporate policy, may be audit-logged, and may risk seat enforcement. Keep usage interactive and low-volume. The bridge must never bypass account entitlements or fabricate quota/model availability.
