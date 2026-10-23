# M1 authentication checkpoint

Implemented production TypeScript provider order: GH_TOKEN/GITHUB_TOKEN → gh (including host discovery) → existing Windows VS Code session → protected cached credential. Device-flow code is available for an explicit fallback when no reusable login exists. It has not been used against the user's account.

Windows credentials are persisted in **Windows Credential Manager**, with a profile-specific entry. DPAPI unwraps the matching VS Code safeStorage key, and AES-GCM decrypts only the GitHub authentication record. Custom user/shared-data and installation roots are accepted by provider options. Multiple gh hosts/accounts require explicit selection. Windows credential transfer uses subprocess pipes, not command-line secret arguments.

The token manager validates discovered HTTPS origins, refreshes before expiry, deduplicates concurrent refreshes, retries background refresh failures without an unhandled rejection, refuses expired tokens, and can reacquire a rotated GitHub credential. Account/plan/quota discovery is separate from token exchange. Restart reuse is scoped to the same credential/host; endpoint selection is re-evaluated on exchange.

Live check on 2026-10-23: `bun scripts/auth-check.ts` reused the existing VS Code login, stored its cache in Windows Credential Manager, exchanged a token, read account/quota metadata, and discovered 49 catalog entries. No new OAuth login. A repeated process startup reused the cache without a token-refresh event.

Tests cover concurrent refresh, cache restart, malformed cache/account mismatch, origin validation, valid-versus-expired failure behavior, device-flow pending/slow_down, and **35 days of simulated lazy refresh**. This is not a completed 35-day real-time soak or paid/enterprise verification.

Remaining integration: CLI/dashboard auth lifecycle and persisted refresh-event metrics. macOS/Linux VS Code secret decryption and OS keychain adapters are not yet implemented; env/gh work independently and the restricted 0600-file cache is their current fallback. These platform gaps must be resolved or documented before cross-platform packaging is called complete.
# Windows credential-size update

Records larger than Windows Credential Manager's 5,120-byte blob limit now use a CurrentUser-DPAPI encrypted file in the profile directory. Small existing vault records keep the same target IDs and remain readable. A synthetic oversized record was encrypted, checked for absence of plaintext, and read back successfully on this host. No plaintext Windows fallback was added. Expired/inconsistent cache timestamps, missing refresh_in and explicit credential rejection now have regression coverage; see [hardening review](REAL-WORLD-REVIEW.md).
