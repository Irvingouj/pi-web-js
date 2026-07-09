# web-js / extension-js — Window Isolation Handoff

**Date:** 2026-07-09  
**Status:** Phases 1–4 implemented; Browsergent integration fragile at product layer  
**Consumer:** `../Browsergent` (symlinked `@pi-oxide/extension-js`)

## Error visibility

- Logger prefix: `[extension-js][namespace]` — `error` always uses `console.error` (shows in extension Errors).
- Init failures log `code=E_EXTJS_INIT`; window bind failures `E_WINDOW_BIND`; worker uncaught `E_EXTJS_WORKER_*`.
- Browsergent host diagnostics use `[browsergent][error]` — see Browsergent `HANDOFF.md` crash diagnosis section.

---

## 1. What this repo provides

`@pi-oxide/extension-js` is the Chrome extension runtime Browsergent uses for `run_js` / `page.*` / `web.tab.*`. Window isolation was added so each Chrome window's agent session only touches tabs in that window.

**Plan doc:** [`PLAN_WINDOW_ISOLATION.md`](./PLAN_WINDOW_ISOLATION.md) (Phases 1–4 marked done)

### Public API (Browsergent-facing)

```typescript
// crates/extension-js/js/src/main/session/extension-session.ts

// Call once per sidepanel document
await ExtensionSession.init({ windowId?: number });

// Survivor panel after window merge
session.rebindWindow(newSurvivorWindowId);

session.getWindowId(): number | null;
```

| Method | When Browsergent calls it |
|--------|---------------------------|
| `init({ windowId })` | `ExtjsController.init()` on panel boot (`use-app-init.ts`) |
| `rebindWindow(wid)` | Survivor merge handler in `app.tsx` |
| `getWindowId()` | Diagnostics / relay routing |

### Ownership guarantee

For project-owned tools (`page.*`, `web.tab.*`):

- Tab must satisfy `tab.windowId === session.windowId`
- Cross-window → `E_TAB_NOT_OWNED` (generic message, no leak of other window id)
- **Not gated:** raw `chrome.*` parity tools (by design — see plan §3)

### TabTracker (Phase 4 / Plan B)

Per-session `TabTracker` replaces module-global `chrome.tabs.*` listeners:

- Listeners filtered by `windowId` (safe when many profiles/windows broadcast events)
- **Drag tab out** of our window → drop active-tab pointer (lazy re-resolve on next `page.*`)
- **Drag tab in** → no auto-grab (doesn't interrupt running agent)
- `rebindWindow()` re-scopes queries after Browsergent merge rebind

Tests: `crates/extension-js/js/test/session-isolation.test.ts`

---

## 2. Relationship to Browsergent

```
web-js/crates/extension-js/js/pkg
    ↑ symlink
Browsergent/node_modules/@pi-oxide/extension-js
```

Browsergent wraps extension-js in:
- `src/sidepanel/extension-js-client.ts` — singleton client, relay callback
- `src/controllers/extjs-controller.ts` — init / rebindWindow / dispose

**Browsergent owns** (not this repo):
- Session list, IDB persistence, merge/split lifecycle coordination
- Multi-session worker hosting in the **side panel document** (`RunSupervisor` `hosting: "local"`). Closing the panel ends runs (product intent — not extension-js’s job to keep them alive).
- In-panel “background” = N concurrent sessions while the panel stays open (not panel-close survival)
- Side panel UI, agent loop, provider plumbing

**web-js owns:**
- Per-window tab ownership (`E_TAB_NOT_OWNED`)
- QuickJS runtime per `ExtensionSession`
- Content script injection / observation lease
- WASM build (`extension_js_bg.wasm`)

---

## 3. Build & publish

```bash
cd /Users/oujunyi/code/web-js

# Full build (WASM + JS pkg)
npm run build

# extension-js tests (916+ when last green)
cd crates/extension-js/js && npm test

# Typecheck
cd crates/extension-js/js && npx tsc --noEmit
```

**Browsergent must rebuild after web-js changes:**
```bash
cd ../Browsergent && npm run build
# Reload extension in Chrome
```

### Package output

| Path | Contents |
|------|----------|
| `crates/extension-js/js/pkg/` | npm package root (`extension_js.js`, wasm) |
| `crates/extension-js/pkg/` | Rust wasm-bindgen output (intermediate) |

Browsergent's vite build copies `content-script.js`, `extension_js.js`, `worker.js` from the npm package into `dist/`.

---

## 4. What Browsergent still needs from web-js

### Shipped ✅
- `init({ windowId })` — capture panel window at boot
- `rebindWindow(wid)` — survivor merge rebind
- Per-window tab ownership checks
- TabTracker window-scoped listeners

### Not required for current Browsergent slices
- Service-worker-side window routing (issue #3 — future)
- Offscreen document hosting — **out of Browsergent product scope** (panel close ends runs by design)
- Per-session OPFS namespaces (out of scope v1)

### If hardening cross-window chrome.* tools
Would need optional ownership gate in parity interceptors — **not started**; discuss before implementing (transparency invariant in AGENTS.md).

---

## 5. Known issues & fragility

### Browsergent-side (not extension-js bugs, but surfaces here)

| Issue | Symptom | Owner |
|-------|---------|-------|
| SW `type: "module"` missing | Panel won't open (status 15) | Browsergent manifest |
| `sessionRunRelay` loop | SW crash | Browsergent `background/index.ts` |
| False lifecycle merge | Crash on new tab | Browsergent coordinator |
| Panel close kills worker | **By design** (Browsergent: runs must not outlive panel) | Browsergent product rule |
| Singleton `ExtensionJsClient` | One client per panel doc (OK — one doc per window) | Browsergent |

### extension-js caveats

| Issue | Notes |
|-------|-------|
| `activeTabId` init race | `tab-context.ts` fire-and-forget query; each window races independently (Q-4 in plan) |
| `chrome.*` tools ungated | Agent can still call raw chrome APIs cross-window |
| Demo path without Chrome | `windowId: null` skips ownership checks (web playground only) |

### Test status (last known)

- extension-js: **916/916** unit tests (per PLAN_WINDOW_ISOLATION.md Phase 4)
- Browsergent unit: **1058/1058**
- Browsergent mock E2E: B7 green in isolation; **flaky under parallel load**
- Real DeepSeek smoke: **not run** for this workstream

---

## 6. Key files map

### extension-js JS (main thread / sidepanel)
| File | Role |
|------|------|
| `js/src/main/session/extension-session.ts` | Session lifecycle, init, rebindWindow, ownership assert |
| `js/src/main/session/tab-tracker.ts` | Per-window tab listeners + active tab pointer |
| `js/src/shared/main/tab-context.ts` | Demo fallback (no Chrome window) |
| `js/src/shared/main/command.ts` | Signal threading (Phase 1) |
| `js/test/session-isolation.test.ts` | Window isolation + TabTracker tests |

### extension-js Rust (WASM)
| File | Role |
|------|------|
| `src/session.rs` | `ExtensionSession` WASM binding |
| `src/browser_api.rs` | Chrome API registry |
| `src/lib.rs` | Crate entry |

### Browsergent integration touchpoints (read-only from this repo)
| Browsergent file | Calls |
|------------------|-------|
| `src/sidepanel/extension-js-client.ts` | WASM init, relay |
| `src/controllers/extjs-controller.ts` | `init({ windowId })`, `rebindWindow()` |
| `src/sidepanel/app.tsx` | `rebindWindow(survivor)` on merge |

---

## 7. Manual verification (two-window)

1. Build web-js + Browsergent; reload extension
2. Window A: open panel, run `run_js` that logs `page.tabs({})` — note `tabId`
3. Window B: open panel, run same — different active tab, same window scope
4. In A, try targeting B's tab explicitly → `E_TAB_NOT_OWNED`
5. Merge B into A → survivor panel calls `rebindWindow`; subsequent `page.*` uses A's tabs only

---

## 8. Next steps (recommended)

### For web-js (low urgency unless Browsergent hits tab bugs)
- [ ] Close Q-4 follow-up: await initial `activeTabId` in TabTracker.init
- [ ] Manual two-window smoke per PLAN §9 Definition of Done
- [ ] Optional: cache `tabId → windowId` if ownership checks show up in profiles

### For Browsergent integration (high urgency — see Browsergent HANDOFF)
- [ ] Stabilize SW + relay (Browsergent-side)
- [ ] Multi-window while panels open (not panel-close survival)
- [ ] Real-LLM smoke after stability

### Publishing
If Browsergent needs unpublished web-js changes:
```bash
cd crates/extension-js/js
npm version patch   # if needed
npm run build       # from repo root
# Browsergent symlink picks up pkg/ automatically
```

For npm publish: `scripts/publish-npm.js` (see `docs/releases.md`).

---

## 9. Error codes reference

| Code | Meaning | User-visible? |
|------|---------|---------------|
| `E_TAB_NOT_OWNED` | Tab belongs to another window | Yes — via agent trace |
| `E_NO_TAB` | No active tab in this window | Yes |
| (abort) | `AbortSignal` from session stop | Yes |

---

## 10. Architecture diagram

```
Chrome Window A                         Chrome Window B
  sidepanel (JS realm A)                  sidepanel (JS realm B)
    ExtensionSession { windowId: A }        ExtensionSession { windowId: B }
    TabTracker (scoped to A)                TabTracker (scoped to B)
    QuickJS WASM worker                     QuickJS WASM worker
         │ page.*                               │ page.*
         ▼                                      ▼
    tabs where tab.windowId === A          tabs where tab.windowId === B
         │                                      │
         └──────── E_TAB_NOT_OWNED if cross ────┘

Merge (B → A): Browsergent calls rebindWindow(A) on survivor panel only.
                B's ExtensionSession may be destroyed when B's panel closes.
```

---

*web-js window isolation is implemented; remaining fragility is primarily in Browsergent's session coordinator and service worker lifecycle. Run hosting is intentionally panel-local: closing the side panel ends runs (Browsergent product rule).*