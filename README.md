# TProxy

Current version: **1.0.1**, the environment-trust architecture release. Compatibility remains a preview within the tested scope below.

A local gateway that connects your installed Claude Code CLI to models available through your GitHub Copilot account. Claude models use Copilot's native Messages endpoint; other models use Responses or Chat Completions adapters. An offline dashboard stores usage in local SQLite.

**Preview:** tested on Windows with Copilot Free and Auto. Paid, business and enterprise accounts use discovered endpoints and account entitlements, but have not been verified live. Full Anthropic feature parity is not guaranteed. See [known limitations](docs/LIMITATIONS.md).

## Windows quick start

Claude Code must already be installed. The packaged utility needs no administrator rights, Bun installation or permanent PATH changes.

1. Build the portable package using the instructions below, or obtain a trusted TProxy Windows package.
2. Copy the complete `TProxy` folder to `%LOCALAPPDATA%\Programs\TProxy`.
3. Double-click `Open-TProxy-Terminal.cmd` in that folder.
4. In the opened terminal, run:

   ```cmd
   tproxy setup
   tproxy desktop
   ```

5. Click **Start server**, then **Open dashboard**. In the TProxy terminal, launch Claude:

   ```cmd
   tproxy claude
   ```

The desktop and tray icons turn green when the proxy responds and grey when it stops. The monitor must be running to update the desktop icon. Login startup runs the monitor, not the proxy.

For an ordinary **PowerShell** terminal where `tproxy` is not recognized, use the full path:

```powershell
& "$env:LOCALAPPDATA\Programs\TProxy\tproxy.exe" dashboard
& "$env:LOCALAPPDATA\Programs\TProxy\tproxy.exe" claude
```

The bare localhost URL does not grant dashboard access. Use **Open dashboard** or the private link printed by `tproxy dashboard`. Keep that link private.

See the [step-by-step Windows guide](docs/windows/SETUP-INSTRUCTIONS.md) for installation, upgrades, troubleshooting and removal.

## Features

- Streaming, tool calls, model mapping, vision and provider usage forwarding, subject to model capabilities.
- Existing-login reuse: environment token, GitHub CLI, Windows VS Code session, then OAuth device flow.
- Copilot endpoint discovery for individual and organizational accounts, plus explicit GitHub host selection for enterprise managed users.
- Metadata-driven context windows and Anthropic-format overflow errors; no usage multipliers or automatic history truncation.
- Local React dashboard: status, usage heatmap, latency, request explorer, observed limits and settings. Explore dates, models and outcomes; pause live logs without stopping the proxy.
- Secret previews are masked until revealed. Copy actions identify credentials, and disabling the proxy API key requires confirmation.
- Limits automatically checks account quotas on entry, every 30 seconds while visible, and when the tab regains focus. Concurrent checks are coalesced, failures back off, and provider Retry-After is respected. Rate-limit headers update from actual model responses; timestamps distinguish newly received data from cached values.
- Windows desktop controls and status monitor; single executable CLI builds for other platforms.

The launcher supplies the local provider settings and prepares first-run onboarding. Normal Claude storage, hooks, MCP and tool permissions remain in use; workspace trust and corporate policy still apply.

## Commands

Run these in the TProxy terminal, or substitute the full executable path:

```cmd
tproxy start
tproxy status
tproxy dashboard
tproxy claude
tproxy claude -- --model copilot-auto
tproxy stop
tproxy auth
tproxy env
tproxy licenses
```

`start` runs in the foreground. The desktop controller starts it in the background. `claude` can start an owned proxy and stop it when Claude exits; it leaves an already-running proxy alone.

Options include `--port N`, `--config FILE` and `--data-dir DIR`. Default listen address: `127.0.0.1:4141`. Default Windows data directory: `%LOCALAPPDATA%\TProxy`. Never commit a runtime data directory or the secret output of `env`.

## Configuration and authentication

Configuration is stored in the data directory's `config.json`. Example:

```json
{
  "port": 4141,
  "retentionDays": 90,
  "requireApiKey": true,
  "contextFallbackTokens": 200000,
  "models": {
    "default": "copilot-auto",
    "sonnet": "copilot-auto",
    "opus": "copilot-auto",
    "haiku": "copilot-auto"
  }
}
```

Map slots to model IDs available on your account using the dashboard. Listing a model does not guarantee generation entitlement. Explicit unavailable models fail rather than silently switching to Auto.

Authentication checks `GH_TOKEN` / `GITHUB_TOKEN`, `gh auth token`, then existing Windows VS Code sessions before offering device authorization. Windows credentials use Credential Manager with an encrypted CurrentUser-DPAPI fallback. macOS/Linux currently use restricted files and do not decrypt VS Code sessions.

Custom installations can specify `auth.vscodePaths`, `auth.extensionPaths`, `auth.userDataDirs` and `auth.sharedDataDirs` as path arrays. `auth.githubHost` selects a GitHub host. Remote/WSL credentials must be accessible where TProxy runs. Use separate data directories for separate accounts.

If your Git publishing login differs from your Copilot account, set `auth.account` to the Copilot GitHub login. TProxy asks GitHub CLI for that specific account and falls back to the matching VS Code session when it is absent, without changing your active Git publishing account.

Context limits come from Copilot model metadata. `contextFallbackTokens` applies only when limits are unavailable; optional `contextWindowTokens` imposes a ceiling. Relaunch Claude after changing models or limits.

## Develop and build

Prerequisites: Bun; Python for generated Windows icons and research checks; installed .NET Framework compiler for the Windows desktop controller.

The real TLS fixture also uses OpenSSL when it is on PATH; that check is skipped when OpenSSL is unavailable.

```powershell
bun install --frozen-lockfile
bun test
bun run typecheck
bun run test:ui
bun run build
bun run package:windows
```

- `build`: host CLI executable with embedded dashboard and license notices.
- `package:windows`: portable six-file utility under `dist/TProxy`.
- `TPROXY_BUILD_DIR=dist/<staging-name>` selects a separate staging directory for builds and packaging; output is restricted to the repository's `dist` tree.
- `build:all`: Windows x64, macOS arm64/x64 and Linux arm64/x64 executables. Only Windows has been tested live.
- Source execution: `bun run build:ui`, then `bun run start` and `bun run claude` in separate terminals.

Source lives in `src/`, dashboard code in `dashboard/`, regression tests in `tests/` and build/diagnostic tools in `scripts/`. Optional research tools write to ignored local directories and are not runtime dependencies.

`test:ui` uses installed Google Chrome in headless mode with synthetic API responses. It checks secret handling, confirmation, filters, live-log pause/resume, chart descriptions and desktop/mobile layouts. Screenshots and traces stay in ignored `test-results/`. These tests make no Copilot model calls.

## Privacy and compatibility

TProxy binds to localhost and adds no third-party telemetry or dashboard CDN calls. Model requests go to GitHub/Copilot; authentication also contacts GitHub. Metrics remain local in SQLite WAL with redacted request content. Dashboard management requires a private authenticated link/session or proxy key.

This is not a guarantee about network activity from Claude Code, hooks, MCP servers or tools. See [limitations](docs/LIMITATIONS.md), the [protocol notes](PROTOCOL.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

The [architecture](docs/ARCHITECTURE.md) explains trust boundaries, environment-provided CAs, local-first startup, Windows deployment and the distinction between implemented behavior and remaining network-policy work.

**Unsupported by GitHub and Anthropic.** Use may violate Copilot terms or corporate policy, may be audit-logged and may risk seat enforcement. Keep usage interactive and low-volume. TProxy does not bypass account entitlements or organizational policy.
