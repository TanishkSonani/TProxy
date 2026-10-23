# M3 local metrics and dashboard checkpoint

Implemented five offline React/Vite views: Status, Usage, Live log, Limits and Settings. The same localhost Bun server serves the dashboard and APIs. A per-process HttpOnly SameSite=Strict cookie authenticates dashboard requests; Host and Origin guards reject foreign websites. Proxy-key authentication remains available for CLI management. Model API-key disabling does not disable dashboard authentication.

Metrics use local SQLite WAL, including model/request/token/cache counts, latency percentiles, errors, hashed sessions, tool-call counts, local-date activity, refresh events and retention. Request body string values are replaced before insertion; outputs, credentials, image content and thinking signatures are not retained. Account quota and observed rate-limit headers are shown only when actually returned. Premium-request estimates remain N/A.

Implementation deviation: `better-sqlite3` could not install on this Windows machine because its native build requires unavailable Visual C++ tools. This checkpoint uses Bun's built-in `bun:sqlite`, preserving SQLite WAL and avoiding a native addon/DLL dependency. The user was asked about this choice; it is provisional until a preference is supplied.

Real Claude Code session `d4f59437-a1b2-46c7-98f8-cda59f8c0f65` returned BRIDGE_METRICS_READY through Auto with provider-reported usage. The live store contains this request. Automated checks cover restart persistence, WAL, redaction, aggregates, retention, local cookie authentication, Origin/Host rejection and protected management after API-key disabling.

No browser surface is available in this tool session, so visual and interactive browser QA remains outstanding. Asset build and HTTP delivery are checked; those do not establish visual correctness. Device authorization is an explicit dashboard fallback when no reusable login is found; it was unit tested, not performed on the user's signed-in account. Port changes are saved for the next restart.
