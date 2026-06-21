# problems.md — End-to-End TDD Plan

**Status:** Ready for execution  
**Source of truth:** `problems.md` (product behavior)  
**Context:** extension-js only (`AGENTS.md`)  
**Strategy:** Red → Green → Refactor per work unit; prove behavior on a **managed local testcase site** served by `scripts/serve-testcases.mjs` (`http://127.0.0.1:9292/testcases/...`).

---

## Objective

Close every gap in `problems.md` so a browser agent can complete the **image-download golden path** and all six **Required Acceptance Scenarios** without undocumented APIs, signature guessing, raw DOM execution, corrupted binary data, or speculative retries.

**Completion standard** (from `problems.md`): all automated extension-context tests pass on a fresh build; TDD matrix rows are green.

---

## Test Infrastructure (WU-0 foundation)

### Managed testcase site

| Path | Purpose | problems.md |
|------|---------|-------------|
| `testcases/simple-form-1/` | Form fill/click baseline (exists) | — |
| `testcases/dynamic-feed/` | 12+ `<article>` cards, nested images, stable permalinks, `data-post-id` | AC-1, P0 observation, P1 continuity |
| `testcases/large-dom/` | 5k–20k nodes, `?nodes=N` query, JS rerender toggle | AC-2, P0 snapshots |
| `testcases/media-download/` | In-page `<img>` + same-origin JPEG at `/testcases/media-download/assets/photo.jpg` (known bytes + sha256) | AC-3, P0 binary |
| `testcases/stale-ref/` | Button triggers virtualized rerender (new DOM, same visual slot) | AC-5, P0 targeting |
| `testcases/cold-tab/` | Reuse `dynamic-feed` or `simple-form-1` URL; cold semantics enforced in harness | AC-4 |

### Harness additions

| File | Change |
|------|--------|
| `web/tests/e2e/extension/lib/constants.ts` | Export `TESTCASE_BASE`, per-fixture URLs |
| `web/tests/e2e/extension/lib/testcase-harness.ts` | **New:** `activateTestcaseTab(url)`, `runAgentCell(source)`, `assertAgentError(result, code)` |
| `web/playwright.extension.config.ts` | `webServer` health URL → `/testcases/dynamic-feed/` (or multi-route probe) |
| `scripts/serve-testcases.mjs` | No change required (already serves `testcases/` tree) |

### TDD layers (every WU)

1. **Unit (Vitest, jsdom)** — `crates/extension-js/js/test/`; mock `chrome.runtime.id` for extension context.
2. **Integration (Vitest)** — registry dispatch, manifest docs, worker relay (existing patterns).
3. **E2E (Playwright extension)** — `web/tests/e2e/extension/problems-*.spec.ts`; real unpacked `web/dist/`, sidepanel cells, testcase HTTP server.

**Rule:** land failing tests in the same PR slice as the WU they belong to; never implement without a red test first.

---

## Work Units (strict order)

### WU-0 — Testcase site + E2E harness scaffold

**Goal:** Managed fixtures and shared helpers exist; one smoke E2E proves pipeline.

**Files:** `testcases/*/index.html`, `web/tests/e2e/extension/lib/testcase-harness.ts`, `web/tests/e2e/extension/problems-smoke.spec.ts`, `constants.ts`, `playwright.extension.config.ts`

**Acceptance:**
- [ ] All fixture URLs return 200 via `serve-testcases.mjs`
- [ ] `problems-smoke.spec.ts`: goto `dynamic-feed`, `page.url()` matches fixture URL
- [ ] Documented sha256 for `media-download/assets/photo.jpg` in fixture README comment

---

### WU-1 — P0 Complete element observation

**Goal:** `page.find` / `page.snapshot_data` nodes expose actionable structured fields.

**Files:** `collect-inline-snapshot.ts`, `snapshot-dom.ts`, `handlers.ts` (`find`), `schemas.ts`, `content-script-tools.ts`

**Behavior to implement:**
- Snapshot/find nodes include: `refId`, `tag`, `role`, `name`, `text`, form state, and when applicable `href`, `src`, `alt`, `title`, `value`, `checked`, `disabled`, `readOnly` as **absolute URLs** for URL-bearing attrs
- `page.find(selector)` assigns or resolves `refId` (snapshot-first or inline assign); never `{ refId: null }` for targetable elements
- Optional `parentRefId` or `containerId` for nested media ↔ article association on `dynamic-feed`

**Acceptance:** AC-1 rows (see table below); unit tests for IMG/A attribute extraction.

---

### WU-2 — P0 Reliable snapshots on large / mutating DOM

**Goal:** Snapshots succeed on `large-dom` fixture; `max_nodes` bounds work; failures are specific.

**Files:** `handlers.ts` (`snapshot*`), `main/runner/dom/snapshot.ts`, `agent-errors.ts`, `large-dom` fixture JS

**Behavior:**
- `page.snapshot()`, `page.snapshot_text()`, `page.snapshot_data({ max_nodes })` succeed at 50/200/500 on large fixture
- `max_nodes` caps `nodes.length`; smaller bound still succeeds
- Concurrent rerender → `E_SNAPSHOT` with concrete `details.cause` (not bare "Failed to get page snapshot"); recovery does not point to failing API
- Fallback: if text snapshot fails, `snapshot_data` still available (or documented inverse)

**Acceptance:** AC-2 rows; no generic failure at 50 nodes.

---

### WU-3 — P0 Stable element targeting + stale references

**Goal:** Observed elements are clickable; stale DOM → `E_STALE` with candidates.

**Files:** `dom-utils.ts`, `handlers.ts`, `agent-errors.ts`, `page.ts` / `tab.ts` parity

**Behavior:**
- Distinguish `E_STALE`, `E_NOT_INTERACTABLE`, label-not-found, unsupported target
- `page.*` and `web.tab.*` equivalent ops share error codes and candidate shape
- `stale-ref` fixture: old refId → `E_STALE` with `details.staleRefId`; refresh observation → new ref works

**Acceptance:** AC-5 rows; extend `content-script.test.ts` + E2E `problems-stale-ref.spec.ts`.

---

### WU-4 — P0 Binary-safe fetch + filesystem save pipeline

**Goal:** Documented path: observe image URL → fetch bytes → write file → verify size + hash.

**Files:** `handlers.ts` (`fetch`), `schemas.ts` (`FetchValueSchema`), `fs.rs` / worker fs handlers, `web-js-core` prelude if needed

**Locked decision:** `page.fetch` returns `{ bodyEncoding: "text"|"base64", body, byteLength, contentType, finalUrl, status, ok, headers }`. Binary responses use `base64` (not corrupted UTF-8). `fs.write` / `fs.writeBase64` accept documented object `{ path, data }` where `data` is base64 string; return `{ path, bytesWritten }`.

**Behavior:**
- Cross-origin same-site JPEG from `media-download` fixture preserves bytes
- `fs.writeBase64({ path, data })` params non-null at dispatcher; positional aliases documented or rejected with `E_INVALID_PARAMS`

**Acceptance:** AC-3 rows end-to-end in extension E2E.

---

### WU-5 — P0 Cold-tab read/write consistency

**Goal:** Pre-opened tab behavior matches `page.health()`; no raw Chrome strings.

**Files:** `page.ts` (`health`), `runtime.ts`, `normalize-agent-error.ts`, `browsergent-cold-tab.test.ts`, E2E `problems-cold-tab.spec.ts`

**Behavior:**
- `page.health()`: accurate `mutationsReady`, `contentScript`, `domApis`, `hint`, `recovery`
- Mutation without CS → `E_CONTENT_SCRIPT` (not "Receiving end does not exist")
- Recovery `page.goto(currentUrl)` or documented refresh → fill/click with `PageActionResult`

**Acceptance:** AC-4 rows (unit tests exist; add full E2E on testcase server tab).

---

### WU-6 — P1 Explicit success results + actionable errors

**Goal:** Mutations return `PageActionResult`; runtime errors preserve name/message/stack.

**Files:** `action-result.ts`, `handlers.ts`, `normalize-agent-error.ts`, worker error bridge

**Acceptance:**
- [ ] All content-script mutations return non-null typed receipt (`ok`, `action`, `refId`, observed effect)
- [ ] QuickJS cell `ReferenceError` includes message + line in stderr (existing tests extended)
- [ ] No bare `E_UNKNOWN` / `E_EXTENSION` for covered APIs in AC scenarios

---

### WU-7 — P1 Runtime capability clarity + API signature consistency

**Goal:** Document and test binary globals; object-only params enforced consistently.

**Files:** `prelude.js`, `manifest-docs.test.ts`, `schemas.ts`, `content-script-tools.ts`

**Locked decision:** Document availability of `Uint8Array`, `ArrayBuffer`, `TextEncoder`, `TextDecoder`, `atob`, `btoa` in extension QuickJS prelude. Missing → `E_RUNTIME_CAPABILITY` (not raw `ReferenceError`).

**Acceptance:**
- [ ] `api-docs-integration.test.ts` lists binary globals
- [ ] `page.fetch`, `page.fill`, `fs.writeBase64` reject wrong shapes with `E_INVALID_PARAMS` naming accepted form

---

### WU-8 — P1 Accurate generated documentation

**Goal:** `get_doc` / `apiDocs()` trustworthy for all APIs used in AC scenarios.

**Execute:** `MANIFEST-DOCS-STRICT-TYPING-PLAN.md` WU-1→WU-5 inside this WU (do not duplicate doc-system work).

**Additional AC for this plan:**
- [ ] `problems-docs-contract.spec.ts`: for each API in TDD matrix "Docs" rows, generated example runs unchanged in sidepanel cell
- [ ] No `paramsDoc.type` or `returnsDoc.type` ∈ `{ undefined, unknown, any, object }` for `page.*`, `web.tab.*`, `fs.*` used in AC-1–AC-5

---

### WU-9 — P1 Dynamic-page continuity

**Goal:** Feed fixture exposes stable permalinks + post IDs; agent can re-identify after scroll/rerender.

**Files:** `dynamic-feed` fixture, observation schemas (permalink, `postId`, `imageUrls[]`)

**Acceptance:** AC-1 steps 4–6 after programmatic scroll + rerender in fixture.

---

### WU-10 — P2 Trace and lifecycle correctness

**Goal:** Cells reach terminal state; tool events ordered; timeouts explicit.

**Files:** `extension-session.ts`, `worker.ts`, sidepanel runner UI tests

**Acceptance:**
- [ ] Stopped/timed-out cell not `running` after 2s
- [ ] `callId` on error and completion events match

**Out of scope for first pass unless AC-1–AC-6 green:** Browsergent UI, `page.wake()`, new chrome APIs.

---

## End-to-End Acceptance Criteria Table

Maps `problems.md` § Required Acceptance Scenarios to executable tests.

| AC-ID | problems.md scenario | Primary E2E spec | Key pass criteria |
|-------|---------------------|------------------|-------------------|
| **AC-1** | Dynamic feed observation | `problems-dynamic-feed.spec.ts` | ≥10 articles; each image has absolute `src` + `alt`; article `permalink`; image↔article link; click via `refId` |
| **AC-2** | X-sized snapshot | `problems-large-dom.spec.ts` | `snapshot()` ok; `snapshot_data({ max_nodes: 50 })` ok, `nodes.length ≤ 50`; higher bound → more nodes; rerender → no unexplained generic `E_SNAPSHOT` |
| **AC-3** | Download and save image | `problems-media-download.spec.ts` | observe URL → `page.fetch` base64 → `fs.writeBase64` → `fs.stat` size → `fs.hash` matches fixture sha256; explicit receipts each step |
| **AC-4** | Cold existing tab | `problems-cold-tab.spec.ts` | Tab open before extension; `page.health()` accurate; mutation → `E_CONTENT_SCRIPT` or success; recovery → fill+click receipts; no raw Chrome error strings |
| **AC-5** | Stale dynamic reference | `problems-stale-ref.spec.ts` | Capture ref → rerender → `E_STALE` + details → re-snapshot → click replacement |
| **AC-6** | Documentation contract | `problems-docs-contract.spec.ts` | APIs used in AC-1–5: example runs; params/returns match schema; no `undefined` types |

---

## TDD Matrix (must pass)

Status: **pending** until WU lands. CI gate: all rows green.

| ID | WU | Layer | Test file | Asserts (summary) | problems.md |
|----|-----|-------|-----------|-------------------|-------------|
| T-000 | 0 | E2E | `problems-smoke.spec.ts` | testcase server + `page.url()` on dynamic-feed | Completion standard |
| T-001 | 1 | unit | `observation-nodes.test.ts` | snapshot node includes `src`/`href` absolute for IMG/A | P0 observation |
| T-002 | 1 | unit | `page-find.test.ts` | `page.find("img")` returns non-null `refId` + `src` | P0 observation |
| T-003 | 1 | unit | `observation-nodes.test.ts` | `parentRefId` links image to article | P0 observation, P1 continuity |
| T-004 | 1 | E2E | `problems-dynamic-feed.spec.ts` | AC-1 full checklist | AC-1 |
| T-005 | 2 | unit | `snapshot-bounds.test.ts` | `max_nodes: 50` → ≤50 nodes; still succeeds | P0 snapshots |
| T-006 | 2 | unit | `snapshot-errors.test.ts` | failure includes `code`, `details.cause`, valid `recovery` | P0 snapshots, P1 errors |
| T-007 | 2 | E2E | `problems-large-dom.spec.ts` | AC-2 full checklist | AC-2 |
| T-008 | 3 | unit | `content-script.test.ts` | extend stale / not-interactable / label miss codes | P0 targeting |
| T-009 | 3 | E2E | `problems-stale-ref.spec.ts` | AC-5 full checklist | AC-5 |
| T-010 | 4 | unit | `fetch-binary.test.ts` | JPEG bytes → base64 round-trip, no replacement chars | P0 binary |
| T-011 | 4 | unit | `fs-write.test.ts` | `writeBase64({ path, data })` non-null at worker; returns `bytesWritten` | P0 fs |
| T-012 | 4 | E2E | `problems-media-download.spec.ts` | AC-3 full checklist | AC-3 |
| T-013 | 5 | unit | `browsergent-cold-tab.test.ts` | extend health + recovery assertions | P0 cold tab |
| T-014 | 5 | E2E | `problems-cold-tab.spec.ts` | AC-4 full checklist | AC-4 |
| T-015 | 6 | unit | `action-result.test.ts` | all mutation handlers return `PageActionResult` | P1 success |
| T-016 | 6 | unit | `normalize-agent-error.test.ts` | preserves Error name/message/stack fields | P1 errors |
| T-017 | 7 | unit | `runtime-capabilities.test.ts` | `Uint8Array`/`atob` documented + work in cell | P1 runtime |
| T-018 | 7 | unit | `schemas.test.ts` | invalid fetch/fill/fs shapes → `E_INVALID_PARAMS` | P1 signatures |
| T-019 | 8 | unit | `manifest-docs.test.ts` | banned types scan = 0 for page/tab/fs | P1 docs |
| T-020 | 8 | E2E | `problems-docs-contract.spec.ts` | AC-6 for APIs in T-004–T-014 | AC-6 |
| T-021 | 9 | E2E | `problems-dynamic-feed.spec.ts` | after scroll+rerender, same `postId`/permalink | P1 continuity |
| T-022 | 10 | unit | `worker.test.ts` / session tests | terminal cell state + callId correlation | P2 trace |
| T-023 | — | integration | `browsergent-parity.test.ts` | keep green (regression guard) | — |
| T-024 | — | integration | `api-docs-integration.test.ts` | markdown contains prerequisites for mutations | P1 docs |

---

## Per-WU TDD workflow

```
1. Add/adjust fixture HTML + assets (if needed)
2. Write failing unit test(s) — T-00x rows for this WU
3. Write failing E2E spec — AC row for this WU
4. Implement minimal fix in extension-js (runner → content-script → schemas → docs)
5. npm test (extension-js unit) → green unit rows
6. npm run test:e2e:extension → green AC row
7. Update TDD matrix status in PR description (not necessarily in this file)
```

---

## Final Gate

All commands must exit 0:

```bash
cd crates/extension-js/js && npm test
cd ../../.. && cargo test -p web-js-core --lib
cargo test -p extension-js --lib
node scripts/build.js extension
cd web && npm run test:e2e:extension
```

**Must exist after completion:**
- `testcases/dynamic-feed/`, `large-dom/`, `media-download/`, `stale-ref/`
- `web/tests/e2e/extension/problems-*.spec.ts` (6 AC specs + smoke)
- `web/tests/e2e/extension/lib/testcase-harness.ts`

**Done when:** All WU checkboxes satisfied; TDD matrix T-000–T-024 green; Final Gate exit 0; image-download scenario (AC-3) passes without undocumented APIs.

---

## References

- `problems.md` — product requirements
- `AGENTS.md` — extension-only context, content-script channel rules
- `MANIFEST-DOCS-STRICT-TYPING-PLAN.md` — WU-8 doc typing (subset)
- `docs/api-docs-registry-refactor.md` — doc/registry architecture
- `web/tests/e2e/extension/simple-form-1.spec.ts` — existing testcase E2E pattern
- `scripts/serve-testcases.mjs` — local testcase server
