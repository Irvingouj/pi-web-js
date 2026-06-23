# Code Review: `page.select_option` Listbox Scoping Fix

> Generated 2026-06-23 — 4 parallel fire reviewers (correctness, test coverage, elegance, design patterns)

**Scope:** `handlers.ts` (+66/−45), `content-script.test.ts` (+130/−11), `greenhouse-combobox.spec.ts` (new), `testcases/greenhouse-combobox/index.html` (new), `constants.ts` (+1), `CHANGELOG.md` (+13)

---

## Blocking Issues

### B1. Error shape divergence — combobox path bypasses `labelNotFoundError`

**Absolute path:** `/Users/oujunyi/code/web-js/crates/extension-js/js/src/content-script/handlers.ts:670-687`

**Problem:** The combobox error path constructs a raw `AsyncError` object inline:
```typescript
throwStructuredAgentError({
    message: `Element not found by label "${value}". Candidates: ...`,
    code: "E_NOT_FOUND",
    category: "resource",
    hint: `Searched listbox(es): ...`,
    recovery: [...],
    details: { label, targetRefId, targetName, searchedIds, ignoredIds, candidates },
});
```

The native `<select>` path (same handler, line 649) and every other handler use the established factory:
```typescript
throwStructuredAgentError(labelNotFoundError(value, candidates));
```

This creates two divergent `E_NOT_FOUND` formats — different `hint`, different `recovery`, extra `details` fields. Any downstream consumer (error normalizers, UI renderers) must now handle both shapes as special cases.

**Suggested fix:** Extend `labelNotFoundError` in `crates/extension-js/js/src/shared/registry/agent-errors.ts` to accept optional diagnostics:
```typescript
export function labelNotFoundError(
    label: string,
    candidates?: StaleRefCandidate[],
    extra?: {
        searchedIds?: string[];
        ignoredIds?: string[];
        targetRefId?: string;
        targetName?: string;
    },
): AsyncError {
    const labels = (candidates || []).map((c) => c.name || c.refId).filter(Boolean);
    const hint = extra?.searchedIds?.length
        ? `Searched listbox(es): ${extra.searchedIds.join(", ")}. Ignored: ${(extra.ignoredIds || []).join(", ") || "none"}.`
        : undefined;
    return {
        message: `Element not found by label "${label}".` +
            (labels.length > 0 ? ` Candidates: ${labels.slice(0, 5).join(", ")}` : " Candidates: none"),
        code: "E_NOT_FOUND",
        category: "resource",
        ...(hint ? { hint } : {}),
        recovery: [
            "const d = await page.snapshot_data(); find the target in d.nodes",
            "Try a more specific label or use refId from snapshot",
        ],
        details: {
            label,
            ...(extra?.targetRefId ? { targetRefId: extra.targetRefId } : {}),
            ...(extra?.targetName ? { targetName: extra.targetName } : {}),
            ...(extra?.searchedIds ? { searchedIds: extra.searchedIds } : {}),
            ...(extra?.ignoredIds ? { ignoredIds: extra.ignoredIds } : {}),
            ...(candidates ? { candidates } : {}),
        },
    };
}
```

Then the combobox path at line 670 becomes:
```typescript
throwStructuredAgentError(
    labelNotFoundError(value, candidates, {
        searchedIds,
        ignoredIds,
        targetRefId: control.getAttribute("data-ref-id") || undefined,
        targetName: control.getAttribute("aria-label") || control.getAttribute("data-ref-id") || "",
    }),
);
```

---

### B2. Broken error message when `candidates` array is empty

**Absolute path:** `/Users/oujunyi/code/web-js/crates/extension-js/js/src/content-script/handlers.ts:671`

**Problem:** The template literal unconditionally appends `"Candidates: "`:
```typescript
message: `Element not found by label "${value}". Candidates: ${candidates.map((c) => c.name).filter(Boolean).slice(0, 5).join(", ")}`,
```

When `roots` is empty (no listboxes found), `candidates` is `[]`. This produces:
> `Element not found by label "Bachelor's Degree". Candidates: `

— trailing `"Candidates: "` with nothing after.

Additionally, `.filter(Boolean)` drops candidates whose `name` is empty/undefined. An option with empty `textContent` is silently excluded. The old `labelNotFoundError` uses `c.name || c.refId` as fallback.

**Suggested fix:** Adopt B1's fix — `labelNotFoundError` already handles empty candidates and uses `c.name || c.refId` fallback properly. No separate fix needed if B1 is addressed.

---

### B3. No fallback when `roots` is empty — options may exist but won't be found

**Absolute path:** `/Users/oujunyi/code/web-js/crates/extension-js/js/src/content-script/handlers.ts:657-659`

**Problem:** The old code had a global safety net:
```typescript
// OLD — removed:
const options = [...new Set([
    ...scopedOptions,
    ...document.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]'),
])];
```

The new code has zero fallback:
```typescript
// NEW:
const options = roots.flatMap((root) =>
    Array.from(root.querySelectorAll<HTMLElement>('[role="option"]')),
);
```

If `resolveListboxRoots` returns `roots: []` (e.g., a combobox whose listbox opens via a framework that doesn't use `aria-controls`, doesn't nest the listbox, and whose listbox was already visible before click), then `options` is `[]` and the call fails with `E_NOT_FOUND` even though options exist in the DOM. This code path is not tested.

**Suggested fix:** Add a unit test for the `roots: []` scenario first. Then decide: either (a) keep the removed fallback but scoped only to listboxes that appeared/were modified after activation (i.e., deduplicate `activatedRoots` against `ignoredIds`), or (b) accept that `roots: []` means "no listbox found" and ensure the error message clearly communicates this (see B2).

---

### B4. `aria-controls` pointing to a non-listbox element silently included in roots

**Absolute path:** `/Users/oujunyi/code/web-js/crates/extension-js/js/src/content-script/handlers.ts:391-393`

**Problem:**
```typescript
const linkedRoots = ownedIds
    .map((id) => document.getElementById(id))
    .filter((root): root is HTMLElement => root instanceof HTMLElement);
```

If `aria-controls="some-panel"` and `#some-panel` is a plain `<div>` without `role="listbox"`, it is included in `roots` and `searchedIds`, but `root.querySelectorAll('[role="option"]')` returns `[]`. The control appears to "search" a non-listbox element. No test covers this.

**Suggested fix:** Add a `role` check:
```typescript
const linkedRoots = ownedIds
    .map((id) => document.getElementById(id))
    .filter((root): root is HTMLElement =>
        root instanceof HTMLElement && root.getAttribute("role") === "listbox"
    );
```

Add a unit test:
- Combobox with `aria-controls="some-div"`, a `<div id="some-div">` (no role), and a separate correct listbox.
- Assert that `some-div` does NOT appear in `searchedIds`.

---

### B5. Missing test coverage for `aria-owns` (standalone), multi-ID `aria-controls`, and `selfRoot`

**Absolute paths:**
- `/Users/oujunyi/code/web-js/crates/extension-js/js/src/content-script/handlers.ts:387` (aria-owns / multi-ID parsing)
- `/Users/oujunyi/code/web-js/crates/extension-js/js/src/content-script/handlers.ts:407` (selfRoot)

**Problem:** Three code paths have zero test coverage:
1. `aria-owns` used without `aria-controls`.
2. `aria-controls="id1 id2"` with multiple space-separated IDs.
3. Control itself has `role="listbox"` (`selfRoot` case).

**Suggested fix:** Add these tests to `/Users/oujunyi/code/web-js/crates/extension-js/js/test/content-script.test.ts`, in the `describe("select_option handler")` block:

```typescript
it("selects option from aria-owns linked listbox", async () => {
    document.body.innerHTML = `
        <input role="combobox" aria-label="Pick" aria-owns="owned-list">
        <div id="owned-list" role="listbox"><div role="option" data-target>Alpha</div></div>
    `;
    // ... snapshot, select_option, assert clicked
});

it("selects option when aria-controls has multiple ids", async () => {
    document.body.innerHTML = `
        <input role="combobox" aria-label="Pick" aria-controls="lb1 lb2">
        <div id="lb1" role="listbox"><div role="option">Wrong</div></div>
        <div id="lb2" role="listbox"><div role="option" data-target>Correct</div></div>
    `;
    // ... snapshot, select_option, assert clicked on Correct
});

it("selects option when control itself is a listbox", async () => {
    document.body.innerHTML = `
        <div role="listbox" aria-label="Pick">
            <div role="option" data-target>Alpha</div>
            <div role="option">Beta</div>
        </div>
    `;
    // ... snapshot, select_option on the listbox refId, assert clicked on Alpha
});
```

---

### B6. E2E test does not prove the scoping fix — would still pass if fix is reverted

**Absolute path:** `/Users/oujunyi/code/web-js/web/tests/e2e/extension/greenhouse-combobox.spec.ts:37-73`

**Problem:** The E2E test only verifies that selections succeed:
```typescript
expect(status).toContain("degree:Bachelor's Degree");
expect(status).toContain("veteran:I don't wish to answer");
expect(status).toContain("disability:No");
```

If the fix were reverted (global fallback restored), the test would **still pass** because the correct options exist on the page. The old bug was that candidates from the phone listbox ALSO appeared and confused the LLM — not that selection always failed. This E2E test would not catch a regression.

**Suggested fix:** Add a cell that calls `page.select_option` with a phone-only value and asserts it fails:
```typescript
// Inside the same cell, after the three successful selections:
'const phoneResult = await page.select_option({ refId: country.refId, value: "Canada +1" });',
// This should succeed — the country combobox has Canada +1
// But then try selecting a phone value on a non-phone combobox:
'const degreePhoneResult = await page.select_option({ refId: degree.refId, value: "Canada +1" });',
// This MUST fail — Canada +1 is not in the degree listbox
// If it succeeded, the scoping fix is broken (global fallback leaked phone options)
'print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { degreePhoneOk: degreePhoneResult.ok } }));',
```
Then assert `degreePhoneOk` is `false`:
```typescript
// Outside the cell, in the test assertion:
expect(exec.result?.value.degreePhoneOk).toBe(false);
```

---

## Warnings

### W7. `resolveListboxRoots` hides activation side effect

**Absolute path:** `/Users/oujunyi/code/web-js/crates/extension-js/js/src/content-script/handlers.ts:372-418` (function), `:383-386` (side effects)

**Problem:** The function name `resolveListboxRoots` suggests read-only resolution, but the function also activates the control (dispatches `mouseover`/`mousedown`/`mouseup`/`click`). The call site at line 656 doesn't signal that the page will be mutated:
```typescript
const { roots, searchedIds, ignoredIds } = resolveListboxRoots(control);
```

**Suggested fix:** Rename to `activateAndResolveListboxRoots`, or split into two functions:
```typescript
function activateCombobox(control: HTMLElement): void {
    for (const evName of ["mouseover", "mousedown", "mouseup"]) {
        control.dispatchEvent(new MouseEvent(evName, { bubbles: true, cancelable: true }));
    }
    control.click();
}

function resolveListboxRoots(
    control: HTMLElement,
    listboxesBefore: Map<HTMLElement, { hidden: boolean; content: string }>,
): { roots: HTMLElement[]; searchedIds: string[]; ignoredIds: string[] } {
    // ... only root resolution, no activation ...
}
```

Then at the call site:
```typescript
activateCombobox(control);
const { roots, searchedIds, ignoredIds } = resolveListboxRoots(control, listboxesBefore);
```

This makes the mutation visible and allows each piece to be tested independently.

---

### W8. Redundant third `querySelectorAll('[role="listbox"]')` for `ignoredIds`

**Absolute path:** `/Users/oujunyi/code/web-js/crates/extension-js/js/src/content-script/handlers.ts:412-415`

**Problem:** `ignoredIds` issues a third full DOM query for `[role="listbox"]`. The post-activation set is already captured at line 394-402. This third query is paid on every call, not just the error path.

| # | Line | Purpose |
|---|------|---------|
| 1 | 375-382 | `listboxesBefore` Map (pre-activation) |
| 2 | 394-402 | `activatedRoots` filter (post-activation) |
| 3 | 412-415 | `ignoredIds` (post-activation, for error diagnostics) |

**Suggested fix:** Capture the post-activation set once and reuse it. Also, lazily compute `ignoredIds` only in the error path:
```typescript
// After the click, collect all listboxes once:
const allListboxes = Array.from(
    document.querySelectorAll<HTMLElement>('[role="listbox"]'),
);
const activatedRoots = allListboxes.filter((listbox) => { /* ... */ });
// ... build roots ...

// Return the full set so the caller can compute ignoredIds lazily:
return {
    roots,
    get searchedIds() { return roots.map((r) => r.id).filter(Boolean); },
    get ignoredIds() {
        return allListboxes
            .filter((lb) => !roots.includes(lb) && !isSelfOrAncestorHidden(lb))
            .map((r) => r.id)
            .filter(Boolean);
    },
};
```

Or simply: move the `ignoredIds` computation inside the `if (!match)` block at line 664 so the common (success) path pays for only two queries.

---

### W9. `innerHTML` comparison is fragile for activatedRoots detection

**Absolute path:** `/Users/oujunyi/code/web-js/crates/extension-js/js/src/content-script/handlers.ts:400`

**Problem:**
```typescript
return !isSelfOrAncestorHidden(listbox) &&
    (!before || before.hidden || before.content !== listbox.innerHTML);
```

`innerHTML` serialization varies across browsers (attribute ordering, whitespace, self-closing tags). A listbox with dynamic content (timestamps, animation classes, `data-*` attributes) will have different `innerHTML` on every read, falsely classifying it as "activated".

**Suggested fix:** Track only visibility changes, not content changes. Content comparison was unnecessary for the Greenhouse bug (the target listbox was a new element, `before` was `undefined`). Simpler and more robust:
```typescript
const activatedRoots = allListboxes.filter((listbox) => {
    const before = listboxesBefore.get(listbox);
    return !isSelfOrAncestorHidden(listbox) &&
        (!before || before.hidden);
});
```

If content comparison is genuinely needed (e.g., a hidden listbox that becomes populated without changing visibility), use `childElementCount` or check if `querySelectorAll('[role="option"]')` length changed — both are more reliable than `innerHTML`.

---

### W10. TOCTOU inconsistency between `roots` and `ignoredIds`

**Absolute path:** `/Users/oujunyi/code/web-js/crates/extension-js/js/src/content-script/handlers.ts:394-415`

**Problem:** `roots` is built from one DOM snapshot (lines 394-408), then `ignoredIds` queries the DOM AGAIN (line 412). If a framework adds/removes a listbox between these two queries (MutationObserver callback, async render, animation frame), `searchedIds` and `ignoredIds` become inconsistent — a listbox could appear in `ignoredIds` that wasn't considered when `roots` was built.

**Suggested fix:** This is automatically fixed by W8 (capture `allListboxes` once post-activation and derive both `activatedRoots` and `ignoredIds` from the same array).

---

### W11. Dual import paths for error factories

**Absolute paths:**
- `/Users/oujunyi/code/web-js/crates/extension-js/js/src/content-script/handlers.ts:27-33` — imports from `agent-errors.js`
- `/Users/oujunyi/code/web-js/crates/extension-js/js/src/content-script/action-result.ts:1-4` — imports from `normalize-agent-error.js`
- `/Users/oujunyi/code/web-js/crates/extension-js/js/src/content-script/dom-utils.ts:1-6` — imports from `normalize-agent-error.js`

**Problem:** Both `agent-errors.ts` and `normalize-agent-error.ts` export `throwStructuredAgentError`, `labelNotFoundError`, etc. `normalize-agent-error.ts` is a superset re-export. Different consumers import from different paths, suggesting the codebase hasn't settled on a canonical import path.

**Suggested fix:** Pick one canonical path. Easiest: switch `handlers.ts` to import from `normalize-agent-error.js` for consistency with the other two files.

---

### W12. `nearbyRoots` path (descendant listboxes) untested

**Absolute path:** `/Users/oujunyi/code/web-js/crates/extension-js/js/src/content-script/handlers.ts:403-404`

**Problem:** `control.querySelectorAll('[role="listbox"]')` finds listboxes nested inside the control. No test places a listbox as a child of the combobox — all tests append portal listboxes to `document.body`.

**Suggested fix:** Add a unit test:
```typescript
it("selects option from listbox nested inside the combobox control", async () => {
    document.body.innerHTML = `
        <div role="combobox" aria-label="Pick">
            <div role="listbox">
                <div role="option" data-target>Nested Option</div>
            </div>
        </div>
    `;
    // ... snapshot, select_option, assert clicked
});
```

---

### W13. Case-insensitive matching not tested

**Absolute path:** `/Users/oujunyi/code/web-js/crates/extension-js/js/src/content-script/handlers.ts:660-662`

**Problem:** The normalized matching `.toLowerCase()` is not tested with different casing. All tests use exact-case values.

**Suggested fix:** Add a test case in the existing `"persistent unrelated phone listbox does not poison degree combobox selection"` test (or a separate one): pass `"bachelor's degree"` (lowercase) and assert it still matches `"Bachelor's Degree"`.

---

## Suggestions

### S14. `selfRoot` may be dead code — verify or remove

**Absolute path:** `/Users/oujunyi/code/web-js/crates/extension-js/js/src/content-script/handlers.ts:407`

**Problem:** `control.getAttribute("role") === "listbox"` — when would `select_option` receive a `refId` pointing directly to a listbox element? The handler at line 636 calls `resolveTargetRaw(params.refId, params.label)`, which resolves the refId to an element. If a snapshot assigns a refId to a listbox (not a combobox inside it), this fires. But in practice, snapshots assign refIds to interactive elements (comboboxes, inputs), not to listbox containers. If unreachable, remove it; if reachable, add a test (see B5).

**Suggested fix:** Verify with the snapshot code whether listbox elements ever get `data-ref-id` attributes. If not, remove the `selfRoot` line. If yes, add a test.

---

### S15. No option-level deduplication

**Absolute path:** `/Users/oujunyi/code/web-js/crates/extension-js/js/src/content-script/handlers.ts:657-659`

**Problem:** The old code used `new Set([...scopedOptions, ...globalOptions])` to deduplicate options. The new code drops deduplication:
```typescript
const options = roots.flatMap((root) =>
    Array.from(root.querySelectorAll<HTMLElement>('[role="option"]')),
);
```

While `roots` is deduplicated via `new Set` at line 408, the same option element could appear under two different root listboxes (e.g., a listbox that appears both as a `linkedRoot` via `aria-controls` AND as an `activatedRoot`). This causes duplicate candidates with different synthetic `refId` values in error details.

**Suggested fix:** Add `[...new Set(options)]` after the flatMap:
```typescript
const options = [...new Set(
    roots.flatMap((root) =>
        Array.from(root.querySelectorAll<HTMLElement>('[role="option"]')),
    ),
)];
```

---

### S16. JSDoc mismatch: "three sources" but code has four; "priority order" is misleading

**Absolute path:** `/Users/oujunyi/code/web-js/crates/extension-js/js/src/content-script/handlers.ts:362-365`

**Problem:**
```typescript
/**
 * Roots are gathered from three sources, in priority order:
 * 1. linkedRoots — elements referenced by the control's `aria-controls` / `aria-owns`.
 * 2. activatedRoots — listboxes that became visible or changed content after activation.
 * 3. nearbyRoots  — listboxes nested inside the control element.
 */
```

The code has four sources (including `selfRoot`). "Priority order" implies one source overrides another, but the `Set` deduplication preserves first-encountered order, and all roots are treated equally when collecting options. The ordering has no functional effect on which option is matched.

**Suggested fix:**
```typescript
/**
 * Activate a combobox control and collect the listbox roots that belong to it.
 *
 * Roots are gathered from four sources:
 * 1. linkedRoots — elements referenced by the control's `aria-controls` / `aria-owns`.
 * 2. activatedRoots — listboxes that became visible after activation.
 * 3. nearbyRoots  — listboxes nested inside the control element.
 * 4. selfRoot     — the control itself when its role is "listbox".
 *
 * Unrelated listboxes that were already visible and unchanged before activation
 * (e.g. a persistent phone-country widget) are excluded and returned in `ignoredIds`.
 *
 * The control receives mouseover/mousedown/mouseup + click to trigger widget open.
 */
```

---

### S17. Case-insensitive matching asymmetry between native `<select>` and combobox paths

**Absolute paths:**
- `/Users/oujunyi/code/web-js/crates/extension-js/js/src/content-script/handlers.ts:639-643` (native: exact then case-insensitive)
- `/Users/oujunyi/code/web-js/crates/extension-js/js/src/content-script/handlers.ts:660-662` (combobox: case-insensitive only)

**Problem:** The native `<select>` path does a two-pass match: exact-trim first, then case-insensitive fallback. The combobox path does only case-insensitive. If options exist that differ only in case (`"C"` vs `"c"`), the combobox path picks the first DOM-ordered match rather than preferring exact case.

**Suggested fix:** Align the combobox path with the native `<select>` path:
```typescript
const match = options.find(
    (o) => (o.textContent || "").trim() === value.trim(),
) || options.find(
    (o) => (o.textContent || "").trim().toLowerCase() === value.trim().toLowerCase(),
);
```

---

## Summary

| Severity | Count | Key Themes |
|----------|-------|------------|
| **Blocking** | 6 | Error divergence (B1/B2), missing fallback safety net (B3), untested code paths (B4/B5), E2E doesn't prove fix (B6) |
| **Warning** | 7 | Side-effect naming (W7), redundant DOM queries (W8), fragile detection (W9), TOCTOU (W10), import inconsistency (W11), untested paths (W12/W13) |
| **Suggestion** | 4 | Dead code (S14), missing dedup (S15), stale comments (S16), matching asymmetry (S17) |

**Recommended fix order:**
1. B1 + B2 together (extend `labelNotFoundError`) — unifies error shape and fixes formatting
2. B4 (non-listbox aria-controls filter) — one-line fix
3. B5 + W12 + W13 (add missing tests)
4. B6 (strengthen E2E test)
5. W7 (rename/split function)
6. W8 (lazy-compute ignoredIds)
7. B3 (decide on fallback strategy after testing)
8. W9, W10, W11, S14-S17 — follow-up cleanup
