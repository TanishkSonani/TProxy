# M2 proxy checkpoint — 2026-10-23

Implemented a single-process Bun server bound to 127.0.0.1, bearer-key protection, authenticated management routes, native Messages routing, separate Responses and Chat Completions adapters, Auto session selection/cache, JSON/SSE output, tool linkage, opaque reasoning replay within the same adapter/model, conditional vision headers, request IDs, local token-count estimates, native counting attempts, output clamps, sanitized errors, bounded pre-delivery retries, cancellation and heartbeat pings.

CLI source commands exist: start, stop, status, auth, env and claude, with port/config/data-directory options. The Claude launcher uses the existing executable and normal local storage unless an isolated test directory is explicitly supplied. Its temporary/provider settings take precedence over ordinary user/project provider env settings. No native executable patch, --bare or global permission bypass is used.

## Live results

- Existing VS Code auth and protected cache started the service on 127.0.0.1:4141.
- Real Claude Code 2.1.269 completed a streamed prompt through Copilot Auto and returned BRIDGE_LIVE_READY. Input/output/cache token usage appeared in the CLI's JSON result.
- A four-turn test used Read, Edit and Bash in an isolated workspace and returned BRIDGE_TOOLS_READY. The fixture was independently checked on disk: BRIDGE_BEFORE became BRIDGE_AFTER.
- A foreground general-purpose subagent completed successfully; native CLI stats recorded one spawned/completed subagent and no failures.
- A resumed session received **one injected copy of the real captured overflow error**, then used real Copilot for subsequent calls. Claude Code compacted automatically and continued with BRIDGE_AFTER_COMPACTION. Its JSONL recorded an automatic compact_boundary: 14,141 pre-tokens → 4,121 post-tokens. This tests recovery through the bridge, not a claim that the CLI sent a 900k-token live conversation. The separate M0 oversized service probe established the real error code.

## Limits and remaining acceptance

Native Claude forwarding is covered by mock integration tests for tools, thinking signatures, images, beta/version headers and clamps; this account still rejects tested native Claude generation. Chat Completions adapter coverage is synthetic, not a successful Gemini/other-account live test. Cross-vendor opaque thinking history cannot be replayed and is rejected explicitly. Advanced server tools, cross-vendor /model switching, interactive /usage behavior and a process-level no-Anthropic-egress audit still need validation.

Claude Code treats the custom Auto ID as an unknown model and currently uses its safe 200k client window, while the selected upstream may support more. Its dollar figures are built-in estimates with unknown cost basis, **not observed Copilot charges**. The bridge will expose actual account quota separately; it must not invent premium billing.

Startup/proxy/auth checks work from source; compiled distribution and dashboard are separate milestones. Mock/unit tests do not replace the remaining live acceptance gates. Thirty-day refresh coverage is simulation, not a completed wall-clock soak.
