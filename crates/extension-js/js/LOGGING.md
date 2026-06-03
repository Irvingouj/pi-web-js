# Extension-JS Logging System

## Quick Start

Enable debug logs from the browser console:

```js
// In the extension sidepanel or popup console
__jsNotebookSetLogLevel("debug");
```

Or via the Worker API:

```js
worker.postMessage({ type: "setLogLevel", level: 0 }); // 0 = debug
```

## Log Levels

| Level   | Numeric | Description                              |
|---------|---------|------------------------------------------|
| debug   | 0       | Everything including internal flow         |
| info    | 1       | Major lifecycle events and correlations  |
| warn    | 2       | Recoverable issues                       |
| error   | 3       | Errors only (default)                    |
| none    | 4       | Silence everything                       |

**Default:** `error` (3). The system starts quiet and must be explicitly made verbose.

## How to Enable Logs

### From JavaScript (Recommended)

```js
import { setLogLevel } from "@pi-oxide/extension-js";
setLogLevel("debug");  // or "info", "warn", "error", "none"
```

This controls both the JS logger and the Rust WASM tracing layer simultaneously.

### From Browser Console (Content Script)

```js
// Content script context only
__jsNotebookSetLogLevel("debug");
```

Note: This only affects the content-script logger, not the main extension runtime.

### Advanced: Worker Direct Control

```js
// If you have direct access to the Worker instance
worker.postMessage({ type: "setLogLevel", level: 0 }); // 0 = debug
```

### WASM Bridge

When the Worker initializes, it calls:

```js
setWasmLogLevel(3);           // default error level
registerWasmSetLogLevel(setWasmLogLevel);  // bridge JS → Rust
```

Changing the JS log level automatically syncs to Rust via this bridge, so `tracing::info!` events are gated by the same numeric level.

## Correlation IDs

Four IDs trace a single execution end-to-end:

| ID         | Generated In | Propagation Path                                      |
|------------|--------------|-------------------------------------------------------|
| `sessionId`| `ExtensionSession::new()` (Rust) | Lives for the session lifetime                        |
| `runId`    | `ExtensionSession.runCellAsync()` (JS) | `index.ts` → Worker `runCell` message → `currentRunId` → `asyncRelay` → `runner.ts` |
| `commandId`| `Command.call_id` (JS/WASM) | Attached to every relayed command                     |
| `batchId`  | `web-js-base` loop (Rust) | Per-iteration batch identifier inside `run_cell_async_loop` |

Example span hierarchy in Rust:

```
run_cell_async { session_id=sess_0, run_id=abc123 }
  └── handle_command { command_id=42, action=dom.snapshot, run_id=abc123 }
      └── run_cell_async_loop { batch_id=batch_1 }
```

## Log Format

### JavaScript Logger

```
[extension-js][namespace] event key=value key2=value2
```

Example:
```
[extension-js][runner] command_dispatch action=dom.snapshot commandId=42 runId=abc123 duration_ms=15
```

### Rust Tracing (WASMLayer)

```
INFO crates/extension-js/src/session.rs:126 handle_command_start: call_id=42 action="dom.snapshot"
```

**Note:** The formats differ. JS uses flat `key=value` strings; Rust uses `tracing-subscriber` structured fields. Both are gated by the same numeric level, but they look different in the console.

## Example Output (Debug Level)

```
[extension-js][root] set_log_level level=0
[extension-js][runner] command_dispatch action=dom.snapshot commandId=42 runId=abc123
INFO  extension-js/src/session.rs:126 handle_command_start: call_id=42 action="dom.snapshot"
[extension-js][runner] command_dispatch action=dom.snapshot commandId=42 runId=abc123 duration_ms=15 ok=true
INFO  extension-js/src/session.rs:177 handle_command_relay_done: call_id=42 action="dom.snapshot" ok=true
```

## Known Limitations

1. **background.js and content-script.ts are independent**
   - Both use hardcoded `error` level (`__LOG_LEVEL = 3`).
   - They do NOT participate in the JS/Rust level bridge.
   - To change their level, edit the source or add a message-passing mechanism.

2. **Rust tracing and JS logger formats differ**
   - JS: `[extension-js][namespace] event key=value`
   - Rust: `INFO path:line event: field=value`
   - Unified level gating is the goal; unified formatting is not.

3. **Worker `currentRunId` invariant**
   - `currentRunId` is a module-level variable in `worker.ts`.
   - It is safe because the worker processes **one cell at a time**.
   - If concurrent runs are ever supported, replace it with a `Map<call_id, runId>`.

4. **web-js WASM unconditional startup log**
   - `web-js` (non-extension) uses `tracing_wasm::set_as_global_default()` without a filter layer.
   - Its `tracing::info!("web-js WASM initialized...")` always prints on startup.
   - Extension-js uses `LogLevelFilterLayer`, so its startup log is properly gated.

5. **No `tracing::trace!` support**
   - `LogLevelFilterLayer` returns `false` for `Level::TRACE` regardless of setting.
   - The system only supports debug/info/warn/error/none.
