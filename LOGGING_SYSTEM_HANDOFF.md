# Extension-JS Logging System Handoff

## Suggestions

1. Use one logging contract across Rust and JS.

   Common fields: `level`, `target`, `context`, `event`, `run_id`, `cell_id`, `command_id`, `action`, `duration_ms`, `error`.

   Example:

   ```text
   [extension-js][runner][run_id=...][cell_id=...][command_id=...] dispatch start action=chrome.tabs.query
   ```

2. Keep logging extension-first.

   The product context is the Chrome extension. Logging should be wired and validated through `web/dist/` loaded as an unpacked extension. The web-js playground is secondary.

3. Rust should use `tracing` consistently.

   The project already has `tracing` and `tracing-wasm`. Prefer `tracing::*` macros over custom console wrappers. Current important files include:

   - `crates/extension-js/src/lib.rs`
   - `crates/extension-js/src/log.rs`
   - `crates/extension-js/src/session.rs`
   - `crates/web-js-core/src/session.rs`
   - `crates/web-js-base/src/session.rs`

4. Use Rust spans around the execution lifecycle.

   Important spans/events:

   - WASM init
   - session creation/reset
   - `run_cell`
   - JavaScript eval start/end
   - async command batch creation
   - command dispatch/resume
   - promise rejection / JS exception
   - stuck async loop or fuel issues

5. Upgrade the JS logger.

   `crates/extension-js/js/logger.ts` should support:

   - child namespace loggers, for example `logger.child("runner")`
   - structured metadata
   - timing helpers
   - configurable level
   - safe serialization of errors and arbitrary values
   - consistent console prefixes

6. Bridge JS and Rust log levels.

   JS should own extension logging config and call the exported WASM `setLogLevel(...)`.

   Level mapping:

   ```text
   debug = 0
   info = 1
   warn = 2
   error = 3
   none = 4
   ```

7. Add correlation IDs.

   Add or propagate:

   - `runId` per notebook cell execution
   - `commandId` per async command
   - `batchId` per pending command batch
   - optionally `sessionId` per `ExtensionSession`

   These IDs should make this path visible:

   ```text
   UI -> worker -> WASM session -> pending command batch -> runner.ts -> response -> resume_cell
   ```

8. Do not log full user code by default.

   Log `code_len`, status, timing, and IDs. Full code should only appear at explicit debug level if intentionally enabled.

9. Keep internal telemetry separate from notebook output.

   Notebook stdout/stderr is user-visible cell output. Internal logs should use the structured logger/tracing path.

10. Remove noisy boot/test logs.

    Remove unconditional logs like test `tracing::error!` calls during WASM startup. Keep init logs level-gated.

## Prompt For Working Agent

```text
You are working in /Users/oujunyi/code/web-js.

Goal: implement a systematic logging system for this project, extension-js first. Follow AGENTS.md strictly: real development/testing/validation must happen in Chrome extension context, not standalone web-js playground context.

Current state:
- Rust already depends on tracing and tracing-wasm in workspace Cargo.toml.
- extension-js has crates/extension-js/src/lib.rs initializing tracing_wasm.
- extension-js has crates/extension-js/src/log.rs with a manual console logger and exported setLogLevel.
- JS has crates/extension-js/js/logger.ts with a minimal level-gated console logger.
- There are scattered direct console.log/warn/error calls in extension JS and web UI.
- Core Rust files already contain tracing::info/error calls, especially in:
  - crates/web-js-core/src/session.rs
  - crates/web-js-base/src/session.rs
  - crates/extension-js/src/session.rs

Implement the logging system with these requirements:

1. Extension-first logging
- Do not build around web-js playground behavior.
- Validate through npm run build producing web/dist/ as extension assets.
- Tests should mock chrome.runtime.id where needed to force extension context.

2. Unified log levels
- Levels: debug, info, warn, error, none.
- Numeric mapping for Rust/WASM compatibility:
  - debug = 0
  - info = 1
  - warn = 2
  - error = 3
  - none = 4
- JS logger owns config and calls exported WASM setLogLevel when the WASM module is loaded.
- Default level should be error in production-like builds, info/debug only when explicitly enabled.

3. JS logger
Upgrade crates/extension-js/js/logger.ts into a structured logger supporting:
- child namespace loggers, e.g. logger.child("runner")
- structured metadata object
- timer helper for duration_ms
- consistent console output prefix: [extension-js][namespace]
- level gating
- safe serialization of errors and arbitrary values
- no throwing from logger internals

Example intended usage:
const log = logger.child("runner");
log.info("command_start", { commandId, action });
const finish = log.timer("command_dispatch", { commandId, action });
finish({ ok: true });

4. Rust tracing
- Prefer tracing::* macros over custom console logging.
- Keep tracing_wasm initialization in extension-js WASM startup, but remove any unconditional test/error boot logs.
- Add useful tracing spans/events around:
  - WASM init
  - ExtensionSession creation/reset
  - run_cell start/end
  - eval start/end
  - pending async command batch creation
  - command resume
  - promise rejection / JS exception
- Include fields where available:
  session_id, run_id, cell_id, batch_id, command_id, action, code_len, duration_ms, status, error.
- Do not log full user code by default. Log code_len instead.

5. Correlation IDs
Add or propagate correlation IDs through the extension execution path:
- runId per cell execution
- commandId per async command
- batchId per async command batch
Use these IDs in JS and Rust logs where practical.
Trace path should be visible across:
UI -> worker -> WASM session -> pending command batch -> runner.ts dispatch -> response -> resume_cell.

6. Replace scattered console usage in extension runtime
Replace direct internal console.log/warn/error calls in extension runtime files with structured logger calls, especially:
- crates/extension-js/js/runner.ts
- crates/extension-js/js/worker.ts
- crates/extension-js/js/index.ts
- crates/extension-js/js/background.js if included in build
Do not replace user-facing notebook stdout/stderr console behavior unless it is clearly internal logging.

7. Test/validation
Add focused tests for:
- JS logger level gating
- logger metadata/error serialization
- timer includes duration_ms
- setLogLevel bridge if practical
- extension context still works with chrome.runtime.id mocked
Then run relevant checks:
- npm run wasm if Rust/WASM changed
- npm run build
- extension-js JS tests if available
- relevant Playwright extension tests if feasible

8. Deliverable
Return:
- files changed
- how to enable debug/info logs
- what commands were run
- any tests not run and why

Important constraints:
- Keep changes scoped.
- Do not prioritize web-js playground logging.
- Do not mix internal telemetry with notebook cell stdout/stderr.
- Do not add noisy always-on logs.
```
