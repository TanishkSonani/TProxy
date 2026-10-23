# Known limitations

TProxy is a preview. This document separates implemented behavior from claims that still require validation.

## Verified scope

Windows with an existing VS Code login, Copilot Free and Auto has passed real Claude Code chat, streaming, Read/Edit/Bash, a foreground subagent, safety-classifier requests and token reporting. Installed-package checks exercised start/stop, icon resource changes, authentication reuse and SQLite history preservation.

The last code validation before documentation cleanup passed 64 Bun tests with 383 assertions, TypeScript checking and three Python redaction checks. Tests do not establish every account or provider behavior.

## Accounts and models

- Paid, business, enterprise and enterprise-managed accounts require live validation on those accounts. Endpoint discovery is implemented; entitlements are never bypassed.
- Native Claude forwarding has regression coverage, but the tested Free account rejected access. Full Anthropic compatibility, advanced server tools and arbitrary future content blocks are not established.
- Copilot Auto can change models after discovery. A running Claude process retains its launch-time context configuration.
- Cross-vendor model changes can require a fresh conversation because encrypted reasoning is model/provider-bound.
- Provider headers and internal endpoints can change without notice.

## Context and usage

- Context windows use provider metadata with an explicit fallback. Unknown metadata and future Auto choices can still require overflow recovery.
- Claude recovered after an injected, previously captured context-limit error and continued with real Copilot calls. A genuinely oversized live Claude conversation has not passed the same acceptance check.
- Claude dollar figures for custom model IDs are estimates, not Copilot charges. Premium usage remains unavailable unless the provider returns suitable data.
- Partial generations may consume tokens without reporting terminal usage. Missing usage cannot be reconstructed as billing.

## Platform and deployment

- Windows is the tested platform. macOS/Linux builds need runtime acceptance and currently lack VS Code session decryption and OS-keychain integration.
- Token refresh has simulated 35-day coverage, not a completed 30-day wall-clock soak.
- Corporate TLS, unsigned executable restrictions, startup policy and managed Claude settings can block operation. TProxy does not alter organizational controls.
- The desktop icon needs the monitor running; Explorer may briefly cache its old appearance. Green means local proxy health, not account entitlement or available quota.
- Browser visual QA remains incomplete; authenticated dashboard HTTP behavior is tested.

## Privacy and policy

- TProxy adds no third-party telemetry. A complete process-level no-Anthropic-egress audit has not been completed. Claude, hooks, MCP servers and native tools can make independent network requests.
- Local managed-settings checks are conservative; they do not implement every remote/helper policy or native merge rule. Claude's own policy engine remains authoritative.
- Keep custom data directories private and use a separate directory per account/server instance.
- Offline periods, quota exhaustion, revocation, suspension, disk failures and forced termination cannot be eliminated. Metrics write failures are surfaced without failing an otherwise successful generation.
- Safety-classifier protocol regressions have been fixed and tested; outages or provider errors can still prevent classification. No classifier availability guarantee is made and checks are not bypassed.
