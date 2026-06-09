# extension-js — Known Problems & Agent-Oriented Error Guidance

**Status:** Living document — **P0–P2 fixes landed in [PR #2](https://github.com/Irvingouj/pi-web-js/pull/2)** (`merge/fix-doc-into-main`)
**Source:** Browsergent developer capability-check session (`browsergent-conversation-1780882773592.json`, extension-js `^0.4.1`)  
**Audience:** extension-js maintainers; consumers wiring agent prompts

---

## Why this file exists

Modern agents *can* recover from failures — but only when errors say **what failed**, **why**, and **what to try next**.

Raw Chrome strings like `Could not establish connection. Receiving end does not exist.` force the model to guess. In the Browsergent session the agent burned ~15 `run_js` steps probing `typeof page`, switching between `page.*` and `web.tab.*`, and eventually `page.goto` to a different site before mutations worked. A single explicit error would have short-circuited that loop.

**Principle:** Every user-visible failure should be agent-actionable:

1. **Machine code** — stable `E_*` for branching (`E_CONTENT_SCRIPT`, `E_STALE`, …)
2. **Human message** — one sentence, no jargon without explanation
3. **Hint** — what still works vs what does not (e.g. “snapshot works; fill does not”)
4. **Recovery** — 1–3 concrete next steps the agent can put in the next `run_js` cell

Agents are smart enough to follow good guidance. They are not psychic about Chrome extension injection semantics.

---

## Proposed error shape (target)

Today errors are mostly `{ code, message, category? }`. We should standardize:

```typescript
type AgentError = {
  code: string;           // E_CONTENT_SCRIPT
  message: string;        // short summary
  category?: string;      // content-script | permission | navigation | ...
  hint?: string;          // why this happened / what is misleading
  recovery?: string[];    // ordered steps for the agent
  details?: Record<string, unknown>; // tabId, refId, url, candidates, ...
};
```

Surface `hint` + `recovery` in:

- WASM / worker tool results (`_is_error` JSON)
- `console.log` / thrown runtime messages agents read in `run_js` output
- `get_doc` notes for APIs with non-obvious prerequisites

---

## Problem 1 — Cold tab: read works, write fails (P0)

### What happened

On an **already-open** Google tab (extension loaded after the tab was opened):

| API | Result |
|-----|--------|
| `page.snapshot()` / `page.snapshot_data()` | ✅ |
| `page.extract()` | ✅ |
| `web.tab.snapshot(tabId)` | ✅ |
| `page.url()` / `page.title()` | ✅ (main-thread via `chrome.tabs.get`) |
| `page.fill` / `page.click` / `web.tab.fill` / `web.tab.click` | ❌ same |

After `page.goto("https://example.com")`, `page.url`, `fill`, `click`, `scroll` all worked.

### Root cause

Two execution paths:

- **Read path** — `chrome.scripting.executeScript` in MAIN world (`buildSnapshotInTab`, extract, …). Does **not** require manifest content script.
- **Write path** — `chrome.tabs.sendMessage` → `content-script.js`. Requires content script injected and listening.

`pingTabContentScript` runs after `page.goto`, not before arbitrary mutations on stale tabs.

### Why agents get confused

Snapshot success implies “I can control this page.” Mutations then fail with an opaque Chrome message. The agent assumes API misuse, stale refs, or wrong namespace — not missing injection.

### What extension-js should do

1. **Ping preflight before every content-script mutation** (fill, click, …). Implemented inline in `ExtensionSession.executeContentScriptCommand` via `pingTabContentScript`; retry on transient errors; structured fail with hint/recovery.
2. **Recovery without a dedicated wake API:** agents use `await page.goto(currentUrl)` or ask the user to **refresh** the target tab, then retry mutations.

### Target error (example)

```text
[E_CONTENT_SCRIPT] Content script is not connected on tab 941354017 (https://www.google.com/...).

Hint: page.snapshot() uses script injection and can succeed even when fill/click cannot.
      This tab was likely open before the extension loaded (MV3 does not retro-inject).

Recovery:
  1. await page.goto("<current url>")  // re-navigation injects content script
  2. Or ask the user to refresh the target tab, then retry fill/click
```

---

## Problem 2 — `page.url()` / `page.title()` use content script unnecessarily (P0)

### What happened

`web.tab.current()` returned url/title via `chrome.tabs.get`. `page.url()` / `page.title()` failed with Receiving end does not exist on the same tab.

### Root cause

`page_url` / `page_title` are registered as content-script actions. They only need tab metadata.

### What extension-js should do

Implement `page.url` / `page.title` on the **main thread** via `chrome.tabs.get(activeTabId)` (same as tab metadata elsewhere).

### Target error (if tab missing)

```text
[E_NO_TAB] No active tab resolved for page.url().

Recovery:
  1. const t = await web.tab.current(); console.log(t.tabId, t.url)
  2. Ensure the user is focused on a normal http(s) page tab, not chrome:// or the side panel
```

---

## Problem 3 — Raw Chrome errors bubble to agents (P0)

### What happened

Agents saw verbatim: `Could not establish connection. Receiving end does not exist.`

`pingTabContentScript` maps this to `content script not available on this URL` — better, but still no recovery steps. `executeContentScriptCommand` forwards the raw message with `E_CONTENT_SCRIPT`.

### What extension-js should do

Centralize mapping in one module (`normalizeAgentError`). Never pass Chrome connection errors through unchanged.

| Chrome substring | Code | Recovery template |
|------------------|------|-------------------|
| Receiving end does not exist | `E_CONTENT_SCRIPT` | goto current URL / refresh tab |
| Timeout waiting for content-script ping | `E_CONTENT_SCRIPT` | goto current URL / refresh tab |
| Element not found by refId | `E_STALE` or `E_NOT_FOUND` | re-snapshot; list candidates |
| Permission / denied | `E_PERMISSION` | name manifest permission; optional request path |

---

## Problem 4 — Mutations return `null` (P1)

### What happened

`page.fill`, `page.click`, `page.press` returned `null` on success. Agent report: *“success only confirmed by later snapshot/navigation.”*

### What extension-js should do

Return a small confirmation object:

```typescript
{ ok: true, action: "fill", refId: "e6", value: "test" }
```

Document in `get_doc` that `null` historically meant success — migrate to explicit `ok`.

### Target error on silent DOM no-op (SPA)

```text
[E_NOT_INTERACTABLE] fill on e17 (input combobox) returned no effect.

Hint: Some sites ignore programmatic value assignment; value may not appear in snapshot_data.

Recovery:
  1. await page.click({ refId: "e17" }) then await page.type({ refId: "e17", text: "..." })
  2. Or await page.press("Enter") after fill
  3. Re-snapshot and confirm URL or node state changed
```

---

## Problem 5 — `snapshot_data` omits form state (P1)

### What happened

After `page.fill({ refId: "e17", value: "test search" })`, `snapshot_data` still showed no `value` on the node. Capability-check step 4 (“read back via snapshot_data”) cannot pass.

### Root cause

`buildSnapshotInTab` emits `{ refId, role, tag, name? }` only — no `value`, `checked`, or `disabled`.

### What extension-js should do

For `input`, `textarea`, `select`: include `value`, `checked` where readable from DOM.

### Target doc note (`get_doc` for `page.snapshot_data`)

```text
Returns nodes[].refId, role, tag, name, value (inputs), checked (checkbox/radio).
After fill, call snapshot_data() again on the same tab to verify value changed.
```

---

## Problem 6 — Misleading “works” signal from snapshot-only probes (P1)

### What happened

Agent logged `page.snapshot works, length: 8543` on Google while all mutations were broken — then reported “Works” for APIs that had failed on the starting page.

### What extension-js should do

Optional snapshot metadata:

```typescript
{ nodes, url, title, contentScriptReady: boolean }
```

Or a lightweight `page.health()`:

```typescript
{ contentScript: "connected" | "missing", scripting: "ok", tabId, url }
```

### Target `page.health()` output when disconnected

```text
contentScript: "missing"
hint: "snapshot/extract use script injection; fill/click require content script"
recovery: ["page.goto(url)", "refresh target tab"]
```

---

## Problem 7 — `page.*` vs `web.tab.*` duplication (P2)

### What happened

Agent pivoted to `web.tab.current()` + `web.tab.snapshot(tabId)` after `page.url` failed — still could not fill. Two namespaces look like alternatives; they share the same content-script dependency for mutations.

### What extension-js should do

- **Document:** `page.*` = active tab shorthand; `web.tab.*` = explicit `tabId` / multi-tab.
- **Do not** imply `web.tab` bypasses content script for fill/click.
- Align `page.active_tab()` return shape with `web.tab.current()` (object vs array).

### Target error when mixing APIs

```text
[E_API_MISMATCH] web.tab.fill succeeded at API level but content script was not connected.

Hint: web.tab.fill and page.fill use the same content-script path.

Recovery: fix content script first (see E_CONTENT_SCRIPT recovery), then retry.
```

---

## Problem 8 — Stale refIds after DOM change (P2)

### What happened

`page.type({ refId: "e17" })` → `Element not found by refId "e17". Candidates: none` after DuckDuckGo UI re-render (combobox became `e5`).

### What extension-js should do

- Keep throwing on stale refs (correct).
- Enrich error: `previousRef`, `suggestedAction: "snapshot_data again"`, `similarNodes` if any.

### Target error

```text
[E_STALE] Element not found by refId "e17".

Hint: RefIds are invalidated when the DOM is replaced (navigation, SPA rerender, autocomplete).

Recovery:
  1. const d = await page.snapshot_data(); find combobox/input in d.nodes
  2. Use a fresh refId from that snapshot only
  3. Do not reuse refIds from before press/click/navigation
```

---

## Problem 9 — `get_doc` types are unhelpful (P2)

### What happened

`get_doc` listed every parameter as `` `undefined` `` and returns as `` `undefined` ``. Agents cannot learn argument shapes from docs alone.

### What extension-js should do

Wire real Zod/param types into generated docs (name, type, required, example).

---

## Priority backlog

| Priority | Item | Primary fix |
|----------|------|-------------|
| P0 | Cold-tab read/write split | ping preflight before CS mutations + agent errors with hint/recovery |
| P0 | `page.url` / `page.title` on main thread | `chrome.tabs.get` |
| P0 | Normalize all Chrome errors | `normalizeAgentError` + never raw Receiving end |
| P1 | Mutation return values | `{ ok, refId, … }` not `null` |
| P1 | `snapshot_data` form fields | `value`, `checked`, `disabled` |
| P1 | `page.health()` or snapshot flag | `contentScriptReady` |
| P2 | API docs clarity | `page` vs `web.tab`, `active_tab` shape |
| P2 | Stale ref errors | `E_STALE` + recovery text |
| P2 | `get_doc` accuracy | Real types, permissions, prerequisites |

---

## Out of scope (host / Browsergent)

These showed up in the same session but belong in the consumer, not extension-js core:

- Side panel stealing active tab focus → `resolveActiveTabId` should prefer `lastFocusedWindow: true` (host tab context).
- Agent prompts that over-trust “Works” without correlating trace failures.
- UI surfacing `hint` / `recovery` in the side panel trace (extension-js should still *emit* them).

---

## Acceptance test (suggested)

Reproduce the Browsergent capability-check on a **pre-opened** Google tab without refresh:

1. `page.snapshot()` succeeds.
2. `page.fill()` returns `E_CONTENT_SCRIPT` with hint + recovery (not raw Chrome text).
3. After `page.goto(currentUrl)` or **refreshing the tab**, fill succeeds and returns `{ ok: true, … }`.
4. `snapshot_data` after fill includes `value` on the target input.

Until this passes, agents will keep rediscovering the same failure mode expensively.
