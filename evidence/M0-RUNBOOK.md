# Complete M0 locally

This is a procedure, not a record of completed captures. Current blockers and attempted commands are in [ENVIRONMENT.md](ENVIRONMENT.md). All artifacts stay local. Use a blank workspace and synthetic prompts; do not capture a corporate project conversation. No raw capture, credential, or private account metadata belongs in a commit.

## 1. Preflight and REA

```powershell
bun run research:preflight
bun run research:extension
```

Preflight checks credentials by presence only. Static inspection does not execute extension code. Reports are ignored under `evidence/private/`.

When npm access is available, follow [REA's official setup](https://github.com/morluto/rea): `npx rea-agents setup`. The setup modifies agent configuration and requires an agent restart to expose its MCP tools; it has **not** been run successfully in this session. Do not claim MCP analysis based on the literal-search fallback. Use REA's JavaScript application analysis on the extension root reported by the script. The documented CLI equivalent is:

```powershell
npx -y rea-agents analyze-javascript-application "<reported extension root>" --json
```

Save the report privately; record REA version and bundle hash. Review any setup configuration changes locally. Do not overwrite the user's Claude configuration as part of research.

## 2. Capture VS Code

Install mitmproxy locally when package access is restored (prefer a workspace venv). Use a dedicated capture configuration directory so CA keys remain in ignored storage. Bind only to loopback:

```powershell
python -m venv .research/venv
.research/venv/Scripts/python -m pip install mitmproxy
New-Item -ItemType Directory -Force evidence/private | Out-Null
.research/venv/Scripts/mitmdump --listen-host 127.0.0.1 --listen-port 8089 --set confdir=./evidence/private/mitm-conf -w evidence/private/vscode.mitm
```

These commands have not been executed successfully here. This writes raw secrets to local ignored storage: restrict the capture directory with Windows user-only ACLs before starting. Never upload it or paste it into a tool transcript. Use a scoped VS Code process/profile or approved Developer Tools HAR export, not machine-wide proxy settings. Trust the capture certificate only for the dedicated process/profile, retain TLS verification upstream, and remove scoped settings after capture. Do not disable TLS verification globally. mitmdump raw files are not redacted by this repository.

Confirm the exact running bundled extension version and route only the dedicated test instance through the capture listener. A separate profile may require selecting the existing GitHub account through VS Code's authentication UI. Merely exporting HTTPS_PROXY may not route Electron or extension-specific transports; validate an actual captured request before proceeding.

Record a synthetic sequence: first user greeting, tool request and tool_result continuation, follow-up user message, model switch, image, thinking. Capture token exchange/catalog/quota paths as available. Keep request ordering and correlation IDs in the private artifact. Never assume that a header is required merely because it is present.

Produce a manually reviewed redacted summary with method, origin/path (no secret query parameters), protocol header names/values, body schema, safe synthetic system/message content, timestamps, status, request ID, rate headers, and ordered SSE event types. Authorization, cookies, GitHub tokens, Copilot tokens, device codes, account identifiers, machine/session IDs and arbitrary prompt/tool strings must be removed. Record redacted presence or capture-local pseudonyms when sequence correlation matters. Store full wire evidence only privately; a HAR screenshot or log excerpt alone does not prove the entire sequence.

## 3. Pin and inspect reference proxies

Clone each requested repository under ignored `.research/` and record `git rev-parse HEAD`, capture timestamp, branch and SHA-256 of relevant source files. Fetch failures in this session mean current source links in PROTOCOL.md are still unpinned. Finish the cells marked not audited, especially proactive/auto-truncation code, model mapping, header precedence and preprocessing.

## 4. Dynamic messense comparison

Do not start the inspected server unmodified: its entry point binds 0.0.0.0. In the ignored checkout, patch listener binding to **127.0.0.1** and record the exact patch and commit SHA. Review any other listeners or service-install paths. Build in the workspace and run the server subcommand only; do not install a service. Use a different port from the bridge default, e.g. 4142.

Run a separate loopback mitmdump capture with private output `messense.mitm`. Configure the reference process's HTTP client proxy and scoped CA trust, then verify actual upstream traffic was captured. Supply any credential through the process environment or secure provider, never as a CLI argument or printed log. Avoid debug logging that can emit payloads/tokens.

Replay the same synthetic request sequence. Diff method/path, discovered origin, headers, initiator sequence, model/max_tokens, system/thinking/tool/image blocks, response status, usage and SSE event sequence. Normalize only timestamps and correlation IDs; list every body/header mutation. Dynamic evidence overrides static assumptions. Stop capture/reference processes afterward and verify listener removal.

## 5. Account probes and M0 exit

- Obtain `/models` and retain the exact account-enabled IDs, native supported endpoints, limits and policy. Never manufacture a list from README examples.
- Probe native count_tokens; record status and shape. A local estimate is explicitly tagged, and direct Anthropic counting is excluded.
- Send a unique synthetic system instruction and inspect both outgoing body and returned behavior. This proves request preservation and observed behavior, not invisible backend internals.
- Probe max_tokens around claimed boundaries with cheap synthetic output; inspect terminal stop_reason and usage. Check thinking budgets against output limits.
- Trigger a context-limit error and record its actual shape without printing the oversized payload. Later M2 integration must show Claude Code auto-compaction and continuation; an error-mapping unit test cannot establish that.
- Validate quota endpoint and distinguish absent data from zero. Determine account plan from observed metadata, never from a hardcoded host.
- Promote only observed claims to verified-live, attach private artifact paths/hashes, and commit the completed M0 protocol. Keep personal free/paid/enterprise test results separate.

Thirty-day silent refresh and full Claude Code compatibility are later acceptance gates; M0 research cannot certify them.
