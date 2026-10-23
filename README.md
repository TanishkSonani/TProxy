# GHCP → Claude Bridge

Local bridge research for Claude Code using account-entitled GitHub Copilot models, including non-Anthropic models. Required plans: individual free, individual paid, business and enterprise. Availability depends on the authenticated account's models, protocol capabilities and policy.

**Current state: M1 Windows auth checkpoint implemented and live-tested; proxy/dashboard still in progress.** Existing VS Code auth and a Windows Credential Manager cache work across process restarts. See [M1 findings](evidence/M1-AUTH.md), [PROTOCOL.md](PROTOCOL.md) and [live findings](evidence/LIVE-2026-10-23.md). Native Claude access remains unverified because the service rejected the tested model.

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
