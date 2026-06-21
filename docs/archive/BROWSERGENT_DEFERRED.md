# Browsergent Integration — Deferred Items

Packaging fixes for `@pi-oxide/extension-js` 0.4.1 address worker WASM path
(`./extension_js.js` sibling) and zod bundling in `worker.js`. The items below
remain **out of scope** for that packaging work and belong to Browsergent or
separate follow-up.

## 1. JS Playbook E2E tab targeting

**Symptom:** Playwright side panel steals browser focus; `page.*` calls may run
against the wrong active tab.

**Test:** `Browsergent/tests/js-playbook-fill-form.spec.ts` (skipped)

**Cause:** Consumer E2E harness / active-tab focus race, not published-bundle layout.

## 2. Golden-path agent E2E

**Symptom:** Multi-turn agent fill-and-submit fails on tab/ref setup.

**Test:** `Browsergent/tests/golden-path-fill-submit.spec.ts` (skipped)

**Cause:** Same active-tab/ref setup class as JS Playbook; needs consumer E2E work.

## 3. `page.fill` positional API removed in 0.4

**Correct API:** `page.fill({ refId: "e1", value: "hello" })`

**Stale references:** Browsergent `src/worker/js-tool-prompt.ts` comments and some
tests still show positional `page.fill("e1", "hello")`.

**Cause:** Documentation/prompt migration in Browsergent, not extension-js packaging.

## 4. Session save race on create/switch

**Symptom:** Creating a new session before debounced save flushed left the prior
session with `messageCount: 0` in storage; session list hid it.

**Fix location:** Browsergent `src/sidepanel/app.tsx` (`flushSave` before
`createSession` / `switchSession`) and `src/controllers/session-controller.ts`.

**Cause:** Browsergent session controller, not extension-js.

## 5. Streaming E2E timing sensitivity

**Symptom:** `streaming-persistence.spec.ts` first test flaked when chunk delay
was 500ms between `"Hello"` and `" world"`.

**Mitigation:** Increased mock delay to 2000ms in Browsergent test.

**Cause:** Test harness timing, not worker packaging.

## 6. Consumer copy checklist (post 0.4.1)

After the packaging fix, Chrome extension `dist/` must include **at the same
level**:

- `worker.js`
- `extension_js.js`
- `content-script.js`
- Consumer app bundle (e.g. `sidepanel.js`) — references `worker.js` as sibling

No `dist/pkg/` subdirectory is required for WASM resolution.
