# Issues

## Issue 1: Single-slot async bridge blocks Promise.all and concurrent async operations

**Status:** Open
**Severity:** High
**Area:** `crates/web-js-core/src/state.rs`, `crates/web-js-core/src/globals.rs`, `crates/web-js-base/src/session.rs`

### Problem

QuickJS is a full JS runtime with native `Promise`, `async/await`, and microtask queue support. However, the host bridge in web-js constrains all async operations to a single pending slot (`Option<AsyncCommand>` in `HostState`), making concurrent async operations impossible.

This means the following valid JS code breaks:

```js
// Promise.all hangs — only the LAST fetch ever gets resolved
const [users, posts] = await Promise.all([
  web.fetch("https://api.example.com/users"),
  web.fetch("https://api.example.com/posts"),
]);
```

The second `__webJsTriggerAsync` call overwrites `pending_async_command`, orphaning the first Promise's resolve/reject forever.

Similarly, fire-and-forget patterns don't work as expected:

```js
web.fetch("https://api.example.com/log"); // never resolves
console.log("done"); // runs, but cell stays in AsyncPending state forever
```

### Root Cause

`HostState.pending_async_command` is `Option<AsyncCommand>` (single slot), not `Vec<AsyncCommand>` (queue).

Related code:
- `crates/web-js-core/src/state.rs` — `pending_async_command: Option<AsyncCommand>` field
- `crates/web-js-core/src/globals.rs` — `__webJsTriggerAsync` overwrites the slot on each call
- `crates/web-js-base/src/session.rs` — `run_cell_async_loop` processes one command at a time

### Proposed Fix

Change the async bridge to support multiple in-flight commands:

1. Replace `pending_async_command: Option<AsyncCommand>` with `pending_async_commands: Vec<AsyncCommand>` (or a map keyed by call_id)
2. After cell evaluation, return all pending commands to the host
3. Host executes commands concurrently (e.g., multiple fetches in parallel)
4. On each resolve, call `resume_cell` to resolve the corresponding Promise and drain microtasks
5. Repeat until no pending commands remain

This is how `qjs` CLI and [quickjs-emscripten](https://github.com/justjake/quickjs-emscripten) handle async — multiple deferred promises resolved independently, with `JS_ExecutePendingJob` drained after each resolution.

### Impact

- Unlocks `Promise.all`, `Promise.race`, `Promise.allSettled`
- Unlocks fire-and-forget patterns (e.g., logging, background fetch)
- Makes the runtime behave like a real JS environment
- web-lua has the same single-slot limitation and could benefit from the same fix
