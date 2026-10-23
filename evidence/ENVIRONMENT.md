# Local M0 observations

**Update after unrestricted access became available:** see [LIVE-2026-10-23.md](LIVE-2026-10-23.md). REA/mitmproxy were installed locally, all reference sources were pinned, the current bundled extension is 0.71.0, and the existing VS Code login was reused through its cross-app shared storage. Live VS Code/Auto/Responses and reference captures succeeded. The observations below describe the initial restricted run and are retained as history, not current blockers.

Recorded 2026-10-23 in `C:\Users\Tanishk\Desktop\ghcpToClaude`.

| Check | Observed result |
| --- | --- |
| Workspace | Initially empty, not a Git repository; initialized locally |
| Bun | 1.3.13 |
| Installed commands | git, gh, bun, node, npm, npx, python, code, claude |
| Copilot Chat (initial check) | No `github.copilot-chat-*` directory under the supplied `.vscode/extensions` path; absent from `code --list-extensions --show-versions` |
| Copilot Chat (located) | Bundled **GitHub.copilot-chat 0.68.0** under versioned VS Code application build `07f806f999/resources/app/extensions/copilot`; identified from `bin/code.cmd`. See EXTENSION-STATIC.md. |
| Alternative standard paths | No Copilot Chat directory found under `.vscode-insiders/extensions` or `.vscode-server/extensions` |
| Environment credentials | Neither GH_TOKEN nor GITHUB_TOKEN present |
| GitHub CLI | `gh auth status`: not logged into any GitHub hosts |
| mitmproxy | `python -m pip show mitmproxy`: package not found; mitmdump command absent |
| Rust | cargo/rustc commands absent |
| REA MCP tools | No REA tool advertised in this session |
| REA clone | Connection to github.com:443 failed |
| REA npm execution | `npx --yes rea-agents --help` failed with EACCES fetching registry.npmjs.org; cache redirected inside workspace |
| Web research | Public source files readable through web tool; several paths unavailable; no authenticated calls made |

No token values were printed, no OAuth flow started, and no TLS trust or VS Code settings were modified. No network listener was started. Failed source clone and npm cache are ignored under `.research/`.

After the user clarified that sign-in was through VS Code only, bundled application folders were inspected. GitHub authentication/Copilot storage key names exist in VS Code's state database; values were not read or decrypted. No current session was validated. Other versioned application builds exist and running GUI build remains unknown.

The user clarified that the current Copilot account is personal. Required plan coverage is individual free, individual paid, and enterprise (also support business through the same discovery mechanism). Entitlements must be discovered rather than inferred from an account label.

Re-run `bun run research:preflight` after the working account/extension location is available. A credential-presence report is written only to ignored `evidence/private/`.
