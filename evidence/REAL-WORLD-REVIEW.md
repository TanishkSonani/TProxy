# Real-world hardening review — 2026-10-23

Scope: Windows, existing VS Code sign-in, Copilot Free/Auto and the installed unmodified Claude Code 2.1.269. Other plan/OS capabilities remain supported by design where implemented, not asserted as live-tested. This is a risk-driven review, not a guarantee that every possible provider or client change is covered.

## Reference repositories: findings and response

Comparisons below concern the pinned revisions in [REFERENCE-PINS.json](REFERENCE-PINS.json), not every future version. Reference code also contains useful protections; differences are not blanket claims that the projects are defective.

| Reference evidence | Consequence for this bridge |
| --- | --- |
| [messense auth.rs](https://github.com/messense/copilot-api-proxy/blob/d5a1583a2b8f71ba0bb466c0d3720d83a468896d/src/auth.rs) discovers endpoints but falls back to the individual host when the API endpoint is absent | Require a validated returned HTTPS origin. Missing/foreign endpoints fail closed rather than forwarding corporate credentials to a guessed host. |
| [ericc api-config.ts](https://github.com/ericc-ch/copilot-api/blob/0ea08febdd7e3e055b03dd298bf57e669500b5c1/src/lib/api-config.ts) derives hosts from account type and uses older header constants; its Messages handler translates through Chat Completions | Discover origins and live account models. Claude uses native Messages; Responses/Chat are separate adapters for other models. Header constants remain pinned to our captured extension version and need future drift checks. |
| ericc's pinned Messages handler logs full request/translated JSON at debug level | Do not import payload logging. Redact request content before SQLite insertion, including arbitrary keys and structured tool input. |
| [cao count-tokens-handler.ts](https://github.com/caozhiyuan/copilot-api/blob/64e38da1eb79eeda6c8b660d585754c0c8f5dc00/src/routes/messages/count-tokens-handler.ts) can call Anthropic counting when an Anthropic key is configured | Never send prompts to Anthropic for counting. Use Copilot or explicitly tagged local estimates. |
| cao's pinned Responses mapper imposes a 12,800-token minimum | Preserve the requested output budget, within actual model limits, rather than importing that minimum. |
| puxu's pinned Responses handler checks terminal stream events and documents a narrower truncated-Chat-under-fallback gap | Keep terminal-event checks in every adapter. A missing terminator or invalid tool JSON fails; do not manufacture successful completion or repair an executable tool call. |
| messense also supports external Amp/Factory management forwarding; this product needs neither | Only explicit bridge/Copilot routes are implemented. Unknown management paths return errors; no generic third-party management fallback. |
| Reference startup paths did not establish our account's Free Auto handshake | Keep live-tested `/auto` session selection, discovery and existing-login reuse; catalog advertisement alone is not proof of entitlement. |

[ericc issue #233](https://github.com/ericc-ch/copilot-api/issues/233) reports maintenance concerns and points users to a fork. It is a reporter's warning, not proof that every current original/fork behavior is broken. Source comparison and our live captures take precedence over general issue claims.

## Fixes from this review

| Area | Previously uncovered case | Current behavior / evidence |
| --- | --- | --- |
| Token cache | Expired token with a future refresh timestamp | Validate actual expiry and timestamp ordering; refresh before use. Auth regression test. |
| Token exchange | Valid `expires_at` without `refresh_in` | Derive a safe refresh margin. Auth regression test. |
| Revocation | Refresh rejected while the old Copilot token is nominally unexpired | Clear the token and return an auth/permission error; do not fall back to revoked credentials. Auth regression test. |
| Enterprise credential size | Token cache exceeds Windows vault's 5,120-byte limit | CurrentUser-DPAPI encrypted-file fallback; synthetic oversized record round-trip tested on this Windows host. |
| Concurrent cold startup | Two processes issue different API keys for the same profile | Serialize key initialization with a profile lock, recover dead owners, release on failure. Regression test. |
| Configuration | Wrong scalar/path/model types; partial config writes; ignored missing CLI values | Validate types/options, honor explicit data-dir, and atomically replace JSON. Regression and CLI checks. |
| Claude settings | Local managed env or extra CLI settings redirect outside the bridge | Inspect system files/drop-ins and Windows registry, reject routing conflicts before onboarding/launch, never modify policy or expose secret values in errors. Helper-computed policies require administrator verification. |
| Failed Claude setup | An owned proxy survives missing CLI or launch-preparation failure | A finally block stops owned resources on every launch exit; externally running proxies remain owned by their process. |
| Dashboard access | Anonymous root request obtains a privileged cookie | Root is static/public only. A private fragment link or proxy key must authorize the cookie handshake. Host/Origin checks remain. Tests verify anonymous management denial, including when model-key enforcement is disabled. |
| Input validation | Null messages/blocks, invalid tools or boolean strings become server failures | Return Anthropic 400 errors before any generation. Bounded JSON bodies for management too. |
| Auto metadata | Partial Auto model descriptor omits protocol/capability fields | Hydrate missing fields from the discovered model catalog. Reject empty/expired session descriptors. Regression test. |
| Context races | A concurrent fixed-model discovery prevents an Auto lookup | Recheck the pending discovery's result and resolve Auto when the waiting caller needs it. |
| Retry/auth | A transient 5xx consumes the only opportunity to refresh on subsequent 401 | One auth refresh can occur after an earlier 5xx; total attempts stay bounded. 429/redirect/client errors are not replayed. |
| Streaming | CR-only records; oversized event fits into one complete chunk; cancellation during an outstanding pull | Parse all SSE newline forms, bound complete and partial events, abort promptly without a late enqueue into a cancelled stream. Regression tests. |
| Native stream terminal | Provider keeps the transport open after message_stop | Stop consuming at the terminal event rather than waiting indefinitely. |
| Provider errors | Native SSE rate-limit/overload error types lose their status | Preserve Anthropic error semantics with sanitized messages. HTTP/metrics errors agree. |
| Tool arguments | Malformed final JSON is passed on as a successful tool call | Fail instead of inventing/reconstructing executable arguments. Responses and Chat regressions. |
| Metrics privacy | Dynamic object keys or numeric tool parameters expose content | Redact unknown keys, opaque tool/schema/metadata objects and non-protocol numbers. Bound recursion. Applies to new records; historical records are not rewritten. |

Earlier fixes remain covered: stop sequences for the native safety classifier (Bash, Agent and hand-back verified live), truthful provider usage, metadata-driven context budgets, exact prompt-too-long mapping, local-origin binding, preserved native Claude forwarding, restart persistence and no third-party dashboard resources.

## Verification and limits

Unit/integration tests are in `tests/hardening.test.ts`, `auth.test.ts`, `dashboard.test.ts` and the existing protocol suite. Each test uses synthetic prompts/credentials except the Windows DPAPI round-trip, which encrypts a synthetic string under the current user. Private capture/test logs are not committed. Final build/live results are appended after validation.

Final validation: **62 Bun tests / 374 assertions passed**, TypeScript checking passed, and all three Python redaction checks passed. The Windows executable rebuilt and restarted on 127.0.0.1:4141 with the existing VS Code login and SQLite history. The HTTP dashboard probe confirmed public assets, no anonymous session cookie, authenticated HttpOnly session bootstrap and management denial without credentials. There were 143 historical requests before the final tool test, demonstrating history retention across this restart.

Native live session `b613ade0-3e51-4d5c-8525-9d1b1102ba81` then returned `BRIDGE_HARDENING_VERIFIED`. Its debug log records a real Bash auto-mode classifier request finishing `outcome=ok` in 17,655 ms, an `allow` permission decision, and successful tool execution. No permission bypass/allowed-tools override was used. Its reported context window remained metadata-driven at 872,000 tokens. Classifier latency is still an upstream cost, not eliminated by this compatibility fix.

The optional `scripts/check-compaction.ts --live-overflow` probe was attempted on an isolated port using synthetic padding. It did not establish real context-rejection recovery: the target probe returned HTTP 200 rather than the required context-limit error, so no new compaction boundary is claimed. Only the fixture's own probe process was stopped. Synthetic repetition is not an authoritative token count and the probe can consume provider quota. Its failure mode now uses a non-retryable 400 instead of letting the native client repeatedly retry a fixture failure. Production traffic is never padded. The original captured-error injection test remains separate evidence.

Still open or inherently constrained:

- Copilot Auto may choose a different model after preflight or token expiry. Already-running Claude processes cannot have their environment window changed remotely. Model-bound reasoning cannot be replayed across vendors. A native too-long recovery path remains essential.
- Catalog/policy advertisement is not entitlement. Paid/business/enterprise/EMU seats and native Claude require live checks on those accounts. macOS/Linux are deferred.
- Protocol headers still use the observed extension versions; provider APIs are unsupported and can drift. Unrecognized server tools/content blocks fail explicitly rather than being silently dropped. URL images and advanced provider server tools are not universally supported.
- Managed preflight is conservative and local. It does not implement every native policy merge, remote policy, helper output or model allowlist rule. Claude's own policy engine remains authoritative; conflicting/dynamic policy may require an administrator.
- Retained hooks, MCP servers, plugins and native tools can have their own network behavior. A full process-level no-Anthropic-egress audit remains open; Claude's documented WebFetch preflight is outside the model gateway. Safety checks are not disabled to conceal this gap.
- A 35-day refresh simulation is not a wall-clock soak. Offline service, corporate TLS/proxy policy, quota exhaustion, external revocation, machine suspension, disk full/corruption and forceful process termination cannot be made impossible. Metrics write errors do not fail a successful generation; database startup failures are explicit.
- Browser visual QA remains unavailable in this session. Authenticated-link HTTP behavior is tested, but not a substitute for browser testing. Custom data directories should be private. Use a separate data directory per independent account/server instance; cloned/symlinked profile paths and concurrent policy edits require care.
- Failed/partial generations may consume upstream tokens without a terminal usage block; those costs cannot be reconstructed or labeled as zero billing. Premium accounting stays N/A unless the provider returns it.
