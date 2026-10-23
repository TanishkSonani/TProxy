# M4 packaging checkpoint

`bun run build` builds Vite, embeds its assets and compiles a standalone executable. `build:all` produces Windows x64, macOS arm64/x64 and Linux arm64/x64 artifacts plus SHA256SUMS.txt in dist. No source tree, Bun installation, asset folder or SQLite addon is needed. Implementation follows [Bun's executable support](https://bun.sh/docs/bundler/executables).

Compile flags disable working-directory dotenv, bunfig, tsconfig and package.json loading. Commands include start/stop/status/auth/env/claude, help, version and bundled license notices. Start is foreground; optional tray/autostart are not implemented.

Windows checks: the executable starts with saved VS Code credentials, serves embedded HTML/JS/CSS and retains SQLite history across a source-to-binary restart. Help and license commands work. Runtime port metadata allows control of an active instance after a pending saved port change. First-run onboarding is prepared by the explicit launcher; normal trust decisions remain intact.

All five targets compile. Only Windows has been executed. macOS/Linux use restricted-file fallback and env/gh/device auth; native keychains and reuse of those platforms' encrypted VS Code sessions remain unimplemented. Cross-compilation is not platform acceptance.

Remaining gates: visual browser QA (no browser available), native Claude and cross-vendor switching on an entitled account, full process-level egress audit and a wall-clock token refresh soak. Full Anthropic feature parity through non-Anthropic providers is not claimed.

The final Windows executable also completed a fresh-profile print session `94aae2e4-368a-4cba-aae2-b3ac9b9e1624` (BRIDGE_BINARY_READY). A separate interactive session reached normal workspace trust without Anthropic login, returned BRIDGE_INTERACTIVE_READY, and displayed /usage with 2.8k input, 128 output and 14.3k cache-write tokens. Claude explicitly warned its unknown-model dollar estimates may be inaccurate. No official marketplace folder was created in this fresh test profile. The default local data directory contains real usage after these sessions.

Interactive `/model copilot-auto` also succeeded and was saved in the isolated test profile. This establishes custom-ID selection, not cross-vendor switching. The final local HTTP check saw four real requests and embedded assets; no test credentials were printed.
