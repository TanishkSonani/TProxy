# TProxy architecture

Revision: 2026-10-24 (v1.0.1)
Scope: the local desktop gateway, its outbound trust and routing boundaries, and the Windows deployment model.
Status: architecture baseline with an implementation-status map. Working-tree changes are not evidence that an installed or published binary has been updated.

This document incorporates the supplied TProxy high-level design and development transcript. Protocol details remain in [PROTOCOL.md](../PROTOCOL.md); current compatibility limits remain in [LIMITATIONS.md](LIMITATIONS.md).

## 1. Outcomes and constraints

TProxy lets the installed Claude Code CLI use account-entitled GitHub Copilot models through a localhost provider endpoint. Claude keeps its harness, conversation storage, hooks, MCP configuration, workspace trust and tool-permission decisions.

The architecture must:

- Run without administrator access or a permanent PATH change.
- Bind model, health and dashboard endpoints only to loopback.
- Keep metrics in local SQLite and serve dashboard assets without external services or telemetry.
- Work across corporate environments by consuming the execution host's already-approved trust, rather than embedding one organization's certificate.
- Keep the local dashboard reachable when upstream authentication, certificate verification or model discovery fails.
- Preserve TLS certificate-chain, validity and hostname checks on outbound HTTPS.
- Discover Copilot origins, models and context limits instead of assuming an Individual host or universal token limit.
- Report unsupported network routing and model capabilities honestly.

The supported deployment remains **one user's local desktop gateway**. The supplied HLD's separate-host deployment is a future design option, not a feature to enable by binding this application to a network interface. Remote hosting would require a separate design for inbound TLS, tenancy, identity, authorization and credential isolation.

## 2. System context

~~~mermaid
flowchart LR
    subgraph Host["User's Windows environment"]
        CC["Installed Claude Code"]
        UI["Local browser dashboard"]
        Desktop["Desktop controls and monitor"]
        TP["TProxy on 127.0.0.1"]
        Store["Local SQLite and protected credentials"]
        Trust["Approved OS trust and network settings"]
        CC <--> TP
        UI <--> TP
        Desktop --> TP
        TP <--> Store
        TP -. reads applicable trust .-> Trust
    end
    TP --> Route["Approved outbound route"]
    Route --> GH["Selected GitHub API"]
    Route --> CP["Discovered Copilot origin"]
~~~

A corporate HTTP proxy or TLS-inspection appliance is part of the outbound route. It is distinct from TProxy. TProxy is an application gateway and TLS client; it does not install an interception CA, issue website certificates or alter the operating system's trust store.

Model requests intentionally leave the host for GitHub/Copilot. Local metrics and an offline dashboard do not imply that prompts stay on the machine or that Claude's independent tools make no network requests.

## 3. Logical components

These are responsibilities inside a single application process, not separate deployed services.

| Responsibility | Implementation boundary |
| --- | --- |
| Command handling, managed-settings preflight and Claude launch | [CLI](../src/cli.ts), [client modules](../src/client/claude-launch.ts) |
| Reusable credentials, selected account, protected caching and refresh | [providers](../src/auth/providers.ts), [token manager](../src/auth/token-manager.ts), [secure store](../src/auth/secure-store.ts) |
| Shared outbound HTTPS transport and optional CA bundle | [HTTPS transport](../src/auth/https.ts) |
| Loopback admission, dashboard sessions and model routes | [proxy server](../src/proxy/server.ts) |
| Copilot calls, bounded retries and observed limits | [Copilot client](../src/proxy/copilot.ts) |
| Native Messages forwarding and non-Anthropic adapters | [proxy modules](../src/proxy/server.ts), [Responses adapter](../src/proxy/responses.ts), [Chat adapter](../src/proxy/chat.ts) |
| Local metrics, redaction, retention and aggregation | [metrics store](../src/dashboard/store.ts) |
| Offline dashboard and accessible activity exploration | [dashboard](../dashboard/main.tsx) |
| Canonical Windows installation and status icons | [package paths](../src/windows/package-path.ts), [desktop controller](../src/windows/DesktopController.cs) |
| Embedded UI, runtime options and portable packaging | [build](../scripts/build.ts), [Windows packaging](../scripts/package-windows.ts) |

## 4. Trust boundaries

### Local clients to TProxy

The listener is HTTP on loopback because the intended clients share the host. Loopback is a network boundary, not proof of user identity: other local processes can reach it.

Model API-key enforcement defaults to enabled. Dashboard management always requires authentication, even if model-key enforcement is disabled. A private fragment link establishes an HttpOnly, same-site dashboard session; opening the public root does not grant management access. Host and Origin checks constrain browser requests.

Secret-handling actions identify the local credential explicitly. Environment previews are masked until revealed; copying includes the secret and says so. Disabling the proxy API key requires confirmation before saving.

### TProxy to GitHub/Copilot

GitHub credentials, Copilot bearer tokens and Auto session tokens remain inside the gateway boundary. They are not dashboard data or metric fields. The selected GitHub account can differ from the account used to publish this repository.

Every outbound request must use a validated destination, the applicable route and a verified HTTPS connection. Upstream credentials must not follow arbitrary redirects or be sent to guessed hosts.

### Environment-provided trust

An organization's CA is trusted because it is already approved in the host's applicable trust configuration, or because an operator deliberately supplies an independently verified CA bundle. Receiving a certificate during an unverified handshake does not establish that approval.

A website's leaf certificate is not an approved CA bundle. No downloaded leaf, private key or organization-specific trust material belongs in the repository or release package.

## 5. Outbound certificate trust

The default architecture uses the runtime's public roots **plus the execution environment's approved system roots**. An optional CA file augments that set for environments where the runtime cannot otherwise see the required approved CA.

Bun supports loading system CAs at process startup through its system-CA option. [Official runtime guidance](https://bun.sh/blog/release-notes/bun-v1.2.23) describes this in addition to its bundled roots.

For this codebase:

1. Compiled binaries embed the system-CA runtime option.
2. Source launch scripts enable the same option before application code runs.
3. GitHub token/account/model requests, device authorization and Copilot generation share the outbound transport.
4. If an explicit CA file is configured, its PEM entries are validated as CA certificates and combined with the runtime's default trust set.
5. Certificate-chain and hostname verification remain enabled. No failed handshake automatically imports its issuer into trust.
6. CA material is read, not installed into Windows. A changed bundle or trust configuration requires a new process to take effect reliably.

The runtime option was verified in an isolated compiled Bun 1.3.13 executable. Enabling system trust loaded Windows certificates while retaining bundled defaults; assigning the environment variable later inside application code did not enable the same trust set. This is a packaging requirement, not just a configuration example.

A real local TLS fixture also verifies that a configured synthetic CA can authenticate its matching server, while an unknown CA, an unapproved leaf as a CA file, and a hostname mismatch are rejected.

~~~mermaid
flowchart TD
    Start["Start runtime with system CAs enabled"] --> Defaults["Bundled public roots plus applicable OS roots"]
    Defaults --> Extra{"Explicit approved CA bundle configured?"}
    Extra -- No --> Verify["Verify destination certificate and hostname"]
    Extra -- Yes --> Parse["Validate CA entries and combine with defaults"]
    Parse --> Verify
    Verify --> Valid{"Identity valid?"}
    Valid -- Yes --> Send["Send authorized HTTPS request"]
    Valid -- No --> Error["Report TLS failure; local dashboard remains reachable"]
~~~

**Cross-environment behavior:** on a correctly provisioned corporate machine, no manual certificate export should be necessary. On another company's machine, that machine supplies its own established trust. If its CA is absent from the trust available to the runtime, TProxy reports the gap; it cannot promise automatic trust for every corporate network.

The current machine's successful unauthenticated HTTPS probes do not certify the previously reported inspected connection or every other corporate environment.

## 6. Routing is separate from certificate trust

Trust answers *which HTTPS identity can be accepted*. Routing answers *how to reach that identity*. Adding a CA does not resolve an unavailable proxy, proxy authentication, PAC evaluation or a blocked destination.

The target routing contract is:

- Honor mandatory managed routing for the execution environment.
- Use runtime-supported explicit HTTP/HTTPS proxy settings without discarding them in the shared transport.
- Resolve policy-managed proxy/PAC requirements through a platform adapter when supported.
- Never silently retry directly after a required corporate proxy fails.
- Keep loopback control traffic on the host; do not send local proxy credentials to an outbound corporate proxy.
- Keep proxy credentials out of diagnostic URLs, logs, metrics and dashboard output.

**Implementation boundary:** the current shared fetch transport preserves the runtime's normal proxy behavior. That is not proof that Windows Internet Settings, WinHTTP configuration, PAC/WPAD or integrated enterprise proxy authentication are fully supported. A policy-aware Windows route resolver and associated acceptance tests remain open work.

A PAC-only or integrated-auth-only environment must therefore be validated separately. System-CA support alone is not evidence of full corporate-network compatibility.

## 7. Endpoint and account resolution

The credential chain is environment token, selected GitHub CLI login, existing Windows VS Code session, then device authorization when no reusable login exists. An explicit account selection must apply throughout the chain; a Git publishing login must not silently displace the selected Copilot identity.

For a supported GitHub host, TProxy exchanges the GitHub credential for a short-lived Copilot token and uses the returned API origin. The origin must pass scheme, host and URL validation; a returned URL is data to validate, not unrestricted permission to send credentials there.

Public GitHub and Individual Copilot origins are examples, not hardcoded routing decisions. Enterprise-managed hosts and account entitlements require their own live validation.

Tokens are refreshed before expiry and stored through the protected credential backend. On Windows this uses Credential Manager with a CurrentUser-DPAPI fallback for larger records. No reusable credential or token is serialized into request metrics.

## 8. Local availability and upstream readiness

The local listener must bind before network initialization. Local availability and upstream readiness are separate states.

~~~mermaid
stateDiagram-v2
    [*] --> LocalReady
    LocalReady --> AuthStarting
    AuthStarting --> NeedsAuth: no reusable credential
    AuthStarting --> AuthError: credential, TLS or network failure
    AuthStarting --> CatalogLoading: authentication succeeds
    CatalogLoading --> UpstreamReady: model discovery succeeds
    CatalogLoading --> CatalogError: discovery fails
    NeedsAuth --> AuthStarting: authorized sign-in or retry
    AuthError --> AuthStarting: explicit retry
    CatalogError --> CatalogLoading: retry
    UpstreamReady --> CatalogLoading: metadata refresh
~~~

Health, public dashboard assets and authenticated management/status remain available through upstream failures. The desktop's green icon means that the local health endpoint responds; it does not certify Copilot entitlement, quota, authentication or model readiness.

Status reports authentication and catalog state independently. A catalog failure must not be mislabeled as rejected credentials. Errors should explain the failure category without disclosing tokens, raw provider bodies or proxy-authentication details.

Model-dependent requests must await or retry the applicable readiness stage with bounded work and cancellation. They must not manufacture an empty successful catalog, silently substitute an unrelated model or treat an initialization race as permanent loss of credentials. Complete readiness/concurrency behavior remains part of the acceptance work listed below.

## 9. Model request lifecycle

~~~mermaid
sequenceDiagram
    participant CC as Claude Code
    participant TP as Loopback gateway
    participant Cred as Credential lifecycle
    participant HTTPS as Shared outbound transport
    participant GH as GitHub service
    participant CP as Validated Copilot origin
    participant DB as Local metrics
    CC->>TP: Authorized Messages request
    TP->>TP: Validate request and select model mapping
    TP->>Cred: Obtain current Copilot session
    opt Exchange or refresh required
        Cred->>HTTPS: Request on approved route with verified TLS
        HTTPS->>GH: GitHub token exchange
        GH-->>Cred: Token, expiry and endpoint metadata
        Cred->>Cred: Validate origin and protect cached token
    end
    opt Copilot Auto selected
        TP->>HTTPS: Select entitled model and Auto session
        HTTPS->>CP: Auto selection
        CP-->>TP: Selected model and expiring session token
    end
    TP->>HTTPS: Generation request
    HTTPS->>CP: Native Messages, Responses or Chat endpoint
    CP-->>TP: Response or SSE stream with provider usage
    TP-->>CC: Anthropic-compatible response or error
    TP->>DB: Redacted structure and observed metrics
~~~

Claude models use native Anthropic-compatible Messages forwarding. Other vendors use protocol-specific adapters selected from advertised model metadata. This separation does not establish full Anthropic feature parity for other providers.

Context budgets come from the selected model's metadata, with an explicit fallback only when metadata is absent. Do not multiply reported usage to disguise a smaller context window. Recognized input-overflow errors map to Anthropic's prompt-too-long semantics so Claude can attempt its native compaction flow.

Output cutoffs, rate limits, tool arguments, reasoning history and request IDs must preserve their applicable semantics. Retries are bounded and occur before delivery; already-exposed generations and tool actions are not replayed.

## 10. Local data and yearly activity

SQLite WAL stores request timestamps, selected models, statuses, token usage, latency, tool counts, hashed conversation identifiers, redacted structures and refresh events. Request contents and credentials are not retained as readable payloads.

The dashboard separates two exploration windows:

| View | Date behavior |
| --- | --- |
| Summary, request series and live-log filters | Selected date range, model and outcome filters |
| Activity map | Rolling 365-day calendar through the selected end date; model/outcome filters still apply |

The annual map uses seven weekday rows, month labels, fixed 12-by-12-pixel squares and 4-pixel gaps. The violet palette stays consistent with the dashboard. Narrow screens scroll horizontally instead of enlarging cells. Exact dates and counts remain available in hover details and a keyboard-accessible table.

Showing a full year does **not** change retention automatically. The current default retention can be shorter than a year.

A retention gap is not the same as a recorded day with zero matching requests. The API reports the earliest stored request independently of the selected model/status filter; earlier cells are labeled "Before stored history." That timestamp does not prove continuous service uptime or a retention-policy boundary. Authoritative policy/uptime coverage would require additional persisted metadata.

## 11. Windows installation and lifecycle

The desktop-supported installation is the complete package at the per-user Programs location. Setup, shortcuts, controller working directory, CLI launch and icon lookup all resolve that canonical package.

~~~text
%LOCALAPPDATA%\Programs\TProxy\
  tproxy.exe
  tproxy-desktop.exe
  Open-TProxy-Terminal.cmd
  SETUP-INSTRUCTIONS.md
  icons\tproxy-on.ico
  icons\tproxy-off.ico
~~~

Private configuration, SQLite history, runtime metadata and protected credential material remain outside the package under the user's data profile.

Running a stray controller copy from the Desktop must not redirect icon lookup to Desktop/icons. Missing package files produce an actionable installation message. Setup registers the desktop shortcut and a per-user monitor startup entry; it does not create a machine service, permanently alter PATH or start the proxy automatically at login.

Updates replace package files only after their owning processes are stopped. Validation can use a separate data directory and unused loopback port. A build, documentation edit or test run must not require restarting an existing user session.

## 12. Failure behavior

Limits uses a dedicated authenticated quota-refresh path. Visiting the page, returning to a visible tab, or the 30-second visible-page timer requests account data without restarting authentication or refreshing the model catalog. The server coalesces concurrent checks and caches successful quota responses for at least 15 seconds. Failures retain the last successful values, use bounded exponential backoff, and honor longer Retry-After values. Hidden pages and other views do not schedule quota checks.

Quota checks do not generate model traffic to obtain rate-limit headers. Those headers and their observation timestamp change only when an upstream model response supplies them. A quota timestamp advances only when GitHub returns a valid quota snapshot.

| Failure | Required behavior |
| --- | --- |
| Upstream issuer not trusted | Keep local UI available; identify trust failure and applicable remediation |
| Hostname mismatch or invalid certificate | Reject connection; no insecure retry |
| Required proxy unavailable or proxy authentication fails | Report route/proxy failure; no unauthorized direct fallback |
| GitHub credential rejected | Return authentication failure without switching silently to another identity |
| Copilot model unavailable | Preserve explicit model choice and report entitlement/capability error |
| Catalog discovery fails | Keep local service available; report catalog state separately and allow bounded recovery |
| Request exceeds model context | Anthropic-format prompt-too-long error; preserve client compaction path |
| Provider rate limit | Sanitized rate-limit error and observed Retry-After |
| Interrupted stream or malformed tool arguments | Explicit failure; no fabricated successful terminal event or executable repair |
| Metrics write failure | Surface degraded storage without inventing usage or corrupting a successful generation |

Corporate TLS inspection, endpoint validation and inbound dashboard authentication are separate checks. Passing one does not replace the others.

## 13. Implementation and evidence map

| Area | Current evidence | Remaining boundary |
| --- | --- | --- |
| System CA loading | Isolated compiled Bun runtime probe passed; v1.0.0 Windows package rebuilt with the startup option | Actual corporate-network acceptance remains environment-specific |
| Additional CA bundle | Combined-default-root test and real local TLS positive/negative tests pass | Corporate-specific chain must be verified in its actual environment |
| Canonical Windows paths | Package-path regression coverage and rebuilt v1.0.0 controller with both sidecar icons | Installed-platform and policy-specific acceptance |
| Local-first startup | Working-tree implementation and failure/recovery tests | Readiness races, retry/cancellation and failure categorization need further review |
| Full-year heatmap | UI/API and browser coverage; month labels use actual calendar weeks and cell sizes stay fixed | Exact policy/uptime coverage requires additional metadata; leap/DST cases need broader acceptance |
| Explicit runtime proxy environment | Shared transport preserves runtime handling | Native managed/PAC discovery, proxy authentication and no-direct-fallback enforcement are not certified |
| Native Claude compatibility | Forwarding and regression coverage | Entitled native-Claude account and broader feature acceptance |
| Other operating systems | Build targets and fallback storage exist | Runtime, trust, credential and network-policy acceptance |

Source changes, installed binaries and published release assets are distinct artifacts. Tests or edits in the source tree do not update a running executable. Installation, restart and publication require their own explicit step.

## 14. Acceptance and next implementation work

1. Validate public-root and approved system-root TLS on the actual packaged runtime.
2. Demonstrate valid custom-CA success and rejection of unknown issuers, non-CA files and wrong hostnames.
3. Confirm account exchange, catalog, Auto and generation all use the shared verified transport.
4. Confirm health/dashboard availability during auth/catalog failures, accurate stage reporting and bounded recovery.
5. Validate explicit proxies separately from Windows managed/PAC and integrated-auth environments; do not claim unsupported routing coverage.
6. Verify the complete canonical Windows package, shortcuts and ON/OFF resources from a rebuilt artifact.
7. Check a rolling year, leap/DST boundaries, month labels, fixed cell sizes and genuine retention gaps.
8. Keep real prompts, tokens, CA exports, local transcripts and diagnostic profiles out of source control and release assets.

Build validation uses isolated ports and profiles. Installation, restart, commit, push and release publication are distinct lifecycle steps; replacing an active executable requires stopping its owning processes first and preserving the private data profile.
