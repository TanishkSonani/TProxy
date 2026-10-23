# Client context-window guard — 2026-10-23

The installed Claude Code 2.1.269 assumes 200,000 tokens for the custom `copilot-auto` ID, rather than assuming 1M. This was seen in prior interactive warnings and JSON `modelUsage.contextWindow`. Copilot's selected gpt-6-luna advertises a larger total window but a separate 872,000-token prompt limit; other catalog entries advertise smaller prompt windows. A universal fivefold multiplier would be inaccurate and would corrupt usage statistics.

The bridge now explicitly sets a configurable `contextWindowTokens` ceiling, default 200,000. It lowers the launcher ceiling using the smaller valid `max_context_window_tokens` / `max_prompt_tokens` values for configured slots, enabled picker models and Auto selections observed by the current server. Hidden catalog entries that are neither selected nor exposed in the picker do not establish Auto entitlement and are not treated as its active model. The bridge never raises the ceiling from metadata. The authenticated status API reports the resulting ceiling, and both CLI launch and dashboard environment-copy use it. A caller's smaller configured ceiling also remains effective.

The child environment sets `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, and `CLAUDE_CODE_DISABLE_1M_CONTEXT`. It clears inherited flags disabling compaction or unknown-model-window enforcement. The explicit auto-compact window also bounds proactive compaction for recognized model IDs where the maximum-context override alone does not apply. The auto-compact setting has a 100k minimum; unknown smaller IDs still use the declared smaller model window. Claude's own reserved-output/headroom rules remain in charge. See [official model/window configuration](https://code.claude.com/docs/en/model-config#correct-the-window-for-a-gateway-or-custom-model-id).

No token usage, cache counts, premium metrics or count_tokens values are multiplied. No context/history is silently truncated by the proxy. Real provider overflow remains mapped to Anthropic 400 invalid_request_error / prompt is too long so native recovery can run.

## Verification

- Forty-four Bun tests pass, including limits from configured slots, smaller prompt versus total windows, picker models, observed Auto selections, invalid metadata, inherited 1M settings and disabled-compaction flags. TypeScript passes.
- Rebuilt and restarted the Windows executable with the user's standing authorization. Existing login and SQLite history were retained.
- Native Claude Code session `32b4420b-e8e7-4ed6-958a-07359513ac96`, isolated profile and a 128,000-token ceiling, returned `CONTEXT_WINDOW_READY`. Its real JSON reports `modelUsage.copilot-auto.contextWindow: 128000`, with 1,706 input / 8 output / 12,042 cache-creation tokens. This validates the real client window override and unchanged usage; it does not claim an oversized-context experiment.

## Limits

Settings are applied when launching a Claude process; they cannot retroactively alter another already-running process. Restart Claude through the updated launcher to apply the guard. A later Auto selection, a manual arbitrary `/model` ID not represented in the launch snapshot, provider-side hidden prompt overhead, tokenizer differences or a very large tool result may still exceed an upstream limit. The error-recovery path remains necessary. An Auto model observed with a smaller limit lowers subsequent launch recommendations, not the environment of existing processes. Managed settings can also override user routing/compaction settings.
