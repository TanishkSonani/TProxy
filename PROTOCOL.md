# TProxy protocol notes

Research baseline: 2026-10-23. These are observations of unsupported APIs, not a stable provider specification. Historical machine-specific captures and milestone reports are excluded from the public source tree.

Confidence labels: **verified-live** means observed traffic; **proxy-consensus** means matching reference implementations; **single-source** means one inspected implementation; **assumed** means unverified. Evidence precedence is live VS Code capture, reference-proxy dynamic capture, proxy consensus, extension statics, then single-source reference.

## Authentication and origins

| Contract | Confidence |
| --- | --- |
| Exchange a GitHub credential at the selected GitHub API origin's `GET /copilot_internal/v2/token` using `Authorization: token <credential>`. | verified-live |
| Use the returned `endpoints.api` origin and expiry/refresh metadata, including after refresh. Never select the upstream from a hardcoded account type. | verified-live on individual |
| `GET /copilot_internal/user` supplies account/quota metadata; absent fields remain unavailable. | verified-live |
| Enterprise host derivation and organizational endpoints need account-specific validation. | single-source / not live-tested |
| `GET <Copilot origin>/models` supplies catalog, capability and context metadata; advertisement alone does not establish entitlement. | verified-live |

Credential/origin validation, redirect refusal, token redaction and protected local storage are implemented. See source and tests for exact validation rules.

## Free-account Auto

**Verified-live:** direct generation with an advertised model ID can fail on a Free account even when Auto can select it.

1. `POST /auto` with `{"prompt":"...","tier":"balance"}`.
2. Validate returned `selected_model`, `session_token` and `expires_at`.
3. Send generation to the selected model using `Copilot-Session-Token`.

Auto session tokens are credentials. Associate selection with the conversation, respect expiry and never force a different model under the token. Future selections can change models.

## Request headers

Observed HTTP headers include `Authorization: Bearer <Copilot token>`, `Copilot-Integration-Id: vscode-chat`, `Editor-Version`, `Editor-Plugin-Version`, `X-GitHub-Api-Version` and `X-Initiator`.

The observed extension baseline was VS Code 1.143.1 / Copilot Chat 0.71.0. Presence does not prove every extension header is required.

**Verified-live:** explicit user turn, automatic tool continuation, explicit follow-up produced **user, agent, user**. Assistant history alone does not justify sticky agent labeling. Native Claude sequences remain unverified.

Image requests include `Copilot-Vision-Request: true`; a valid base64 image succeeded on the tested Auto model. Other model capabilities vary.

## Generation

| Model path | Behavior and evidence |
| --- | --- |
| Claude | Native `POST /v1/messages` passthrough. Routing supported by proxy consensus; the tested Free account rejected native Claude access. No live native-Claude success is claimed. |
| Responses | HTTP non-streaming and SSE verified with Auto, including function calls/results, reasoning items, vision and usage. |
| Chat Completions | Separate adapter with regression coverage; not certified across every account/model. |
| Count tokens | Forward when supported, otherwise return a labeled local estimate. Native support remains unresolved on the tested account. |

The downstream Messages contract uses Anthropic-shaped messages, tool/thinking blocks, usage, stop reasons and SSE events. Provider-specific reasoning cannot be assumed portable across vendors. Unknown executable tool arguments are rejected rather than repaired.

The selected model's minimum output budget differed from proposed universal Claude clamps. TProxy uses model-specific bounds; the proposed fixed 100–4096 Claude range was not verified live.

## Context, errors and retries

**Verified-live:** input above the selected model's advertised prompt limit returned HTTP 400 with code `model_max_prompt_tokens_exceeded`. Equivalent recognized context errors map to:

```json
{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long"}}
```

This preserves Claude's native compaction trigger. Captured-error injection recovery was tested; a genuinely oversized live Claude session remains unverified. No proxy history truncation or token-count multiplier is used.

Authentication, permission, rate-limit and service failures use sanitized Anthropic error shapes. Retry-After is preserved where supplied. Bounded retries apply before delivery; an exposed stream is not replayed. SSE failures emit error events, never a second HTTP response. Missing terminal events and malformed tool JSON fail explicitly.

## Reference provenance

Pinned revisions and inspected file hashes are retained in [third_party/references.json](third_party/references.json). Reused code and license notices are documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Protocol observations can drift; [known limitations](docs/LIMITATIONS.md) describes the current acceptance boundary.
