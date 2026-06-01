# Bug Report: `web.sleep` and Async API Parameter Type Mismatch

## Summary

`web.sleep(300)` and other async APIs that accept numeric parameters fail in the **Chrome extension context** with:

```
Runtime error: Error: Invalid parameters for sleep: invalid value for field 'duration' (Expected bigint, received number)
```

The same code works in the **web notebook context** because the two contexts use different parameter validation paths.

---

## Root Cause

### 1. JS Prelude Passes `number`, Extension Runner Expects `bigint`

**`crates/web-js-core/src/web/prelude.js`** (line 38):
```javascript
web.sleep = function(ms) { 
  return makeAsync('sleep')({duration: ms || 1000}); 
};
```

Calling `web.sleep(300)` sends `{duration: 300}` where `300` is a JavaScript `number`.

**`crates/extension-js/js/schemas.ts`** (line 70-72):
```typescript
export const SleepParamsSchema = z.object({
  duration: z.bigint(),  // ← rejects number, expects bigint
});
```

The extension runner uses Zod for parameter validation. `z.bigint()` strictly rejects `number` values.

### 2. Web Context vs Extension Context Handle Parameters Differently

| Context | Path | Behavior |
|---------|------|----------|
| **Web** | JS → `JSON.stringify` → Rust `serde_json::from_value::<SleepParams>` | `number` → `u64` works fine |
| **Extension** | JS → direct object → `runner.ts` Zod schema | `number` → `z.bigint()` fails |

### 3. Additional Field Name Mismatch

`page.wait()` and `sidepanel.wait()` have a **field name mismatch**:

**Prelude sends `ms`:**
```javascript
page.wait = function(ms) { 
  return makeAsync('page_wait')({ms: ms !== undefined ? ms : 1000}); 
};
```

**Schema expects `duration`:**
```typescript
export const PageWaitParamsSchema = z.object({
  duration: z.bigint().default(1000n),
});
```

---

## Affected APIs

All async APIs that pass numeric parameters from JS prelude to extension runner:

### `web.*` namespace
- `web.sleep(ms)` — sends `{duration: number}`

### `page.*` namespace
- `page.wait(ms)` — sends `{ms: number}` but schema expects `{duration: bigint}`

### `sidepanel.*` namespace
- `sidepanel.wait(ms)` — sends `{ms: number}` but schema expects `{duration: bigint}`

### `chrome.*` namespace (indirectly)
Any chrome API that accepts numeric params through the same pipeline may be affected if the schema uses `z.bigint()`.

---

## Affected Schema Fields

In `crates/extension-js/js/schemas.ts`, these fields use `z.bigint()` and will reject `number`:

| Schema | Field | Line |
|--------|-------|------|
| `FetchParamsSchema` | `timeout` | 67 |
| `SleepParamsSchema` | `duration` | 71 |
| `PageWaitParamsSchema` | `duration` | 88 |
| `SidepanelWaitParamsSchema` | `duration` | 203 |
| `SidepanelSnapshotParamsSchema` | `max_nodes` | 208 |
| `SidepanelSnapshotTextParamsSchema` | `max_nodes` | 212 |
| `SidepanelSnapshotDataParamsSchema` | `max_nodes` | 216 |
| `DomSnapshotParamsSchema` | `max_nodes` | 220 |
| `DomSnapshotTextParamsSchema` | `max_nodes` | 224 |
| `FsReadRangeParamsSchema` | `offset` | 255 |
| `FsUpdateParamsSchema` | `offset` | 261 |

---

## Recommended Fix

### Option A: Coerce in Schema (Recommended)

Change `z.bigint()` to `z.coerce.bigint()` in `schemas.ts`. This accepts both `number` and `bigint` and automatically converts:

```typescript
// Before
export const SleepParamsSchema = z.object({
  duration: z.bigint(),
});

// After
export const SleepParamsSchema = z.object({
  duration: z.coerce.bigint(),
});
```

**Pros:**
- Minimal change
- Backward compatible (still accepts bigint)
- Fixes all affected APIs at once

**Cons:**
- Slight precision loss for very large numbers (> 2^53)
- But for sleep durations and timeouts, this is not a concern

### Option B: Fix Prelude to Send BigInt

Change JS prelude to wrap values in `BigInt()`:

```javascript
web.sleep = function(ms) { 
  return makeAsync('sleep')({duration: BigInt(ms || 1000)}); 
};
```

**Pros:**
- Type-correct from the source

**Cons:**
- `BigInt` values cannot be `JSON.stringify`'d, which breaks the web context path
- Would need separate prelude logic for web vs extension

### Option C: Fix Field Name Mismatch

Regardless of Option A or B, also fix the field name mismatch in `prelude.js`:

```javascript
// Before
page.wait = function(ms) { 
  return makeAsync('page_wait')({ms: ms !== undefined ? ms : 1000}); 
};

// After
page.wait = function(ms) { 
  return makeAsync('page_wait')({duration: ms !== undefined ? ms : 1000}); 
};
```

Same for `sidepanel.wait`.

---

## Files to Modify

1. **`crates/extension-js/js/schemas.ts`** — Change `z.bigint()` to `z.coerce.bigint()` for all affected fields
2. **`crates/web-js-core/src/web/prelude.js`** — Fix `page.wait` and `sidepanel.wait` field names from `ms` to `duration`
3. **Rebuild**: `npm run wasm` and `npm run build` in `web/` directory

---

## Test Case

This code should work in both web and extension contexts after the fix:

```javascript
// Sleep with countdown
for (let i = 3; i > 0; i--) {
  console.log(`Sleeping... ${i}`);
  await web.sleep(300);
}
console.log('Awake!');

// Parallel sleeps
console.log('Starting parallel timers...');
const t1 = web.sleep(200).then(() => 'Timer A done');
const t2 = web.sleep(400).then(() => 'Timer B done');
const t3 = web.sleep(600).then(() => 'Timer C done');
const results = await Promise.all([t1, t2, t3]);
results.forEach(r => console.log(r));
```

---

## Related Code Paths

- `crates/web-js-core/src/web/prelude.js` — JS API wrappers
- `crates/web-js-core/src/globals.rs` — `__webJsTriggerAsync` (sends params to host)
- `crates/web-js-base/src/session.rs` — `run_cell_async_loop` (batches async commands)
- `crates/extension-js/src/session.rs` — `ExtensionSession::handle_command` (dispatches to runner)
- `crates/extension-js/js/runner.ts` — `normalizeParams` + Zod schema validation
- `crates/extension-js/js/schemas.ts` — Zod schemas for parameter validation

---

*Reported: 2026-05-31*
*Status: Confirmed, fix pending*
