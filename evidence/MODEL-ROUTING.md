# Model routing requirements

User addition, 2026-10-23: Claude Code must also be able to select non-Anthropic models offered by the authenticated GitHub Copilot account. This is planned M2 scope; no adapter is currently implemented.

Live discovery update: the current free account succeeds with an Auto handshake (`POST /auto`, tier balance) followed by `Copilot-Session-Token` on the selected gpt-6-luna Responses request. Direct tested model IDs were rejected despite catalog metadata. Implement explicit Auto selection and session expiry/conversation handling; do not treat all catalog entries or enabled policy flags as selectable. Do not silently change an explicit model request to Auto. Current live initiator sequence is user → agent tool continuation → user follow-up; history alone does not make later user requests agent-initiated.

## Selection

- Discover enabled model IDs, policy, capabilities, supported endpoints and limits from the account's model catalog; do not assume a model is available because it appears in source or documentation.
- Allow supported exact IDs through Claude Code model selection and configurable default/sonnet/opus/haiku slots, regardless of vendor. Show the actual resolved upstream model and adapter in dashboard settings/status.
- Preserve the selected upstream model. No silent vendor substitution when a model is unavailable or an endpoint fails.
- Individual free/paid, business and enterprise use the same discovery mechanism; each may expose different models or features.

## Routing boundary

| Selected model | Upstream path | Requirement |
| --- | --- | --- |
| Claude | Native `/v1/messages` | Preserve Anthropic request/response semantics; never translate to OpenAI format |
| Non-Anthropic advertising native Messages | Native Messages, once validated | Preserve native wire semantics |
| Non-Anthropic advertising Responses | Dedicated Responses adapter | Translate Messages and tools to advertised Responses schema and back |
| Non-Anthropic advertising Chat Completions | Dedicated Chat Completions adapter | Translate Messages and tools to advertised chat schema and back |
| No supported validated endpoint | Unavailable with an actionable error | Do not guess an endpoint or silently change models |

Every route uses the discovered Copilot origin, account credentials and observed upstream headers. Every downstream route presents Anthropic Messages JSON/SSE and error envelopes to Claude Code. Internal protocol choice does not change Claude Code hooks, tools, MCP or local storage.

Model identification must use vendor/family/capability metadata and validated IDs rather than loose substring matching. If catalog metadata is incomplete, require explicit validated routing configuration. Catalog capability does not itself prove compatibility with Claude Code.

## Adapter behavior and gates

- System messages, multi-turn text, stop sequences, model-specific output limits, images when supported, tool schemas, tool call IDs and tool_result linkage must round-trip correctly.
- Streaming must reconstruct Anthropic content blocks and fragmented tool JSON across arbitrary upstream chunk boundaries, including parallel tool calls. Stop reasons must distinguish end_turn, tool_use and max_tokens. Client disconnect cancels upstream generation.
- Forward real usage where available. Preserve distinctions between billed input, output, cached and reasoning tokens; never invent zero counts for unknown values. Define and test vendor-specific usage mapping before enabling an adapter for Claude Code tracking.
- Reasoning/thinking formats vary by model. Map only semantics the upstream actually provides. Preserve opaque Claude thinking/signatures on the native Claude route; do not fabricate Anthropic signatures or private chain-of-thought for another model. Unsupported requested features return a clear Anthropic error rather than being silently dropped.
- Switching vendor mid-conversation must handle prior tool turns and vendor-specific content explicitly. Do not forward another vendor's opaque thinking signatures. A switch that cannot preserve valid history must fail clearly until a compatible conversion is implemented and tested.
- Context overflow from every adapter must map to the Claude Code compaction-triggering error. Never truncate messages at the proxy. Verify compaction and continuation end to end for each enabled adapter.
- Model-specific context/output limits govern requests. The provisional Claude 100..4096 observation is not a universal limit for other models.
- Count tokens uses a supported upstream endpoint or a tagged local estimate for the resolved model. Quota displays observed account data; premium-request estimates are labeled and never inferred solely from initiator headers.

Before claiming an adapter supports Claude Code, verify synthetic unit/integration cases and actual CLI multi-turn streaming, Bash/Edit/Read tools, subagents, model switching, usage, oversized-context compaction and errors. Reasoning/vision support is conditional on model capability; identical model behavior across vendors is not a promise that protocol translation can make.
