# Claude Code auto-mode classifier compatibility — 2026-10-23

## Root cause

The imported Claude session named `codex-session-01a167fa-b1b5-7fa1-9c71-94c7b2c1934a transcript` maps to native session `25c77e95-a255-46c5-8bc1-2f70048acf46`. Its private auto-mode diagnostic records:

```text
400 {"type":"error","error":{"type":"invalid_request_error","message":"Selected Responses model does not expose stop sequences"}}
timestamp: 2026-10-23T12:21:19.534Z
model: copilot-auto
action: Bash / bun run typecheck
```

This exact error was raised locally by `toResponses` whenever a request contained a nonempty `stop_sequences` array. Normal chat could succeed while Claude Code's auto-mode classification requests failed. The native CLI presented the failure as a temporarily unavailable classifier and held the tools back before execution. The earlier conversation's attribution to an unspecified upstream outage was incomplete: the captured failure is a bridge compatibility bug, not evidence of Copilot rejecting the action or an additional Copilot tool guardrail.

## Fix

Responses generation accepts these requests and the bridge enforces stop sequences on returned visible text. JSON and SSE omit the matched delimiter and subsequent content, returning Anthropic `stop_reason: "stop_sequence"` and the exact `stop_sequence`. Streaming retains possible delimiter prefixes across deltas, including Unicode, and suppresses later tool blocks after a match. Thinking signatures and tool arguments are not text-stop filtered. Native Claude forwarding is unchanged.

The stream continues draining to real provider completion to preserve authoritative token usage. This can consume tokens generated after the local stop; it is not an upstream generation/billing stop. Truncated/failed provider output remains an error even if visible text matched a stop. No synthetic allow verdict, permission override, safety-check removal, classifier model substitution or harness patch is introduced. This implements the [documented Messages stop semantics](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons).

## Live verification

The user explicitly authorized stopping/restarting the proxy for validation. The Windows executable was rebuilt, restarted on loopback port 4141, and reused the existing VS Code login and local SQLite history.

- Native session `816b7049-ca92-41fe-a91d-13bcfb1dc51a`, `--permission-mode auto`, no allowed-tools override: a disposable `bun run typecheck` fixture triggered `classifier_request_started` for Bash. It finished `outcome=ok` in 11,325 ms, permission decision `allow`, then the command executed and the session returned `BRIDGE_AUTO_CLASSIFIED`.
- Native session `9ee9c13f-bf83-4df4-b629-541abbd3533f`, same permissions: Agent launch classification finished `outcome=ok` in 8,023 ms. The foreground general-purpose subagent read a synthetic fixture and completed. Its hand-back was separately classified successfully in 4,861 ms. Result: `BRIDGE_AGENT_CLASSIFIED`, one spawned/completed subagent, no permission denials.
- A preceding Bash/Read test succeeded but skipped classification under Claude's existing acceptEdits rule. It is not counted as classifier proof.
- `bun scripts/check-stop-sequences.ts` sent synthetic prompts through real Copilot Auto in JSON and SSE modes. Both returned exactly `BEFORE_BRIDGE`, `stop_reason: stop_sequence`, matching `|END_BRIDGE|`, and real provider usage (57/55 output tokens respectively).
- Forty Bun tests pass, including seven new regression tests; TypeScript checking and three Python redaction checks pass. Existing UI edits also typecheck and are included in the rebuilt executable.

Raw classifier prompts, native debug logs and test profiles remain local and ignored. Only the sanitized results are recorded here.

## Scope

The captured stop-sequence failure is fixed and regression-covered. This does not guarantee uninterrupted classification: auth revocation, exhausted quota, provider/network outages, context errors or future CLI protocol changes can still prevent a decision. Such failures must remain fail-closed. If classification fails again, inspect the native classifier diagnostic and timestamp before attributing it to an upstream outage.

Current priority is Windows + Copilot Free + Auto. The user deferred native Claude entitlement and macOS/Linux acceptance. Remaining Windows work includes full process-level egress verification, managed-settings conflict handling, genuine oversized-context recovery, visual browser QA and a wall-clock refresh soak.
