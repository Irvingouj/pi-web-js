# Extension-JS Logging System

## Quick Start

Enable verbose logs from the browser console:

```js
// In the extension sidepanel or popup console
__jsNotebookSetLogLevel("trace");
```

Or open the notebook with `?log=trace`.

**Default:** `trace` (0) — maximum verbosity for debugging async/resume flows.

## Log Levels

| Level   | Numeric | Description                              |
|---------|---------|------------------------------------------|
| trace   | 0       | Every call boundary (async loop, relay, eval) |
| debug   | 1       | Internal flow details                    |
| info    | 2       | Major lifecycle events                   |
| warn    | 3       | Recoverable issues                       |
| error   | 4       | Errors only                              |
| none    | 5       | Silence everything                       |

## How to Enable Logs

### From JavaScript (Recommended)

```js
import { setLogLevel } from "@pi-oxide/extension-js";
setLogLevel("trace");  // or "debug", "info", "warn", "error", "none"
```

In the sidepanel console:

```js
__jsNotebookSetLogLevel("trace");
```

Or URL: `?log=trace` (E2E: `?e2e_log=trace`).

### Worker Direct Control

```js
worker.postMessage({ type: "setLogLevel", level: 0 }); // 0 = trace
```

### WASM Bridge

Worker init sets `setWasmLogLevel(0)` (trace). JS `setLogLevel` / `ExtensionSession.setLogLevel()` syncs to Rust so `tracing::trace!` and coarser levels share the same gate.

## What Gets Logged at Trace

| Layer | Examples |
|-------|----------|
| JS main | `runCell_start`, `postAndWait`, `asyncRelay`, `executeContextCommand` |
| JS worker | `onmessage`, `sessionQueue_enqueue`, `runCell_start`, `extensionDispatch` |
| Rust WASM | `run_cell_async_loop_*`, `eval_start`, `trigger_async`, `resume_*`, `handle_command_*` |

## Correlation IDs

| ID         | Source |
|------------|--------|
| `runId`    | `ExtensionSession.runCellAsync()` (JS) |
| `callId`   | Worker message / pending call map |
| `batch_id` | `run_cell_async_loop` (Rust) |

## Log Format

### JavaScript

```
[extension-js][namespace] event key=value
```

### Rust (WASMLayer)

```
TRACE crates/web-js-core/src/session.rs:345 eval_start: code_len=42 execution_count=1
```

## Warning

Trace logging on cells with many sequential `await`s can be **very noisy** and may contribute to wasm32 stack pressure. Use `error` or `none` for normal use; use `trace` only while debugging.

## Known Limitations

1. **background.js / content-script** — independent hardcoded levels unless updated separately.
2. **web-js playground WASM** — lazy-loaded; its startup log is separate from extension worker tracing.
