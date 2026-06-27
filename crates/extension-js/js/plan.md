# Plan: Async listbox resolution for `select_option`

## Summary

`page.select_option` fails against React-Select / Greenhouse / Downshift
comboboxes because `activateAndResolveListboxRoots`
(`crates/extension-js/js/src/content-script/listbox.ts:145`) reads the DOM
**synchronously** after the activating `click()`. Those frameworks render
`[role=listbox]` in a microtask after the click handler calls `setState`, so
at the moment of resolution `[role=listbox]` does not exist yet → `roots` is
empty → `select_option` throws `E_NOT_FOUND`.

Fix: make `activateAndResolveListboxRoots` `async` and await a small bounded
number of animation frames after each activation, re-resolving the roots on
each frame until they are non-empty (or the budget is exhausted). No new APIs,
no new params, no polling abstraction. The single caller (`select_option`)
becomes `async`, which the handler registry already permits
(`ContentScriptHandler` returns `unknown | Promise<unknown>`, awaited by
`dispatchContentScriptCall`).

---

## 1. Interface change

### `activateAndResolveListboxRoots` (`listbox.ts:145`)

```ts
// before
export function activateAndResolveListboxRoots(control: HTMLElement): {
  roots: HTMLElement[];
  searchedIds: string[];
  allListboxes: HTMLElement[];
  ariaControlsBefore: string | null;
  ariaControlsAfter: string | null;
}

// after  — ONLY the return type becomes a Promise; the value shape is identical
export async function activateAndResolveListboxRoots(
  control: HTMLElement,
): Promise<{
  roots: HTMLElement[];
  searchedIds: string[];
  allListboxes: HTMLElement[];
  ariaControlsBefore: string | null;
  ariaControlsAfter: string | null;
}>
```

Body change (minimal — keep it the single entry point, do not split):

```ts
const ariaControlsBefore = control.getAttribute("aria-controls");
const beforeMap = snapshotListboxes();

activateElement(control);
let { roots, allListboxes } = await waitForRoots(control, beforeMap);
if (roots.length === 0) {
  const trigger = findNearbyPopupTrigger(control);
  if (trigger) {
    activateElement(trigger);
    ({ roots, allListboxes } = await waitForRoots(control, beforeMap));
  }
}
const ariaControlsAfter = control.getAttribute("aria-controls");
const searchedIds = roots.map((r) => r.id).filter(Boolean);
return { roots, searchedIds, allListboxes, ariaControlsBefore, ariaControlsAfter };
```

`waitForRoots` is a **private** (non-exported) helper inside `listbox.ts`:

```ts
const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

// ponytail: bounded wait — React flushes in a microtask one rAF ahead is
// enough; budget of ~10 frames (~160ms@60Hz) covers a second async render
// pass (Suspense/concurrent) without becoming an open-ended poll. No
// setInterval/setTimeout polling abstraction.
const waitForRoots = async (
  control: HTMLElement,
  beforeMap: ListboxBefore,
): Promise<{ roots: HTMLElement[]; allListboxes: HTMLElement[] }> => {
  let resolved = resolveListboxRoots(control, beforeMap);
  for (let i = 0; i < 10 && resolved.roots.length === 0; i++) {
    await nextFrame();
    resolved = resolveListboxRoots(control, beforeMap);
  }
  return resolved;
};
```

`resolveListboxRoots` and `activatedListboxes` are unchanged.

### `select_option` (`handlers.ts:405`)

```ts
// before
select_option: (params: PageSelectOptionParams) => { … }

// after — arrow body becomes async; rest of the body is byte-identical
//         except the single await added at the destructure:
select_option: async (params: PageSelectOptionParams) => {
  …
  const {
    roots, searchedIds, allListboxes, ariaControlsBefore, ariaControlsAfter,
  } = await activateAndResolveListboxRoots(control);   // ← +await
  … // unchanged from line 440 to the end of the handler
}
```

`ContentScriptHandler` (`registry.ts:8`) already allows
`unknown | Promise<unknown>`; `dispatchContentScriptCall` (`registry.ts:87`)
already `await`s the handler. The `handlers` record type at `handlers.ts:860`
(`Record<string, (params, signal?) => unknown>`) already accepts a returned
Promise. **No type changes anywhere outside `listbox.ts`.**

The native `<select>` branch (`handlers.ts:409-432`) stays synchronous — the
`async` on the arrow just means it returns a resolved Promise, which is
harmless.

---

## 2. Await / retry strategy

### Primitive: `requestAnimationFrame`

- **Production (Chrome content-script):** `requestAnimationFrame` is native
  and fires before paint, after the current task's microtasks have drained.
  React's `setState` from a synthetic event handler flushes either
  synchronously (legacy) or as a microtask (concurrent) — both complete
  before the next rAF callback. rAF therefore correctly observes the
  post-render DOM.
- **Tests (vitest `environment: "jsdom"`):** confirmed by probe —
  `typeof requestAnimationFrame === "function"` in the actual vitest jsdom
  env (vitest 1.6.1 polyfills it; bare jsdom 29 does **not**, which is why the
  probe was necessary). The first tracer-bullet test (below) re-asserts this
  implicitly: if rAF were absent the test would hang/throw, not fail cleanly.

`queueMicrotask` alone is **insufficient**: React concurrent mode may need a
second render pass and, more importantly, microtasks do not interleave with
paint/layout the way rAF does — a rAF-based wait is strictly more general and
costs nothing extra. `setTimeout(0)` is clamped to ~4ms minimum in real
browsers, adding avoidable latency; rAF is ~16ms-cadence but only sleeps when
it actually has to (loop exits on first non-empty resolution).

### Retry budget: 10 frames (~160 ms @ 60 Hz)

- One frame is enough for the common case (React flushes within a
  microtask → visible by next frame).
- The 10-frame ceiling covers a two-pass concurrent render and any CSS
  transition that gates visibility, without becoming an open-ended poll.
- The loop **exits on the first frame where `roots.length > 0`** — the happy
  path pays exactly one `await nextFrame()`.
- Bounded = no risk of hanging `select_option`. On exhaustion the handler
  proceeds with `roots = []` and throws the existing
  `labelNotFoundError` with `searchedIds: []` — same observable failure as
  today, just no longer instantaneous.

### Why not a polling abstraction / `waitFor` helper

YAGNI. The loop is 6 lines, lives next to its only caller, and has no caller
beyond `select_option`. A reusable `waitFor` would be premature.

---

## 3. Vertical-slice TDD sequence

One test at a time. Each slice: write the failing test → make the minimal
change that turns it green → (optional) refactor. Never batch tests.

### Slice 1 — TRACER BULLET (the bug repro)
**Test** (`content-script.test.ts`, inside the existing
`describe("select_option handler", …)`):
copy the "react-select combobox" test (line ~2641) but move the listbox
creation into `queueMicrotask` (models React's deferred render):

```ts
control.addEventListener("click", () => {
  control.setAttribute("aria-expanded", "true");
  queueMicrotask(() => {
    const listbox = document.createElement("div");
    listbox.setAttribute("role", "listbox");
    listbox.innerHTML =
      '<div role="option">Yes</div><div role="option">No</div>';
    document.body.appendChild(listbox);
  });
});
… // assert result.ok && optionClicked === "Yes"
```

- **RED:** `select_option` returns `{ ok: false, code: "E_NOT_FOUND" }`
  because the listbox does not exist at the synchronous resolution moment.
- **GREEN (minimal):** change `activateAndResolveListboxRoots` to `async`,
  add `await nextFrame()` after `activateElement(control)` (before the first
  `resolveListboxRoots`), make `select_option` `async` + `await` the call.
  This is enough to pass slice 1; the loop/budget is added in slice 3.

### Slice 2 — async via the nearby-trigger fallback
**Test:** combobox whose flyout only appears after clicking a *sibling popup
trigger* (the `findNearbyPopupTrigger` path, line 157-163), and that trigger's
handler renders the listbox in `queueMicrotask`.
- **RED:** fails today because the trigger branch also resolves synchronously.
- **GREEN:** add the same `await nextFrame()` inside the
  `if (trigger) { … }` block. (Minimal: still single `await`, no loop.)

### Slice 3 — multi-frame render (two rAFs needed)
**Test:** listbox appended inside a *nested* `queueMicrotask` — i.e. the click
handler schedules a microtask that itself schedules the render microtask (or
uses `requestAnimationFrame` to render). One frame is not enough; the loop is
required.
- **RED** against the slice-2 impl (single await).
- **GREEN:** replace the two bare `await nextFrame()` calls with the
  `waitForRoots(control, beforeMap)` bounded loop (10 frames, exit-on-first
  non-empty). Slices 1 & 2 stay green because the loop resolves on frame 1.

### Slice 4 — sync-render regression guard (already-green, keep)
**Test:** the **existing** "react-select combobox" test (line 2641) and
"combobox opened by mousedown" (line 2693) MUST remain green. They append the
listbox synchronously inside the handler. With the loop, `roots` is non-empty
on frame 0 OR frame 1 — either way they pass.
- **Action:** run the full `select_option handler` describe block. No new
  code; this slice exists to *prove the await didn't break the sync path*.
  If any fail, the fix is in `waitForRoots` (e.g. resolve synchronously first,
  then loop — which the proposed impl already does).

### Slice 5 (optional) — exhaustive-budget no-hang guard
**Test:** a combobox whose click handler renders **nothing**. Assert
`select_option` rejects with `E_NOT_FOUND` and that the whole call completes
in well under, say, 500 ms (use `Date.now()` delta). Confirms the budget is
bounded and the handler never hangs.
- **GREEN:** no code change if slice 3 used the 10-frame budget; this test
  just pins the bound.

(~4 mandatory slices + 1 optional. Each slice's impl is the smallest diff
that satisfies it — never write the loop before slice 3 forces it.)

---

## 4. `activatedListboxes` signature logic — no change needed

`activatedListboxes(beforeMap)` (`listbox.ts:105`) decides a listbox is
"activated" if it is newly visible OR its option-signature changed since
`beforeMap` (the snapshot taken **before** `activateElement`).

After the fix, `beforeMap` is still captured **synchronously before**
activation (line 148, unchanged), and `resolveListboxRoots` is still called
**after** activation — only the *timing* of the after-call shifts by a few
frames. The before/after comparison is purely a function of DOM state at two
instants; it does not care how much wall-time passed between them.

Edge case to confirm (slice 4 covers it): a listbox that **already existed
and was already visible** before activation (e.g. the "stale listbox" in the
"combobox opened by mousedown" test). Its signature is unchanged →
`activatedListboxes` correctly excludes it → the `linkedListboxes` /
`aria-controls` path still does the selection. Awaiting frames does not flip
this: the stale listbox is still not "activated".

**Conclusion: `activatedListboxes` needs no adjustment.** The only thing the
await changes is *when* we look — and we look after the framework has had a
chance to render, which is exactly what we want.

---

## 5. Acceptance criteria (observable behavior)

1. **Async-rendered combobox selects:** `page.select_option` on a combobox
   whose `[role=listbox]` is appended in a `queueMicrotask` (or
   `requestAnimationFrame`) inside the click handler returns
   `{ ok: true, value: { selectedText: <option text> } }` and the matching
   `[role="option"]` receives a `click` event.
2. **Async-rendered via nearby trigger:** same as (1) when the listbox is
   revealed by a sibling popup trigger (the `findNearbyPopupTrigger`
   fallback), rendered asynchronously.
3. **Bounded:** if no listbox ever renders, `select_option` rejects with
   `code: "E_NOT_FOUND"` and the call returns within ~500 ms (10 frames +
   overhead), never hanging.
4. **No sync-path regression:** every existing test in the
   `select_option handler` describe block (lines 2598–2873) — native
   `<select>`, synchronous react-select, mousedown-opened combobox, unlinked
   combobox, aria-controls linkage, nearby-trigger, signature-replacement —
   stays green.
5. **Error diagnostics intact:** on a genuine no-match, `error.details`
   still carries `searchedIds`, `ignoredIds`, `targetRefId`, `targetName`,
   `ariaControlsBefore`, `ariaControlsAfter`, `isDropdown: true`, and
   `candidates` (possibly now populated where it was previously empty).

---

## 6. Risks

### (a) Do existing sync tests break?
**No (verified by reasoning; slice 4 proves it).** All existing tests append
the listbox **synchronously inside** the activation handler. With the bounded
loop, `resolveListboxRoots` is tried once *before* any await (the proposed
`waitForRoots` resolves synchronously first, then loops), so the sync tests
get a non-empty `roots` on attempt 0 and never await a frame. Even if the
impl awaited unconditionally on the first iteration, the sync tests would
still pass (one extra frame is harmless when roots already exist). The
`async` signature on `select_option` is transparent to the tests because they
all already `await dispatchContentScriptCall(...)`.

### (b) `ariaControlsAfter` (line 164) — different value after React renders
This is **desirable, not a regression.** `ariaControlsAfter` is captured for
*diagnostic* purposes (included in `error.details.ariaControlsAfter` on a
no-match). Today, against an async combobox, `ariaControlsAfter` is read
*before* the framework sets `aria-controls` to point at the (not-yet-rendered)
listbox — so the diagnostic is wrong/useless. After the fix, it is read
*after* the awaited render, so it reflects the real post-activation state.
For sync comboboxes (existing tests), `aria-controls` is set inside the sync
handler before `activateElement` returns, so `ariaControlsBefore`/`After` are
unchanged by the await — no behavioral change for them.
The only observable difference is in the **error-details payload of a
no-match on an async combobox**, where the value becomes *more* accurate.
`ariaControlsBefore` is still captured synchronously before activation, so
the before/after diff still works as designed.

### (c) Other callers of `activateAndResolveListboxRoots`
**Confirmed by search: exactly one caller** — `handlers.ts:439`
(`select_option`). The only other occurrences are in `CHANGELOG.md` (docs)
and `CODE_REVIEW_select_option_listbox_scoping.md` (review notes). There are
no other production callers to migrate. The async signature change is
therefore fully scoped to: `listbox.ts` (signature + body) and the single
`await` in `handlers.ts`.

### (d) jsdom `requestAnimationFrame` availability
**Confirmed present** in the actual vitest jsdom environment (probed:
`typeof requestAnimationFrame === "function"`). The first tracer-bullet test
implicitly re-confirms this — if rAF were missing the test would error rather
than cleanly fail, which would itself be a signal to fall back to
`setTimeout(0)` (also present in jsdom). No fallback is needed at present.

### (e) Production latency
One `await nextFrame()` (~16 ms) on the happy path. Negligible for a
human-speed `select_option` action; far cheaper than the model's current
12-step manual `click+sleep+snapshot+click` detour that this fix eliminates.

### (f) Re-entrancy / double-activation
None. The function is called once per `select_option`; the await happens
between activation and resolution within a single call. No global state is
held across the await.

---

## Critical files the implementer must read

- `crates/extension-js/js/src/content-script/listbox.ts` (full, 175 lines) —
  `activateAndResolveListboxRoots` (145), `resolveListboxRoots` (129),
  `activatedListboxes` (105), `findNearbyPopupTrigger` (63),
  `snapshotListboxes` (86), `activateElement` (120).
- `crates/extension-js/js/src/content-script/handlers.ts:405-488` —
  `select_option` (the sole caller).
- `crates/extension-js/js/src/content-script/registry.ts:8,87` — confirms
  async handlers are already supported and awaited.
- `crates/extension-js/js/test/content-script.test.ts:2598-2873` — existing
  `select_option handler` tests; the location for new slices.
- `crates/extension-js/js/vitest.config.ts` — confirms `environment: "jsdom"`.

## Constraints honored

- Extension-JS context only. ✓
- No new public APIs / params (return type widens to `Promise<…>`, value
  shape identical). ✓
- Places Autocomplete untouched. ✓
- Lease unification untouched (issue #4). ✓
- Ponytail: 6-line `waitForRoots`, one `async`/`await` in the caller, no new
  abstraction. ✓
