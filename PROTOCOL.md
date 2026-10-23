# GHCP → Claude bridge protocol

Research date: **2026-10-23**. This is an M0 evidence checkpoint, not a claim that the bridge or Claude Code acceptance tests are complete. Live Copilot Auto/Responses traffic is verified. Successful native Claude traffic remains unverified because the tested requests were rejected on this account.

## Evidence

Labels: **verified-live** = observed account traffic; **proxy-consensus** = matching inspected implementations; **single-source** = one source, including extension statics; **assumed** = unverified requirement. A model rejection verifies the rejection, not successful generation capabilities.

Precedence: live VS Code capture > reference proxy dynamic capture > proxy consensus > installed extension statics > one reference source. Pinned/live findings supersede initial cached web views.

- VS Code **1.143.1**, bundled Copilot Chat **0.71.0**. Bundle SHA-256: `c69be60325138fd7ce9cfdf066dc146acdf115219b81184b44e984e60b1b8aff`; 19,755,964 bytes.
- REA **6.7.0** invoked through MCP. GitHub authentication-extension summary analysis succeeded with explicit graph limitations. Full Copilot bundle analysis timed out at 90 and 180 seconds; literal/static inspection and live capture supply the other findings. Full REA analysis must not be reported as successful.
- Actual VS Code requests were captured in an isolated user-data directory and blank synthetic workspace using a loopback reverse proxy. Only that research instance's CAPI/proxy origins were overridden. Authority/origin was intentionally rewritten; provider bodies, headers and responses were observed live. Normal VS Code settings were unchanged.
- Source-pinned messense ran in a disposable Linux container. Server and internal mitmdump bound to 127.0.0.1; no container ports were published. Credential input used stdin. Server source was unchanged.
- Raw captures/private reports are Git-ignored under a Windows user-only ACL. Research listeners/processes were stopped. See [artifact hashes](evidence/ARTIFACT-HASHES.json), [source pins/file hashes](evidence/REFERENCE-PINS.json), [live findings](evidence/LIVE-2026-10-23.md), and [routing requirements](evidence/MODEL-ROUTING.md).

## Account, credentials and origins

| Item | Contract/finding | Confidence |
| --- | --- | --- |
| Current plan | Metadata reports `copilot_plan: individual`, SKU `free_limited_copilot`. This does not verify paid/enterprise behavior. | verified-live |
| Existing login | Reused VS Code's stored GitHub session; no new OAuth/device flow. Env credentials and gh login were absent. | verified-live |
| Windows storage | This build's product metadata points to `.vscode-shared/sharedStorage/state.vscdb`. Secret label: `secret://{"extensionId":"vscode.github-authentication","key":"github.auth"}`. Value is an Electron Buffer JSON with v10 AES-GCM ciphertext; its key is DPAPI-protected in matching VS Code `Local State`. Targeted decryption succeeded as the signed-in Windows user. | verified-live + statics |
| Location independence | Installation, user-data, profiles and shared-data locations are separate. Discover product metadata/layout; allow explicit custom/portable overrides. Research extension discovery exists; production auth discovery remains M1. | assumed implementation requirement |
| GitHub account | GET `https://api.github.com/user`, GitHub token auth, API version `2022-11-28`: 200. CAPI's `2026-08-01` version on this public endpoint returned 400. Use endpoint-specific versions. | verified-live |
| Token exchange | GET GitHub API origin + `/copilot_internal/v2/token`, `Authorization: token <GitHub-token>`: 200. Response includes token, expires_at, refresh_in, named endpoints. Observed refresh_in=86,340 seconds; do not hardcode this TTL. | verified-live |
| CAPI origin | Returned `endpoints.api` was `https://api.individual.githubcopilot.com`. Always use the returned origin, including after refresh. Other returned origins were not used for telemetry/model calls. | verified-live |
| Enterprise/EMU | Installed resolver derives GitHub API origin as `api.<selected-enterprise-host>`; CAPI comes from token endpoints. No tenant exchange was available. | single-source, extension statics |
| Models | GET `<endpoints.api>/models`: 200, 49 advertised entries with mixed enabled/disabled/legacy/non-picker metadata. Catalog policy alone does not establish generation access. [Sanitized catalog](evidence/MODEL-CATALOG.json). | verified-live |
| Quota | GET GitHub API origin + `/copilot_internal/user`: 200 with plan/quota metadata. Missing fields remain N/A. Initiator labels do not prove premium accounting. | verified-live |

M1 chain: env → gh → existing VS Code → device flow only when none can be reused. Support all requested plans through discovery, without granting unavailable features. Select account/host explicitly when ambiguous. Never forward credentials across arbitrary origins/redirects, log tokens, or clone VS Code machine identifiers merely because a reference does so. macOS/Linux credential backends and restart/30-day behavior remain unverified.

## Free-account Auto handshake

**Verified-live:** direct generation probes for `gpt-6-luna`, `gpt-5.4-mini-free-auto` and `gpt-5.6-luna-free-auto` returned HTTP 400 `model_not_supported`. Actual VS Code revealed an additional handshake:

```http
POST <endpoints.api>/auto
Authorization: Bearer <copilot-token>
Content-Type: application/json

{"prompt":"<current synthetic prompt>","tier":"balance"}
```

Response fields: `session_token`, `selected_model` (metadata), `expires_at`, `multi_turn`, `multi_turn_mode`, `hydra_scores`. Other tiers/internal score semantics were not established. Observed selection: **gpt-6-luna**. Generation includes **`Copilot-Session-Token: <session_token>`**. With this flow, HTTP non-streaming and SSE `/responses` succeeded. Actual VS Code also succeeded over WebSocket `/responses`.

Treat the session token as a credential; honor expiry and associate it with model selection/conversation. Do not log it, store it in metrics, manufacture one or force an unselected model. Expose an explicit Auto option. If an explicit requested model is unavailable, report that clearly instead of silently substituting Auto's selection.

## Headers and initiator

**Verified-live in current VS Code:** Bearer Copilot auth, `Copilot-Integration-Id: vscode-chat`, `Editor-Version: vscode/1.143.1`, `Editor-Plugin-Version: copilot-chat/0.71.0`, `X-GitHub-Api-Version: 2026-08-01`, intent/interaction/request/task/device/machine/session fields. Presence is observed; necessity of every extra field was not exhaustively tested. Background Chat Completions used user-agent GitHubCopilotChat/0.71.0; the WebSocket upgrade used node.

On the same chat, explicit user → automatic tool continuation → explicit follow-up was **user → agent → user**. WebSocket `response.create` carried a JSON `initiator`; its upgrade had no X-Initiator header. Background HTTP calls carried X-Initiator=agent. Successful direct HTTP probes used X-Initiator and the Auto session header.

This contradicts the proposed blanket sticky-agent rule. Under the specified evidence precedence, explicit user turns stay user and tool continuations stay agent; assistant history alone must not relabel later user turns. Native Claude sequence remains unverified. Reference comments about billing are not evidence of actual charges.

Direct image probes included `Copilot-Vision-Request: true` with valid base64 PNG and succeeded. This confirms accepted behavior on the selected model, not universal header necessity. Detect images nested in tool results too and honor model capability.

## Generation and probes

| Feature | Result / requirement | Confidence |
| --- | --- | --- |
| Claude | Native POST `/v1/messages` per reference/source routing; never translate Claude traffic to OpenAI. claude-haiku-4.5 Messages/count_tokens probes returned model_not_supported despite enabled policy metadata. GitHub-bearer variant also failed. | proxy-consensus routing; verified-live rejection |
| Other vendors | Separate adapter chosen from advertised validated endpoints. Current successful path: Auto-selected gpt-6-luna through Responses. Other models are not certified. | verified-live for this path; assumed for others |
| WebSocket | GET `/responses` → 101; client response.create includes model/input/options/initiator. Server response.* events include reasoning/functions and terminal usage. | verified-live |
| HTTP | POST `/responses`, stream=false → response JSON; stream=true → SSE response.* objects. | verified-live |
| Tools | VS Code exposed 23 tools, emitted function_call, submitted function_call_output on agent continuation and completed. Separate HTTP forced-function/result probes succeeded. Only a synthetic workspace fixture was read. | verified-live |
| System | HTTP Responses instructions sentinel prevailed over conflicting synthetic user text. This verifies observed behavior/outgoing body, not invisible backend internals or native Claude behavior. | verified-live, Responses |
| Vision | Valid generated 32×32 base64 PNG accepted. Initial malformed fixture was rejected and corrected. | verified-live, Responses |
| Reasoning | Actual reasoning items and reasoning-token usage arrived. This does not establish Anthropic thinking-signature compatibility. Never fabricate signatures/private reasoning. | verified-live, Responses |
| Usage | Real input/output/cached/reasoning usage supplied. Adapters must preserve distinctions; unknown counts are not fabricated zeros. | verified-live |
| Output limits | Selected gpt-6-luna rejected max_output_tokens=1 with minimum 16. At 16 it returned incomplete with reason=max_output_tokens. Map cutoff to Anthropic max_tokens stop reason. | verified-live |
| Claude clamp | Supplied 100..4096 claim remains unverified. Use model-specific bounds, including thinking constraints; do not apply assumed Claude bounds to other vendors. | assumed pending native access |
| count_tokens | Rejected model does not distinguish unsupported counting from unavailable model access. Probe later with accessible native model; otherwise tagged local estimation. No external Anthropic counting fallback. | support unresolved |
| Anthropic SSE | message_start/content_block_*/message_delta/message_stop/ping, thinking/tool deltas and error events remain M2 implementation/CLI gates. Successful native Anthropic SSE was not captured. | assumed downstream contract |
| Switching/subagents | Actual Claude Code model switching, subagents and cross-vendor history remain implementation/acceptance tests. Do not silently drop vendor-specific history. | assumed gates |

## Context overflow and downstream errors

Selected model advertised max_prompt_tokens=**872,000**. Synthetic input measured by upstream as **900,002** prompt tokens returned HTTP **400**:

```json
{"error":{"message":"prompt token count of 900002 exceeds the limit of 872000","code":"model_max_prompt_tokens_exceeded"}}
```

That is **verified-live**. Map this code and separately verified equivalent overflow codes to:

```json
{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long"}}
```

The target remains an **assumed integration requirement until Claude Code actually compacts and continues through the implemented bridge**. Unit tests alone cannot certify compaction. Do not truncate history at the proxy or confuse input overflow with output cutoff.

Planned mappings: 401 authentication_error; 403 permission_error; 429 rate_limit_error plus Retry-After; eligible transient 5xx api_error/overloaded_error. Sanitize errors. After SSE starts, emit an Anthropic error event instead of a second HTTP response. Bound retries to eligible failures before delivery; never replay exposed generations/tool actions. These service failures were not deliberately induced.

## Pinned reference drift

Exact revisions/file links: [REFERENCE-PINS.json](evidence/REFERENCE-PINS.json). Implementation observations are not runtime guarantees.

| Area | messense d5a1583 | ericc-ch 0ea08fe | puxu-msft c09d5b9 | caozhiyuan 64e38da | Bridge decision |
| --- | --- | --- | --- | --- | --- |
| Origin | token endpoints.api | account-type-derived | override or account-type-derived | configured URL/account/tenant resolver | discovered origin, validated account/host |
| Claude | native branch with body remaps | Messages→Chat Completions | protocol-specific codec pipeline | native Messages sender with optional header/auth rewrite | Claude native only |
| Other models | CC translator | CC translation | Responses/CC/native codecs | multiple protocol routes | separate tested adapters |
| Initiator | history sticky + task markers | assistant/tool history→agent | protocol-specific processing | last user non-tool-result→user | current live user→agent→user wins |
| Slots/models | BIG_MODEL/MIDDLE_MODEL/SMALL_MODEL | --claude-code catalog prompts | endpoint-aware metadata | model mapping/capabilities | exact IDs + explicit Auto |
| Auth/refresh | device flow/disk + background/forced refresh | device flow/disk + refresh_in interval | credential manager consumed by headers | OAuth/account-aware paths | existing login, protected cache, single-flight |
| Header versions | API 2026-01-09, plugin 0.26.7 | API 2025-04-01, plugin 0.26.7 | CAPI 2025-05-01 builder | API 2026-08-01; native identity can replace auth/headers | current capture outranks old constants |
| Auto | missing in tested generation path | not supplied by inspected Messages handler | not established in inspected builder | not established in inspected native sender | current free path needs Auto/session |
| Count tokens | native attempt for Claude/local otherwise | compatibility surface | pipeline; not live-tested | optional external Anthropic or local estimate | Copilot or local estimate only |
| Truncation/limits | body remapping/local estimate | optional interval throttle | current retry stack removed auto-truncate; adaptive 429 recovery remains | native sender logs rate headers | no server history truncation; honor actual limits |
| Betas/subagents | task/header inference | translated tools | protocol processing | beta allowlist + custom marker with agent_type | verify betas; unchanged clients need no custom marker |
| Bind | current entry defaults 127.0.0.1 | host not explicit in inspected start | configurable | local endpoint documented | explicit loopback only |

The pinned messense listener supersedes the older cached web view showing 0.0.0.0; no bind patch was needed. Dynamic capture verified token/model calls (200), native Claude and direct gpt-6-luna generation rejections (400). It omitted Auto selection/session context and the client's anthropic-version header, and used older API/plugin versions. This comparison does not prove successful Claude generation.

## Remaining gates

- Accessible native Claude model/account path for successful Messages, thinking, system, vision, limits and counting verification.
- Separate paid individual, business and enterprise/EMU account captures.
- Auth/proxy/dashboard/packaging are implemented; Windows restart and cached-login reuse passed. Refresh/revocation and a wall-clock 30+ day soak remain open.
- Real Claude Code Auto chat/tools/subagents/usage and custom-ID selection passed. Compaction recovery passed with an injected captured error; genuinely oversized CLI-context acceptance remains open. See milestone evidence for limits.

Additional startup requirement: first-run CLI must use the local provider without Anthropic auth setup. Startup helpers and a local-stub interactive experiment on Claude Code 2.1.269 are recorded in [CLAUDE-FIRST-RUN.md](evidence/CLAUDE-FIRST-RUN.md); real-bridge integration and egress verification remain pending. Reused source components and licenses are tracked in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Implementation update: real-bridge first-run and interactive usage now passed; complete egress verification remains open. Native auto-mode Bash and Agent classification also passed following a local Responses `stop_sequences` compatibility fix; [diagnosis and live results](evidence/AUTO-MODE-CLASSIFIER.md) distinguish this bridge bug from a provider outage. Responses stop matching is local and drains to actual upstream usage, so generated tokens after the match can still count. Current priority is Windows/Free/Auto; native Claude and other operating systems are deferred by the user.
