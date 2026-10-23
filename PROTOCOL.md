# GHCP → Claude bridge protocol evidence

Research date: 2026-10-23. **M0 incomplete: static findings available; live contract not verified.** Do not use this document to claim Claude Code acceptance, account entitlement, or successful 30-day refresh. No implementation milestones have been completed.

## Scope and evidence rules

Support individual free, individual paid, business, and enterprise accounts. Discover endpoints and model capabilities for the authenticated account. Supporting a plan cannot grant models/features that GitHub does not entitle it to. User scope addition: support non-Anthropic Copilot models in Claude Code through explicit protocol adapters. Claude model requests remain native Messages only. An account without Claude access may select its enabled non-Anthropic models once their adapters pass validation; never silently replace a selected model. See [routing requirements](evidence/MODEL-ROUTING.md).

Confidence labels:

- **verified-live**: observed on this user's actual account, with dated local evidence.
- **proxy-consensus**: matching behavior in multiple inspected proxies; shared ancestry reduces independence.
- **single-source**: one inspected source, including extension statics (marked explicitly).
- **assumed**: requested design rule or unverified hypothesis, not an observed service fact.

Conflict priority: live VS Code capture > local proxy dynamic capture > proxy consensus > extension static analysis > a single proxy. Source timestamps/crawls vary; current branch URLs below are unpinned and may drift. Immutable clones/revisions are still required before declaring the reference audit complete.

Environment evidence: [ENVIRONMENT.md](evidence/ENVIRONMENT.md). Local extension identity/hash/offsets: [EXTENSION-STATIC.md](evidence/EXTENSION-STATIC.md). Capture procedure: [M0-RUNBOOK.md](evidence/M0-RUNBOOK.md).

## Contract ledger

| Item | Current finding / required bridge behavior | Confidence |
| --- | --- | --- |
| GitHub credential source | User authenticated through VS Code. No GH_TOKEN/GITHUB_TOKEN or gh login available in this process. VS Code auth storage key names exist; session validity unknown. Implement env → gh → VS Code → device flow. | assumed (provider design); local preflight observations |
| Token exchange | GET GitHub API origin + `/copilot_internal/v2/token`, GitHub credential in `Authorization: token …`. | proxy-consensus [S1,S5]; extension static E1 |
| Response shape | Token response includes a named `endpoints` object/map; use `endpoints.api`, not a plan-derived hostname. `token`, `refresh_in`, and/or `expires_at` drive lifecycle; validate actual response fields live. | single-source [S1]; corroborated by extension E1 |
| EMU/API host | Extension derives `https://api.<enterprise-host>` from selected enterprise authorization server URL. Do not send a github.com credential to an inferred unrelated tenant. No tenant/live exchange verified. | single-source (extension static E1) |
| Host selection | Re-discover on refresh. Require HTTPS and validate origin; reject redirects carrying credentials to another origin. No `api.individual.githubcopilot.com` default. | assumed design; discovery source above |
| Upstream model calls | Claude models use native POST `<endpoints.api>/v1/messages`. Require advertised native Messages capability. No OpenAI translation fallback. | proxy-consensus [S3,S8]; extension static E1 |
| Non-Anthropic model calls | Additional user requirement: map Claude Code's Messages requests to each enabled model's advertised protocol through a separate adapter. Prefer native Messages if advertised and validated; otherwise implement Responses or Chat Completions adapters as needed. Capability gaps must be explicit; no Claude traffic enters these adapters. | assumed implementation requirement; not validated |
| Extension location | Discover standard, bundled, portable and custom extension/application layouts using manifest identity. Explicit path overrides cover installations outside known locations. Authentication user-data/profile location is separate. | implemented research discovery; M1 auth discovery pending |
| Required header candidates | Bearer Copilot token, Copilot-Integration-Id, Editor-Version, Editor-Plugin-Version; JSON Content-Type. Production authenticated reference branch uses `vscode-chat`. Header necessity and signed-in free-plan values need live confirmation. | proxy-consensus [S2,S4]; extension static E1 |
| Additional header drift | User-Agent, GitHub API version, OpenAI intent, request/interaction/device/session fields vary. Extension statics show API version 2026-08-01; proxies contain older values. Do not blindly copy old constants or local VS Code identifiers. | single-source per value; see drift matrix |
| Initiator | References disagree: whole-history sticky inference versus last-message/tool-result inference. User requested sticky per conversation, but equivalence to VS Code sequence is unverified. Never derive premium-charge claims from this header. | assumed sticky requirement; conflicting single-source [S9,S8] |
| Vision | Conditional vision header; inspect images nested in tool_result as well as direct message content. Preserve image source blocks. | proxy-consensus header [S2,S4]; nested detection single-source [S8] |
| Model catalog | GET `<endpoints.api>/models`; model IDs/capabilities/policy and supported_endpoints determine mapping and availability. | proxy-consensus [S2,S6]; extension static E1 |
| This account's models | **Unknown. No authenticated catalog fetched.** No default model or slot mapping selected. | assumed / unresolved |
| System prompt | Native reference sender serializes payload, but preprocessing elsewhere and upstream service rewriting remain unverified. Arbitrary system prompt passthrough cannot yet be claimed. | single-source [S8] for sender only |
| SSE | Native reference uses upstream streaming. Required downstream Anthropic event families: message_start, content_block_start/delta/stop, message_delta, message_stop, ping; preserve thinking/tool JSON deltas and usage. Actual wire order/chunk boundaries/stop reasons not captured. | assumed downstream contract; single-source native transport [S2,S8] |
| Usage/request IDs | Preserve actual input/output/cache usage, terminal stop_reason and request IDs. Do not invent usage or turn a disconnected stream into successful message_stop. | assumed implementation rule |
| max_tokens | User supplied 100..4096 observation is **not re-verified**. Extension uses model max_output_tokens with a 4096 fallback. Treat 100..4096 as provisional configurable bounds pending probes; account/model-specific bounds and thinking budget constraints must be tested. | assumed clamp; single-source extension static E1 |
| count_tokens | Messense attempts native upstream count; caozhiyuan uses optional direct Anthropic counting or local estimation. This is not evidence Copilot supports it. Probe Copilot first, otherwise return local estimate tagged via response header/dashboard. No direct Anthropic fallback. | conflicting single-source [S3,S10] |
| Quota | Candidate GET GitHub API origin + `/copilot_internal/user` using GitHub token. Candidate fields include plan, quota_snapshots and reset date. User account endpoint/fields not probed. Missing data displays N/A. | proxy-consensus [S2,S7]; extension static E1 |
| Account/org | `/user` can identify account; do not infer enterprise membership from a company string. Validate org/seat metadata separately. | assumed; not probed |
| Context overflow | Required bridge output: HTTP 400 with `{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long"}}`. Need actual Copilot errors AND an oversized-context Claude Code integration test proving auto-compaction. No proxy-side history truncation. | assumed target behavior; critical acceptance gate |
| Other errors | Anthropic error envelope; 401 authentication_error, 403 permission_error, 429 rate_limit_error, transient 5xx api_error/overloaded_error as appropriate. Respect Retry-After; sanitize upstream messages. Once SSE starts, use Anthropic error events rather than a second HTTP response. | assumed downstream design |
| Retries | Bounded transient 5xx retries before response bytes; no replay of partially delivered generation. 429 goes back to client with Retry-After. Token refresh uses single-flight and never logs tokens. | assumed design |
| Persistence | Persist only local redacted metrics in SQLite WAL; tokens in OS keychain, restrictive fallback. Refresh/revocation recovery and 30+ days require simulation plus actual soak evidence; longevity is not guaranteed by an interval timer. | assumed design |

## Reference drift matrix (partial static inspection)

| Area | messense | ericc-ch | puxu-msft | caozhiyuan | Bridge decision |
| --- | --- | --- | --- | --- | --- |
| Origin | token endpoints.api [S1] | plan-derived [S4] | override or plan-derived [S11] | sender delegates origin [S8]; resolver not audited | discovered endpoint only |
| Native Messages | native Claude branch, translation for others [S3] | inspected handler translates to chat completions [S12] | not established | native sender [S8] | Claude native only; other models use validated adapters |
| Initiator | history inference [S9]; current callers may add metadata | full sequence not audited | not established | last user content vs tool result [S8] | capture first; provisional sticky design |
| Refresh | background + forced refresh [S1] | refresh_in interval, disk GitHub token [S13] | not audited | not audited | account-aware single-flight, expiry guard |
| Output adaptation | model aliases, thinking→adaptive rewrites [S3] | translation [S12] | not audited | beta allowlist [S8] | verify per model; avoid unconditional rewrites |
| Count tokens | native attempt for Claude [S3] | not audited | not audited | external Anthropic or estimate [S10] | Copilot or local estimate |
| Rate handling | no full audit | handler calls limiter [S12] | reactive 429 queue/backoff/recovery [S14] | response headers logged [S8] | honor upstream; bounded retries |
| Truncation | not audited | not audited | auto-truncate directory present; algorithm/proactive paths not inspected | not audited | no server history truncation |
| Subagents | not audited | not audited | not audited | custom marker type [S15], sender options [S8] | preserve client metadata; verify protocol |
| Listener | 0.0.0.0 in inspected entry point [S16] | host not explicit in inspected start [S17] | configurable host documented [S18] | localhost documented [S19] | force 127.0.0.1 |

E1 denotes the locally hashed extension above. These are implementation observations, not endorsements or successful runtime tests. In particular, source comments about billing do not establish actual premium request accounting.

## Live completion gates

- REA setup and MCP invocation against the actual installed bundle; repeat static findings with recorded tool output.
- Obtain valid existing VS Code session without displaying secrets; capture token exchange and authenticated models/quota requests locally.
- Capture VS Code synthetic user turn → tool continuation → follow-up user turn; thinking, image and model-switch examples. Determine initiator sequence.
- Pin all reference revisions, finish uninspected matrix cells, patch reference listener to loopback, capture its upstream requests and diff against VS Code.
- Probe token bounds, native count_tokens, system sentinel preservation, context-limit error and SSE interruption behavior. Do not promote source evidence to verified-live.
- Test individual free, individual paid and enterprise separately. Current personal account is the first intended live test, not evidence for the other plans.
- Inspect supported endpoints and tool/vision/reasoning capabilities of enabled non-Anthropic models; capture their native wire contracts before implementing adapters. Adapter acceptance includes tool continuations, switching, streaming usage and auto-compaction.

## Sources

All remote sources inspected through web tools on the research date; unpinned branch content may change.

- S1: [messense auth.rs](https://raw.githubusercontent.com/messense/copilot-api-proxy/main/src/auth.rs)
- S2: [messense proxy.rs](https://raw.githubusercontent.com/messense/copilot-api-proxy/main/src/proxy.rs)
- S3: [messense llm.rs](https://raw.githubusercontent.com/messense/copilot-api-proxy/main/src/llm.rs)
- S4: [ericc-ch api-config.ts](https://raw.githubusercontent.com/ericc-ch/copilot-api/master/src/lib/api-config.ts)
- S5: [ericc-ch get-copilot-token.ts](https://raw.githubusercontent.com/ericc-ch/copilot-api/master/src/services/github/get-copilot-token.ts)
- S6: [ericc-ch get-models.ts](https://raw.githubusercontent.com/ericc-ch/copilot-api/master/src/services/copilot/get-models.ts)
- S7: [ericc-ch get-copilot-usage.ts](https://raw.githubusercontent.com/ericc-ch/copilot-api/master/src/services/github/get-copilot-usage.ts)
- S8: [caozhiyuan create-messages.ts](https://raw.githubusercontent.com/caozhiyuan/copilot-api/dev/src/services/copilot/create-messages.ts)
- S9: [messense initiator.rs](https://raw.githubusercontent.com/messense/copilot-api-proxy/main/src/initiator.rs)
- S10: [caozhiyuan count-tokens-handler.ts](https://raw.githubusercontent.com/caozhiyuan/copilot-api/dev/src/routes/messages/count-tokens-handler.ts)
- S11: [puxu-msft copilot-api.ts](https://raw.githubusercontent.com/puxu-msft/copilot-api-js/master/src/lib/copilot-api.ts)
- S12: [ericc-ch Messages handler](https://raw.githubusercontent.com/ericc-ch/copilot-api/master/src/routes/messages/handler.ts)
- S13: [ericc-ch token.ts](https://raw.githubusercontent.com/ericc-ch/copilot-api/master/src/lib/token.ts)
- S14: [puxu-msft adaptive-rate-limiter.ts](https://raw.githubusercontent.com/puxu-msft/copilot-api-js/master/src/lib/adaptive-rate-limiter.ts)
- S15: [caozhiyuan subagent.ts](https://raw.githubusercontent.com/caozhiyuan/copilot-api/dev/src/lib/subagent.ts)
- S16: [messense main.rs](https://raw.githubusercontent.com/messense/copilot-api-proxy/main/src/main.rs)
- S17: [ericc-ch start.ts](https://raw.githubusercontent.com/ericc-ch/copilot-api/master/src/start.ts)
- S18: [puxu-msft README](https://raw.githubusercontent.com/puxu-msft/copilot-api-js/master/README.md)
- S19: [caozhiyuan README](https://raw.githubusercontent.com/caozhiyuan/copilot-api/main/README.md)
- REA: [official installation and CLI instructions](https://github.com/morluto/rea)
