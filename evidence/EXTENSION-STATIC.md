# Installed extension static evidence

**Current-run update:** automatic discovery found bundled GitHub.copilot-chat **0.71.0** in build `e646868227`. SHA-256: `c69be60325138fd7ce9cfdf066dc146acdf115219b81184b44e984e60b1b8aff`; 19,755,964 bytes. The reproducible inspection script was rerun against it. REA MCP analysis of the companion GitHub authentication extension succeeded; full Copilot bundle analysis timed out. Current findings and limitations are in [LIVE-2026-10-23.md](LIVE-2026-10-23.md) and the root protocol. The 0.68.0 offsets below are historical and must not be applied to the new bundle.

Observed 2026-10-23. Run `python scripts/inspect-extension.py` to reproduce excerpts locally.

The CLI launcher selects build `07f806f999`, whose bundled extension is **GitHub.copilot-chat 0.68.0**:

`%LOCALAPPDATA%/Programs/Microsoft VS Code/07f806f999/resources/app/extensions/copilot/dist/extension.js`

SHA-256: `a918eb6ed04a7fb10ab673f2243b4dbd9ac8368c8ba82a60194d74ca45c1191f`

Size: 19,679,291 bytes. Offsets below refer to character positions in the UTF-8-decoded bundle, not byte offsets. The running GUI build has not been established; other versioned builds exist. This is static source evidence, not a live wire observation. REA could not be installed; inspection used a reproducible literal search script instead.

| Location (character offset) | Observation |
| --- | --- |
| 12,178,201 | Enterprise URL is parsed; GitHub API origin constructed as scheme + `api.` + hostname + optional port. Default is `https://api.github.com`. Tenant URL and API URL are distinct. |
| 12,178,540 | CAPI origin uses token response `endpoints.api`; extension has `https://api.githubcopilot.com` fallback. Bridge must require discovered origin instead of copying this fallback. |
| 12,179,004 | Model catalog path `/models`; adjacent getters expose `/v1/messages`, `/responses`, `/chat/completions`. |
| 12,179,935 | Token exchange URL is GitHub API origin + `/copilot_internal/v2/token`. |
| 12,193,498 | Model request dispatch uses catalog getter; ChatMessages dispatch uses native messages getter. |
| 12,201,051 | Header mixin supplies editor/plugin versions, device/machine/session identifiers, and GitHub API version `2026-08-01`. |
| 12,201,520 | Integration ID depends on SKU/license/build. Licensed production branch uses `vscode-chat`; unauthenticated limited branch uses `vscode-nl`. This does not establish signed-in free-plan behavior. |
| 12,279,636 | Output token limit uses model capability metadata with 4096 fallback. This does not prove a universal 4096 maximum or a 100 minimum. |
| 12,282,283 | Anthropic beta header is feature/model-dependent; non-adaptive models add interleaved-thinking beta; tool search/context-management/cache TTL betas are conditional. |
| 12,283,000 | Native messages support checks `/v1/messages` in `supported_endpoints` plus a feature flag. Names alone do not establish protocol support. |
| 12,732,871 | Token exchange uses `Authorization: token <GitHub-session-token>` through the token request dispatcher. |
| 12,736,708 | Authentication uses VS Code authentication APIs; provider selector supports `github` and `github-enterprise`. |
| 14,781,228 | Request instrumentation chooses `X-Initiator` from a caller boolean; includes interaction ID and conditional vision header. Caller semantics need tracing/live sequence; this does not establish sticky history behavior. |
| 14,903,138 | Quota refresh uses GitHub session token on Copilot user-info request. |

`count_tokens` strings occur in embedded Anthropic SDK code. SDK presence alone does **not** verify Copilot count_tokens support. No global 100..4096 clamp was established. Model IDs embedded in SDK constants are not the user's enabled catalog.

Read-only SQLite inspection found GitHub authentication and Copilot storage key names in VS Code's local state. No values were read/decrypted, so this establishes prior storage presence, not a valid current session. User says authentication was through VS Code only.
