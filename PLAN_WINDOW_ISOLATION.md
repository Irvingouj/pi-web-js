# Plan: Per-Window Session Isolation (VSCode Model)

> Status: **Implemented (Phases 1–4 done) — pending final review**
> Phase 4 (Plan B): tab tracking moved into per-session `TabTracker`; chrome.tabs.* listeners now windowId-scoped; tab-drag-between-windows handled (drag-out drops the pointer, drag-in doesn't interrupt the agent).
> Related: GitHub issue #5 (G2 — per-session isolation boundary), AGENTS.md "extension boundary" invariant.
> Owner: TBD

## 0. Open Questions / Unknowns (RESOLVE BEFORE IMPLEMENTING)

These must be answered before coding starts. They are the real risks.

### Q-1 ✅ AUDITED — medium mechanical refactor, low risk
**Audit result (2026-07-06):** The main dispatch chain **already threads `signal` end-to-end** — no signature changes needed on the trunk:
```
ExtensionSession.abortController.signal
  → executeMainThreadCommand(cmd, signal)   [extension-session.ts:446]
    → resolveSignal(signal)                  [command.ts:29]   ← just delete the getRunnerSignal() fallback
      → dispatchCommand(command, signal)
        → dispatchTool(action, params, callId, runId, signal)   [tool-registry.ts]
          → tool.handler(params, ctx)   where ctx.signal = signal   [CallContext]
```
So `command.ts:31` and `tool-registry.ts:272` are **simple** (signal already in scope — delete the global fallback).

The real work is **5 functions in `execute.ts` + `fetch.ts` whose signatures don't currently take signal**, but whose callers (page.ts/tab.ts handlers) already have `ctx.signal`. Each = add `signal?: AbortSignal` param + 1-line passthrough at call site:

| Function | Current signature | Change |
|---|---|---|
| `handleFetch` | `(params)` | `(params, signal)`; `network.ts` handler reads `_ctx.signal` |
| `preflightDomTab` | `(tabId)` | `+(tabId, signal?)` |
| `pingTabContentScript` | `(tabId, timeoutMs)` | `+(..., signal?)` |
| `waitForTabLoad` | `(tabId, timeoutMs, options?)` | add `signal?: AbortSignal` to options |
| `navigateTab` | `(options)` | add `signal?` to `NavigateTabOptions` (passes to the three above) |

**Verdict:** ~5 signatures + 6–8 call-site passthroughs + delete 3 global exports. Net **60–90 lines**, concentrated in `execute.ts` / `page.ts` / `tab.ts` / `network.ts` / `fetch.ts`. Pure parameter threading, no control-flow change. **Low risk.** Phase 1 is **not** split — it's one coherent change.

Full call-site table (all 9 sites confirmed, no orphans via `rg`):
| Site | Function | signal reachable? | difficulty |
|---|---|---|---|
| `command.ts:31` | `resolveSignal(relaySignal?)` | yes (relaySignal) | simple |
| `command.ts` `dispatchCommand` | `(command, signal)` | yes (param) | simple |
| `tool-registry.ts:272` | `dispatchTool(..., signal?)` | yes (param) | simple |
| `fetch.ts:14` | `handleFetch(params)` | via `_ctx.signal` | medium |
| `execute.ts:34` | `preflightDomTab(tabId)` | via caller ctx | medium |
| `execute.ts:62` | `pingTabContentScript(...)` | via caller ctx | medium |
| `execute.ts:79` | (inside ping loop) | same as :62 | medium |
| `execute.ts:156` | `waitForTabLoad(...)` | via options | medium |
| `runtime.ts:7` | re-export only | n/a | simple (delete) |

### Q-2 ⚠️ service worker wake-up vs windowId capture
**What we know:** `chrome.windows.getCurrent()` is called in `ExtensionSession.init()` on the **sidepanel document** (not the SW). Sidepanel documents are per-window and persistent while open, so `windowId` is stable for the document's lifetime.
**What we DON'T know:** Does anything in our flow rely on the **service worker** knowing the windowId? The SW (`web/public/background.js`) today does almost nothing (opens sidepanel on action click). If future features (issue #3 background event runtime) need window-scoped routing, capturing windowId only in the panel may be insufficient.
**Risk:** Low for this plan (we only need windowId on the panel/main-thread side for the tab-ownership check). But worth noting that SW-side window awareness is a separate, future concern.
**Action:** Confirm windowId is captured and used **only** in the sidepanel main thread for this plan. Document that SW-side window routing is out of scope.

### Q-3 ⚠️ What error should cross-window access produce, and does it leak info?
**What we know:** Plan proposes `E_TAB_NOT_OWNED` when `tab.windowId !== this.windowId`.
**What we DON'T know:** Whether revealing "tab N belongs to window M" in the error message is acceptable, or whether we should give a generic "tab not accessible" to avoid leaking other windows' tab existence.
**Action:** Decide error wording. Recommendation: generic `E_TAB_NOT_OWNED: "Tab <id> is not accessible from this session"` without leaking the owning window id.

### Q-4 (lower priority) `activeTabId` fire-and-forget init
**What we know:** `tab-context.ts:39` does `void chrome.tabs.query(...)` without await, so `activeTabId` may be null at session ready. This is pre-existing, not introduced by this plan, but per-window isolation makes it more visible (each window race-independently).
**Action:** Out of scope for this plan — file as a follow-up. Note it under §7.

---

## 1. Goal

Enable a **VSCode-style multi-window model**: each Chrome window runs an **independent agent session** that operates only on tabs in its own window. Windows share the extension, chrome APIs, and tool registry, but never interfere with each other's runtime state, active tab, or in-flight cells.

Concretely, after this plan:
- Opening Chrome window B while window A's agent is mid-cell does **not** affect A.
- Window A's agent calling `page.click(refId)` can **never** hit a tab in window B (rejected with `E_TAB_NOT_OWNED`).
- The extension-js runtime supports multiple concurrent `ExtensionSession` instances safely within a single document (defensive — needed for tests; in production each window's sidepanel is already a separate JS realm).

## 2. Why / Problem Statement

Today the runtime is **hard-locked to a single session per document** by one module-level global:

- `crates/extension-js/js/src/shared/main/tool-registry.ts:44` — `let runnerAbortController: AbortController | null`
- Read by `getRunnerSignal()` → consumed by `command.ts:31`, `fetch.ts:14`, `tab/execute.ts` (×4), `tool-registry.ts:272`.
- `ExtensionSession` constructor is `private` (`extension-session.ts:123`) enforcing singleton.
- Browsergent mirrors this: `extension-js-client.ts:97-112` is a `private static instance` singleton, with a file-header comment explicitly stating *"Why singleton: extension-js's runner uses a module-level AbortController. Multiple ExtensionSession instances would race."*

The good news (verified during investigation):
- All other state is **already per-session**: QuickJS Runtime/Context (`session.rs`), `this.worker`, `this.pendingCalls`, `this.inFlightRelays`, `this.abortController` (instance field exists at `extension-session.ts:200`), worker-side `runAbortControllers` Map (`worker.ts:160`), worker-side `portInFlightCalls` Map (`worker.ts:265`).
- Content scripts inject per-tab per-frame (`manifest.json:43-48`: `<all_urls>`, `all_frames:true`, `document_start`) → Chrome guarantees realm isolation; content-script lease/registry (`observation-lease.ts`, `registry.ts`) need **zero changes**.
- Chrome naturally creates one sidepanel document per window → each gets its own JS realm → module globals like `activeTabId` (`tab-context.ts:4`) are **already per-window in production**, just not by design.
- `windows` permission already granted (`manifest.json:17`).

So the entire problem reduces to: **remove the one module-global abort controller, then add a window-ownership check.**

## 3. Non-Goals

- Multi-session within a **single** sidepanel document (not needed; Chrome gives one realm per window).
- Per-tab registry/lease keying in the content script (not needed; per-tab realm isolation + window check suffices).
- **Gate native-parity `chrome.*` tools** (`chrome.tabs.sendMessage`, `chrome.scripting.executeScript`, etc.) behind the window-ownership check. These transport opaque `NativeArgs` (AGENTS.md L37-40) and are the agent's explicit escape hatch to raw Chrome; reshaping them to extract `tabId` would violate the transparency invariant. **The E_TAB_NOT_OWNED guarantee therefore covers project-owned `page.*` / `web.tab.*` only**, not direct `chrome.*` calls. A future hardening could add an optional ownership gate inside the existing `parseExecuteScriptSpec` / parity interceptors if a stricter policy is wanted.
- SW-side window routing / the background event runtime (issue #3) — separate work.
- Persisting/restoring named sessions across SW restarts.
- Handling tab moves across windows beyond rejecting cross-window access.
- Changing any `page.*` / `web.tab.*` **schema** — agent-facing API stays identical. windowId/sessionId are injected in the runner layer, invisible to cells.

## 4. Architecture (Target)

```
Chrome Window A                         Chrome Window B
  sidepanel doc (own JS realm)            sidepanel doc (own JS realm)
    ExtensionSession {                      ExtensionSession {
      windowId: A,                            windowId: B,
      abortController: <inst>,  ← no global    abortController: <inst>,
      worker: <inst>,                          worker: <inst>,
      QuickJS Runtime: <inst>                  QuickJS Runtime: <inst>
    }                                       }
    │ page.click / web.tab.*                 │ page.click / web.tab.*
    ▼ tab-ownership check                    ▼ tab-ownership check
    [tab.windowId === A] ✅                  [tab.windowId === B] ✅
    │  cross-window → E_TAB_NOT_OWNED ❌     │
    ▼                                        ▼
  content scripts in A's tabs only         content scripts in B's tabs only
  (Chrome realm isolation, unchanged)      (Chrome realm isolation, unchanged)
```

Key invariant: **`signal` flows from `session.abortController.signal` down the call chain; no module-global default.** Cross-window operations are rejected before reaching `chrome.tabs.sendMessage`.

## 5. Implementation Phases

TDD per AGENTS.md: each phase = one red test → minimal impl → green. Do **not** batch.

### Phase 1 — Decouple abort signal from module global (the blocker)

*Audited: see §0 Q-1. Net ~60–90 lines, 5 signature changes, low risk.*

**Red test** (`crates/extension-js/js/test/session-isolation.test.ts`, new):
```
"two ExtensionSession instances in one document do not race on abort"
- init sessionA, sessionB (same document, mock chrome.runtime.id)
- start a long cell in sessionA
- call sessionB.stopWith(...)  ← must NOT abort sessionA's cell
- assert sessionA's cell completes, sessionB's is stopped
```
Also:
```
"singleton constructor removed: `new ExtensionSession()` is callable" (compile-time/type test)
```

**Implementation:**

`crates/extension-js/js/src/shared/main/tool-registry.ts`
- Delete `let runnerAbortController` (line 44).
- Delete `setRunnerAbortController` (lines 46-48) and module-global `getRunnerSignal` (lines 50-52).
- Change `throwIfAborted()` → `throwIfAborted(signal?: AbortSignal)`: check `signal?.aborted` instead of the global (lines 54-58).
- `dispatchTool` (line 252 / 272): pass the incoming `signal` arg to `throwIfAborted(signal)`.

`crates/extension-js/js/src/main/runner/command.ts`
- `resolveSignal(signal?: AbortSignal)`: drop `getRunnerSignal()` fallback. If no signal, return `new AbortController().signal` (never aborts) — and add a `// TODO require signal` note. Prefer: require signal (see Q-1 audit).

`crates/extension-js/js/src/main/runner/runtime.ts`
- Remove the `throwIfAborted` re-export (line 7) once no longer used.

`crates/extension-js/js/src/main/runner/fetch.ts`
- `handleFetch(params)` → `handleFetch(params, signal?)`; `throwIfAborted(signal)`.
- Update `network.ts` handler to pass `_ctx.signal`.

`crates/extension-js/js/src/main/runner/tab/execute.ts`
- `preflightDomTab(tabId)` → `+(tabId, signal?)`; `throwIfAborted(signal)` at line 34.
- `pingTabContentScript(tabId, timeoutMs)` → `+(..., signal?)`; `throwIfAborted(signal)` at lines 62, 79.
- `waitForTabLoad(tabId, timeoutMs, options?)` → add `signal?: AbortSignal` to options; `throwIfAborted(signal)` at line 156.
- `navigateTab(options)` → add `signal?` to `NavigateTabOptions`; pass through to the three above.

`crates/extension-js/js/src/main/runner/tools/page.ts`, `tab.ts`
- Each handler: extract `ctx.signal` from `CallContext` and pass to `preflightDomTab` / `pingTabContentScript` / `waitForTabLoad` / `navigateTab`.

`crates/extension-js/js/src/main/session/extension-session.ts`
- Calls at lines 555/558 (`preflightDomTab` / `pingTabContentScript`): pass `this.abortController.signal`.

`crates/extension-js/js/src/main/session/extension-session.ts`
- Constructor `private constructor()` (line 123) → `constructor()`. Initialize `this.abortController = new AbortController()` in the constructor body (not lazily in stopWith).
- `init()` (line 134): remove `setRunnerAbortController(new AbortController())`. Constructor handles it now.
- `stopWith()` (lines 911-914): remove `setRunnerAbortController(this.abortController)`; keep `this.abortController.abort()`. (Optionally create a fresh controller so post-stop state is clean.)
- Rewrite doc comment (lines 129-131): "per-session instance; multiple sessions across windows are safe."
- Ensure `this.abortController.signal` is passed into `executeContentScriptCommand` / `dispatchCommand` / `sendToFrame` (already accepts `signal` param at `sendToFrame` line 633).

**Done when:** red test green; existing test suite green; `rg "getRunnerSignal|setRunnerAbortController"` returns only (possibly) test references.

### Phase 2 — Cross-window tab ownership check

**Red test** (`crates/extension-js/js/test/tab-ownership.test.ts`, new):
```
"page.click on a tab in another window is rejected with E_TAB_NOT_OWNED"
- mock chrome.tabs.get to return { windowId: 999 }
- session.windowId = 1
- call executeContentScriptCommand for page_click on tabId 5
- assert response: { ok:false, error:{ code:"E_TAB_NOT_OWNED" } }
- assert chrome.tabs.sendMessage was NOT called
```
Also:
```
"web.tab.snapshot with explicit tabId in own window succeeds"
"page.* on active tab in own window succeeds"
```

**Implementation:**

`crates/extension-js/js/src/main/session/extension-session.ts`
- Add field `private readonly windowId: number`.
- In `init()`, after `initTabContext(chrome)`: `this.windowId = (await chrome.windows.getCurrent()).id`. (Fallback: if `chrome.windows` unavailable, `windowId = -1` and skip the check — keep web-js demo working, per AGENTS.md "web-js compatibility is secondary but not broken".)
- In `executeContentScriptCommand`, after `resolveTabId(...)` and **before** `preflightDomTab`/`sendMessage`:
  ```ts
  if (this.windowId >= 0) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.windowId !== this.windowId) {
      return { ok: false, error: {
        message: `Tab ${tabId} is not accessible from this session`,
        code: "E_TAB_NOT_OWNED", category: "validation",
      }};
    }
  }
  ```
- This guard covers both `page.*` (resolved active tab) and `web.tab.*` (explicit tabId).

**Done when:** red tests green; cross-window `sendMessage` never fires.

### Phase 3 — Consumer adaptation (Browsergent + web/ demo)

`Browsergent/src/sidepanel/extension-js-client.ts`
- Remove `private static instance` + `getInstance()` (lines 97-112).
- Remove the "singleton mandatory" file-header comment (lines 1-9) — its sole justification (module-global AbortController) no longer exists after phase 1.
- Construct one `ExtensionSession` per sidepanel document lifecycle.

`web/src/hooks/useExtensionKernel.ts`
- `globalSession` (line 18) is **already per-document** — no functional change required. Optionally rename to `windowSession` for clarity.

**Done when:** Browsergent builds; two Chrome windows each run an agent cell without mutual interference (manual E2E).

### Phase 4 — Hardening & regression tests

- Add to `crates/extension-js/js/test/`:
  - "concurrent sessions: abort one does not abort the other" (phase 1, expanded).
  - "concurrent sessions: each has independent activeTabId" (simulate two realms in one test doc).
  - "cross-window page.* and web.tab.* both rejected" (phase 2, expanded).
- Run `npm run wasm` if prelude touched (it is **not** in this plan — confirm no prelude edits).
- `npm run build` → load `web/dist/` as unpacked → manual two-window smoke test.

## 6. Files Touched (summary)

| File | Phase | Change |
|---|---|---|
| `crates/extension-js/js/src/shared/main/tool-registry.ts` | 1 | delete module-global abort; `throwIfAborted(signal)` |
| `crates/extension-js/js/src/main/runner/command.ts` | 1 | drop global fallback in `resolveSignal` |
| `crates/extension-js/js/src/main/runner/runtime.ts` | 1 | thread `signal` |
| `crates/extension-js/js/src/main/runner/fetch.ts` | 1 | `throwIfAborted(signal)` |
| `crates/extension-js/js/src/main/runner/tab/execute.ts` | 1 | `throwIfAborted(signal)` ×4 |
| `crates/extension-js/js/src/main/session/extension-session.ts` | 1+2 | public ctor; instance abort; `windowId` field + check |
| `crates/extension-js/js/test/session-isolation.test.ts` | 1 | new |
| `crates/extension-js/js/test/tab-ownership.test.ts` | 2 | new |
| `Browsergent/src/sidepanel/extension-js-client.ts` | 3 | drop singleton |
| `web/src/hooks/useExtensionKernel.ts` | 3 | (optional rename) |

Untouched (verified not needed): `session.rs`, `worker.ts`, content-script (`registry.ts`, `observation-lease.ts`, `handlers.ts`), `tab-context.ts`, `prelude.js`, `manifest.json`.

## 7. Follow-ups (all RESOLVED in this change)

- ✅ **Parity-tool ownership gate**: `chrome.tabs.sendMessage` / `chrome.scripting.executeScript` / `insertCSS` / `removeCSS` / `tabs.update|remove|reload` now read tabIds out of untouched NativeArgs and reject cross-window access via `assertTabOwnership` (`chrome/tab-ownership.ts`), threaded via a new `windowId?` field on `CallContext`. NativeArgs transparency preserved (read-only extraction).
- ✅ **Two-session integration test**: `session-isolation.test.ts` now has integration-level tests proving two real `ExtensionSession` instances in one document don't interfere (stop one, the other's in-flight relay survives; independent AbortControllers).
- ✅ **Per-cell main-thread abort**: evaluated — pre-existing granularity (session-level). Not a regression; left as-is.
- ✅ **`activeTabId` race**: `initTabContext` is now async and awaited in `init()`; initial `tabs.query` resolves before the session reports ready.
- ✅ **Tab lifecycle cleanup**: `chrome.tabs.onRemoved` listener clears `activeTabId` when the active tab closes (graceful when `onRemoved` absent in mocks/older Chrome via optional chaining). `webNavigation.onCommitted` evaluated and **not added** — `onUpdated(status:complete)` + content-script `refindByFingerprint` already cover cross-domain lease invalidation; adding onCommitted would duplicate without benefit.
- ✅ **refId namespacing**: assessed **safe, no change needed**. Each tab/frame is an independent content-script realm with its own `counter`; per-window ownership guarantees one tab is never touched by two sessions. refId stays `e<N>`.
- ✅ **Signal-threading style**: kept mixed (positional for single-shot helpers, options-bag for rich ones) with a justifying comment at the top of `execute.ts`.
- ✅ **`captureWindowId` inline**: evaluated and **kept as a method** — `windowId` is an instance field that must be set on the constructed session, so a method (called after `new ExtensionSession()`) is the clean form.

## 7.5 Phase 4 — Plan B: session-owned tab tracking (DONE)

**Problem (post-Phase 1–3):** `activeTabId` and all `chrome.tabs.*` listeners
still lived in module globals (`tab-context.ts`). Chrome gives each window its
own sidepanel JS realm, so in production this was per-window by accident — but
it was the wrong abstraction: the session didn't own its tab state, and
chrome.tabs.* events are **profile-broadcast** (Chromium
`EventRouter::BroadcastEvent`), so every sidepanel document received every tab
event for every window. There was no windowId filtering, and no handling for
tabs dragged between windows.

**Decision: Plan B** (the proper solution, per user). Move all tab tracking
into a per-session `TabTracker` owned by `ExtensionSession`.

### What changed

- **New `session/tab-tracker.ts`** — `TabTracker` class holds:
  - `activeTabId: number | null` (the pointer)
  - `windowId: number | null` (the scope)
  - all `chrome.tabs.*` listeners as bound instance methods, **each filtered
    by `windowId`**: `onActivated`, `onUpdated`, `onRemoved`, `onAttached`,
    `onDetached`.
  - `init()` registers listeners + resolves the initial active tab (awaited
    before session ready); `dispose()` removes listeners.
  - `resolveActiveTabId()` (cached + lazy re-query, windowId-scoped).
  - `resolveTabId(tabPolicy, params)` (explicit-param-wins, else active tab).

- **`ExtensionSession`** now owns `tabTracker: TabTracker | null` and:
  - `bindTabContext()` (private, awaited in `init()`) captures `windowId`
    via `chrome.windows.getCurrent()` then constructs + inits the tracker.
  - public `resolveActiveTabId()` / `getActiveTabId()` / `setActiveTabId()`
    delegate to the tracker (test + handler surface).
  - `resolveTabId` call in the relay path uses `this.tabTracker.resolveTabId`
    (fallback to module-global `resolveTabId` only when no tracker — web-js demo).
  - `stopWith`/dispose calls `this.tabTracker?.dispose()`.

- **`CallContext`** gains `resolveActiveTab?: () => Promise<number | null>`,
  injected by the session when dispatching. Threaded through `dispatchTool`
  → `dispatchCommand` → `executeMainThreadCommand`. `page.ts`/`tab.ts`
  handlers prefer `ctx.resolveActiveTab` and fall back to the module-global
  `resolveActiveTabId` only when no session is bound (web-js demo).

- **`tab-context.ts` slimmed**: the module-global listener machinery
  (`initTabContext`, `removeTabContextListeners`, `initExtensionListeners`,
  `removeExtensionListeners`, and the listener constants) is **deleted**. What
  remains is the listener-less demo fallback: `setActiveTabId`/`getActiveTabId`/
  `resolveActiveTabId`/`resolveTabId` for the web-js target (no Chrome window,
  no session tracker). The re-export barrel (`runtime.ts`/`index.ts`) dropped
  the deleted symbols.

### Tab-drag-between-windows handling

Chrome fires, in order, when a tab is dragged out of window A into new window B:
1. `onDetached(tabId, { oldWindowId: A, oldPosition })`
2. `onAttached(tabId, { newWindowId: B, newPosition })`
3. `onActivated({ tabId, windowId: B })` (in window B)
4. `windows.onCreated` (for the new window)

`TabTracker` handles these per scope:
- **Drag OUT** (`onDetached`, `oldWindowId === ours`, tab === active):
  drop the pointer → next `page.*` lazily re-resolves to the new active tab
  in our window (or `E_NO_TAB` if our window is now empty). The gone tab is
  never addressed.
- **Drag IN** (`onAttached`, `newWindowId === ours`): **no auto-grab** — we do
  not interrupt the running agent. The subsequent `onActivated` in our window
  (if Chrome fires one) re-points naturally; if not, the next `page.*`
  re-resolves. This matches the VSCode model: dragging a tab into a window
  doesn't steal focus from the agent running there.
- **Other-window events**: every listener returns early when the event's
  windowId ≠ ours, so profile-broadcast noise never mutates our pointer.

### Tests (new/updated)

- `test/session-isolation.test.ts` — "TabTracker: init + lifecycle" (7 unit
  tests: init resolves initial tab; onRemoved clears for our window only;
  onRemoved for other windows ignored; drag-out drops pointer; drag-out for
  other windows ignored; lazy re-resolve after drop; dispose idempotent).
- "Plan B: tab drag-out / drag-in" (2 integration tests via `ExtensionSession`:
  drag-out clears cached pointer; other-window drag-out ignored).
- `test/registry/tab-context.test.ts` — rewritten to test `resolveTabId`/
  `resolveActiveTabId` demo fallback + `TabTracker` init idempotency.
- Existing Phase 2 ownership tests updated: query mocks now return
  `windowId` so the tracker adopts the initial active tab.

### Definition of Done (Phase 4)

- [x] 916/916 tests green; `tsc` clean; Browsergent typecheck clean.
- [x] No module-global listener state in `tab-context.ts`.
- [x] `chrome.tabs.*` listeners filtered by `windowId` (profile-broadcast safe).
- [x] Drag-out drops the active-tab pointer; drag-in does not interrupt.
- [x] `ExtensionSession` owns its `TabTracker`; demo path still works via fallback.

## 8. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Phase 1 signal-threading is deeper than estimated (Q-1) | Medium | Run Q-1 audit first; if deep, split phase 1 into 1a (decouple tool-registry) and 1b (thread through tab/execute). |
| A call site loses abort coverage silently | Low-Med | Phase 1 red test + `rg throwIfAborted` review at PR time. |
| Cross-window check slows hot path (`chrome.tabs.get` per call) | Low | Cache `{tabId → windowId}` invalidated on `onUpdated`/`onRemoved`. Only add if profiled. |
| Browsergent has other singleton assumptions beyond the client | Low | Verify in phase 3 manual test; the client file header explicitly names only the AbortController as the reason. |

## 9. Definition of Done

- [ ] Q-1, Q-2, Q-3 resolved and recorded.
- [x] Phase 1 red test green; `rg "getRunnerSignal\|setRunnerAbortController"` clean in `crates/extension-js/js/src`.
- [x] Phase 2 red tests green; cross-window `sendMessage` never reached.
- [ ] `npm run build` succeeds; `web/dist/` loads.
- [ ] Manual two-window smoke test: cell in window A unaffected by window B's stop/restart.
- [ ] Browsergent builds and runs per-window without the singleton shim.
- [ ] Issue #5 G2 ("per-session isolation boundary") can be marked resolved with PR link.
