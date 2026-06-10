# Manifest docs strict typing plan

**Branch:** `merge/fix-doc-into-main`  
**Context:** Post-audit follow-up from PR #2. Extension context only (`AGENTS.md`).

---

## Goal

Eliminate weak types in JS manifest / `get_doc` output so agents never see `unknown`, `any`, `object`, or vague return descriptions on any registered API.

---

## Goal statement (copy to execution agent)

> Execute `MANIFEST-DOCS-STRICT-TYPING-PLAN.md` WU-1→WU-5 on `merge/fix-doc-into-main`. Do not stop until all AC pass and Final Gate is green. **Banned:** `returnsDoc.type` / `paramsDoc.type` ∈ {unknown, undefined, any, object, lazy, void}. Fix with named Zod objects, not overrides. No `page.wake()`. Final Gate: `cd crates/extension-js/js && npm test && cd ../.. && cargo test -p web-js-core --lib && cargo test -p extension-js --lib && node scripts/build.js extension`.

---

## Locked decisions

| Decision | Choice |
|----------|--------|
| Weak type ban | **All** manifest entries (including `chrome_*`) |
| Fix strategy | Named `z.object({ ... })` + `.describe()`; extend `zod-to-docs.ts` if needed |
| `returnDoc` | Must match runtime / `returnsDoc.type` (handlerKey action names) |
| Out of scope | `page.wake()`, `E_API_MISMATCH`, `tab_append`, Browsergent UI |

---

## Work units

### WU-1 — Guardrails (tests first)

**Files:** `crates/extension-js/js/test/manifest-docs.test.ts`

**AC:**
- [ ] New test scans full manifest; fails if any `returnsDoc.type` or `paramsDoc.type` matches banned set
- [ ] Test documents allowlist mechanism only if truly unavoidable (prefer zero allowlist)

---

### WU-2 — zod-to-docs

**Files:** `crates/extension-js/js/src/shared/registry/zod-to-docs.ts`, `zod-to-docs.test.ts`

**AC:**
- [ ] `ZodRecord` never emits bare `"object"` (use value-type or require `ZodObject`)
- [ ] No fallback to `"unknown"` / `"any"` without explicit schema
- [ ] Unit tests cover record + object shapes

---

### WU-3 — Tab & page metadata returns

**Files:** `schemas.ts`, `page.ts`, `tab.ts`, `manifest-docs.test.ts`

**AC:**
- [ ] Replace `ChromeTabSchema = z.record(z.unknown())` with named tab object
- [ ] `page_active_tab`, `page_goto`, `tab_current`, `tab_get`, `tab_create`, `tab_activate` returnsDoc.type lists `tabId`, `url`, `title` (not `object`)
- [ ] Fix `page_extract`, `page_switch`, `page_new_tab` weak returns

---

### WU-4 — Evaluate, host, storage

**Files:** `tab.ts`, `schemas.ts`, storage/chrome registrations as needed

**AC:**
- [ ] `tab_evaluate` returnsDoc.type is concrete (JSON-serializable union)
- [ ] `host_call` params/returns typed (no `unknown`)
- [ ] Non-chrome entries with bare `object` returns fixed (`storage_get_many`, `bookmarks_create`, etc.)

---

### WU-5 — Chrome passthrough + mutation docs

**Files:** `content-script-tools.ts`, `manifest-docs.test.ts`, `api-docs-integration.test.ts`

**AC:**
- [ ] Zero `chrome_*` entries with `returnsDoc.type === "unknown"`
- [ ] scroll/back mutations have `agentMeta` + aligned `returnDoc`
- [ ] WASM markdown test: no `Returns: unknown|object|any`; `page.snapshot_data` form-field notes present

---

## Final gate

```bash
cd crates/extension-js/js && npm test
cargo test -p web-js-core --lib
cargo test -p extension-js --lib
node scripts/build.js extension
```

**Done when:** All WU AC checked + banned-type scan = 0 violations + Final Gate exit 0.

---

## Reference

- Audit baseline: 228 manifest entries; offenders included `tab_evaluate`, `host_call`, tab metadata APIs, ~30 `chrome_*` unknown returns
- Prior fixes: `problems.md`, `zod-to-docs`, `content-script-tools` returnDoc, `page_snapshot_data` agentMeta
