## Goal Statement

Execute **PROBLEMS-TDD-PLAN.md** end-to-end. Do not stop until **WU-0–WU-10** complete, **TDD matrix T-000–T-024** green, and **Final Gate** passes.

**Read first:** `PROBLEMS-TDD-PLAN.md`, `problems.md`, `AGENTS.md`, `web/tests/e2e/extension/simple-form-1.spec.ts`, `scripts/serve-testcases.mjs`

**Rules:** Extension context only. TDD: failing test first per WU. Smallest correct diff. Content-script registry for `page.*`/`web.tab.*` DOM APIs (no internal `executeScript`). Re-run full Final Gate on any failure.

**Locked decisions:**
- Testcase host: `http://127.0.0.1:9292/testcases/...` via `serve-testcases.mjs` (extend `testcases/`, not Playwright route mocks, for AC specs)
- `page.fetch` binary: `{ bodyEncoding: "text"|"base64", body, byteLength, contentType, finalUrl, status, ok, headers }`; JPEG never via corrupted `text()`
- `fs.write`/`fs.writeBase64`: object `{ path, data }`; success returns `{ path, bytes_written }`
- WU-8 docs: follow `MANIFEST-DOCS-STRICT-TYPING-PLAN.md` WU-1→WU-5 inside WU-8 (no parallel doc-system rewrite)
- Out of scope: Browsergent UI, `page.wake()`, new chrome APIs

**Order (strict):**
1. **WU-0** — Fixtures (`testcases/dynamic-feed`, `large-dom`, `media-download`, `stale-ref`) + `testcase-harness.ts` + `problems-smoke.spec.ts`
2. **WU-1** — Element observation (`collect-inline-snapshot.ts`, `handlers.find`, schemas) → T-001–T-004, AC-1
3. **WU-2** — Large/mutating snapshots → T-005–T-007, AC-2
4. **WU-3** — Stable targeting + `E_STALE` → T-008–T-009, AC-5
5. **WU-4** — Binary fetch + fs save pipeline → T-010–T-012, AC-3
6. **WU-5** — Cold tab E2E on testcase server → T-013–T-014, AC-4
7. **WU-6** — `PageActionResult` + actionable errors → T-015–T-016
8. **WU-7** — Runtime binary globals + signature consistency → T-017–T-018
9. **WU-8** — `get_doc` contract + manifest strict typing → T-019–T-020, AC-6
10. **WU-9** — Dynamic feed continuity after scroll/rerender → T-021
11. **WU-10** — Trace/lifecycle → T-022

**Per-WU done:** Every checkbox in `PROBLEMS-TDD-PLAN.md` for that WU + all T-00x rows for that WU green.

**Final Gate:**

```bash
cd crates/extension-js/js && npm test
cd ../../.. && cargo test -p web-js-core --lib
cargo test -p extension-js --lib
node scripts/build.js extension
cd web && npm run test:e2e:extension
```

**Must exist:** `testcases/dynamic-feed/`, `large-dom/`, `media-download/`, `stale-ref/`; `web/tests/e2e/extension/problems-*.spec.ts`; `web/tests/e2e/extension/lib/testcase-harness.ts`

**Done when:** All WU checkboxes + T-000–T-024 green + Final Gate exit 0 + brief summary (WU list, test counts).
