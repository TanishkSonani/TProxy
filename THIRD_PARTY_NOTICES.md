# Third-party code

Reference revisions and file hashes: [references.json](third_party/references.json). All four pinned repository root licenses were inspected and identify MIT terms. File-level notices and dependencies still need review before importing additional modules.

The embedded dashboard includes React 19.3.1, React DOM 19.3.1 and Scheduler; their MIT notices are in `third_party/licenses/` and included in `tproxy licenses`. Bun supplies the compiled runtime. Build dependencies are not additional dashboard network services.

| Local component | Origin | Changes / license |
| --- | --- | --- |
| `src/client/env-script.ts` | [ericc-ch/copilot-api shell.ts at 0ea08febdd7e3e055b03dd298bf57e669500b5c1](https://github.com/ericc-ch/copilot-api/blob/0ea08febdd7e3e055b03dd298bf57e669500b5c1/src/lib/shell.ts) | Adapted shell export structure; explicit shell selection, literal quoting, unset support and unsafe-CMD rejection. [MIT notice](third_party/licenses/ericc-copilot-api.txt). |
| `src/auth/device-flow.ts` | ericc-ch/copilot-api GitHub device/poll flow at the same pinned revision | Adapted request/poll sequence; added host validation, expiry, cancellation and typed result. Same MIT notice. |
| `src/proxy/chat.ts` | ericc-ch/copilot-api Messages non-stream/stream translation at the same pinned revision | Adapted Chat Completions message/tool/usage mapping; separate streaming buffers preserve fragmented tool metadata and trailing usage. Same MIT notice. |
| `src/proxy/responses.ts` | [caozhiyuan/copilot-api at 64e38da1eb79eeda6c8b660d585754c0c8f5dc00](https://github.com/caozhiyuan/copilot-api/tree/64e38da1eb79eeda6c8b660d585754c0c8f5dc00/src/routes/messages) | Adapted Responses message/tool/usage/stop-reason mapping and stream block tracking. Project-specific opaque reasoning carriers are not Anthropic-issued signatures. Removed external counting, prompt additions, tool-search shim and forced token minimum. [MIT notice](third_party/licenses/caozhiyuan-copilot-api.txt). |

Record additional imported code's source revision, modifications, attribution and tests here, and bundle its required notices in compiled distributions.
