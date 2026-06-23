# Changelog

All notable changes to this project are documented in this file. The format
is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).


## [0.11.0] — 2026-06-23

### Fixed — `page.select_option` listbox scoping (code review fixes)

- **Unified error shape (B1+B2)**: combobox `select_option` no-long-found errors now go through `labelNotFoundError` instead of an inline `AsyncError`. The factory accepts an optional `extra` param (`searchedIds`, `ignoredIds`, `targetRefId`, `targetName`) and emits a dynamic hint. Empty candidates produce `Candidates: none` instead of a trailing `Candidates: ` with nothing after.
- **Non-listbox `aria-controls` filtered (B4)**: `aria-controls`/`aria-owns` pointing to a non-listbox element (e.g. a plain `<div>`) is now excluded from `searchedIds` — only `role="listbox"` targets count.
- **Lazy `ignoredIds` (W8+W10)**: `ignoredIds` is computed only on the error path from a single `allListboxes` snapshot instead of a redundant third `querySelectorAll` — eliminates a TOCTOU gap.
- **Option-text signature (W9)**: `activatedRoots` detection compares option text signatures instead of raw `innerHTML`, removing fragility from attribute reordering/timestamps. Captures visible-but-content-changed listboxes that pure visibility tracking would miss.
- **Deduplicated options (S15)**: `[...new Set(...)]` around the root flatMap removes duplicate option elements when listbox roots overlap.
- **Two-pass matching (S17)**: combobox option matching now tries exact text first, then case-insensitive — aligned with the native `<select>` path.
- **Renamed `resolveListboxRoots` → `activateAndResolveListboxRoots` (W7)**: name reflects that the function dispatches mouse events + click in addition to resolving roots.
- **Unified import path (W11)**: `handlers.ts` imports error factories from `normalize-agent-error.js`, matching `action-result.ts` and `dom-utils.ts`.

### Added — tests & E2E fixture

- **7 new `select_option` unit tests** covering `aria-owns` standalone, multi-ID `aria-controls`, `selfRoot` (control is a listbox), `aria-controls` pointing to non-listbox, `nearbyRoots` (nested listbox), case-insensitive matching, and empty-roots error.
- **Greenhouse-combobox E2E (B6)**: strengthened with a negative assertion — selecting `"Canada +1"` (phone-only value) on the degree combobox must return `{ ok: false }`, proving the scoping fix would fail if the global fallback were restored.

### Fixed — `page.select_option` listbox scoping (initial)

- **Scoped option search to target popup**: removed the global `document.querySelectorAll('[role="listbox"] [role="option"]')` fallback from `select_option`. Option search now uses only roots linked to the target combobox (`aria-controls`/`aria-owns`, activation-revealed listboxes, descendant listboxes, or the listbox itself when the refId points directly to one). Persistent unrelated listboxes like `#iti-0__country-listbox` (intl-tel-input, 244 country options) no longer poison the candidate set.
- **Structured error diagnostics**: `select_option` errors on non-`<select>` comboboxes now include `targetRefId`, `targetName`, `searchedIds`, `ignoredIds`, and scoped `candidates` in `error.details` so the agent can see which listboxes were searched versus ignored instead of guessing from flat candidates.
- **`activateAndResolveListboxRoots` helper** extracted from the `select_option` handler — collects linked/activated/nearby/self listbox roots and computes searched/ignored id lists.

### Added — Greenhouse combobox E2E fixture

- **New testcase**: `testcases/greenhouse-combobox/` — job application form with persistent `#iti-0__country-listbox` (5 country options) plus three react-select-style portal comboboxes (Degree, Veteran Status, Disability Status). The phone listbox remains visible in DOM after selection, replicating the Greenhouse poisoning condition.
- **New spec**: `web/tests/e2e/extension/greenhouse-combobox.spec.ts` — verifies `select_option` fills all three react-select fields despite the persistent phone listbox.

## [0.10.3] — 2026-06-22

### Added — complex form support

- **`page.select` accepts `value: string | string[]`**: multi-select support. Passing an array picks multiple options on `<select multiple>`; passing `[]` clears the selection. Single-select rejects arrays >1 with `E_NOT_INTERACTABLE` (`single_select_multiple_values`).
- **`page.fill` accepts `[contenteditable]` elements**: sets `innerText` + dispatches `input`. Previously rejected non-input elements.
- **`page.press` accepts optional `refId`/`label`**: dispatches `keydown`/`keyup` on the targeted element (falls back to `document` for backwards compatibility).
- **`page.submit`** (new): calls `form.requestSubmit()` on a `<form>` element or the form owning the target. Fires submit listeners + validation.
- **`page.checkRadio`** (new): picks a radio by `name` + `value` without needing a refId. Reports candidates when the value is missing.
- **Snapshot option discoverability**: `<option>` nodes now expose `value` + `selected` fields in `page.snapshot_data()` / `page.snapshot()` results. `<select multiple>` exposes all selected values as a comma-joined `value`. Agents can now read valid option values from the snapshot and feed them to `page.select`.
- **New testcase**: `testcases/complex-form/` — text, email, password, number, range, date, textarea, native select (single + multiple), radio group, checkbox group, file input, contenteditable, custom ARIA listbox, submit button.
- **New spec**: `web/tests/e2e/extension/complex-form.spec.ts` — 15 serial tests covering all new APIs + regression of existing fill/select/setFiles/click/select_option on every element kind.


### Added — observation lease (content-script)

- **Tab-document-local observation lease** that enforces `observe → act → re-observe`. Element actions (`click`, `fill`, `press`) now require an active observation granted by a prior `snapshot` / `snapshot_data` / `snapshot_text` / `snapshot_query`. The Google Flights failure mode — one observation reused across four chained clicks — is now structurally impossible.
- **MutationObserver-based invalidation**: structural DOM changes (added/removed nodes) invalidate the lease. Attribute, class, style, value, and text changes do **not** invalidate, so form fills stay actionable across one observation.
- **Target re-validation at action time** (`requireTarget`): even if the observer misses an async mutation, action dispatch re-checks lease membership, Element identity, `isConnected`, and fingerprint (tag / accessible role / accessible name) before touching the DOM.
- **New error codes**: `E_OBSERVATION_REQUIRED`, `E_AMBIGUOUS_TARGET`. `E_STALE` gains a `reason` field: `not_in_latest_observation | disconnected | fingerprint_changed`.
- **Receipt enrichment**: action results now carry `observationId`, `dispatched: true`, `verification: "required"`.

### Fixed

- **Ancestor visibility**: `isHiddenElement` and `assertInteractable` now walk ancestors (`display:none` / `visibility:hidden` / `aria-hidden=true` / `inert`).
- **Context-changing handlers** (`back`, `forward`, `scroll`) now invalidate the lease.
- **E2e flakiness eliminated**: `assertNoHarnessErrors` now filters benign 404 resource load errors from fixture routes; `define-chrome-namespace` clears error arrays per test; `navigation.spec` snapshot_query tests activate an http tab as fallback when no `SNAPSHOT_QUERY_URL` tab exists. 193/193 pass with `--retries=0`.

### Migration notes for consumers

- Callers that invoke `click` / `fill` / `press` without a prior snapshot now receive `E_OBSERVATION_REQUIRED`. Recovery: take a fresh `snapshot_data()` and use a refId from its returned nodes.
- `find` does not grant a lease (discovery-only); refs from `find` must be re-observed via `snapshot_data` before acting.

## [0.9.0] / [0.9.1] — 2026-06-14

- `setTimeout` / `setInterval` sandboxing, `page_goto` side-panel guard, relay hardening. (Previously shipped without a changelog entry.)
## [0.8.3] — 2026-06-13

### Changed

- **Relative paths now resolve against root `/`** instead of `/tmp/`. `fs.writeText("foo.txt", ...)` now writes to `/foo.txt` — direct mental model, no surprise. The `/tmp/` anchor in 0.8.2 imported POSIX "self-cleaning scratch" semantics that don't apply to OPFS (the directory never auto-cleans), and made files invisible to UI panels that only scan certain roots. Tests renamed accordingly: `relative_path_resolves_to_root`, `root_path_yields_empty_parts`.

## [0.8.2] — 2026-06-13

### Changed

- **`fs.*` paths now accept relative paths**, anchored at `/tmp/`. `fs.writeText("foo.txt", ...)` now writes to `/tmp/foo.txt`. Absolute paths still pass through unchanged. Eliminates the LLM's `E_INVALID_PATH` retry loop observed when creating files.
- **`FsError::InvalidPath` now carries context** — wire messages look like `E_INVALID_PATH: parent traversal (..) not allowed in ../etc/passwd` instead of the bare `E_INVALID_PATH`. The structured `wire_code` remains `E_INVALID_PATH` for machine consumers.
- **`fs.*` API docs** in both `extension-js` and `web-js` now explicitly state path rules (absolute vs relative anchoring) and auto-create behavior on writes/append/mkdir. Replaces the misleading bare `"File path"` param description.
- Extracted `path_parts` from wasm-only `opfs.rs` into a non-wasm-gated `crates/web-fs/src/path_util.rs` so the path-validation logic is covered by native unit tests (6 cases: absolute passthrough, relative anchoring, `.` skip, `..` rejection, empty rejection, `/tmp` passthrough).

## [0.8.1] — 2026-06-13

### Changed

- Workspace-wide Biome formatting normalization; added `biome.json` configs for `web/` and `crates/extension-js/js/`.
- Refactored `executeMainThreadCommand` to satisfy complexity lint.
- Fixed `clippy::useless_conversion` in `crates/web-js/src/browser_api.rs`.

### Fixed

- Corrected Chrome MV3 types in `network-tracker.ts`: `ResourceType` now uses template-literal type, and detail type names (`OnBeforeRequestDetails`, `OnCompletedDetails`, `OnErrorOccurredDetails`) match `@types/chrome`.
- Reverted Biome's unsafe `useArrowFunction` fix in test stubs (arrow functions cannot be used as constructors with `new`).

## [0.8.0] — 2026-06-13

### Added

- **`page.snapshot_query` / `web.tab.snapshot_query`** — semantic filtering of page snapshots by `role`, `tag`, `text`, `name`, `href`, `src`, or `interactiveOnly`. Filter uses union types with RegExp/substring support for free-text fields, lowercases comparisons for case-insensitive ARIA role matching, and guards against non-string filter values from untrusted input.
- **Programmatic `session.snapshot.query()` API** for the Browsergent runtime.
- **`page.goto(waitUntil: "networkidle")`** — waits until no in-flight network requests for 500ms (Playwright-compatible). Uses `chrome.webRequest` observer (MV3 compatible). Default `"load"` behavior unchanged. Includes slow-network testcase and E2E tests verifying `networkidle` waits for delayed fetches while `load` returns early.
- **`page.setFiles` / `web.tab.setFiles`** with three file sources:
  - `url`: fetched directly in the target tab content script.
  - `path`: resolved from VFS (with wasm-side write cache to avoid OPFS re-read).
  - `handle`: stored binary blob from `page.fetch({ store: true })`.
- VFS write cache (Rust + JS) for recent base64 writes.
- Binary blob store for run-scoped fetch handles.
- Fetch store to convert base64 responses to handle references.
- E2E coverage for all three `setFiles` source types and error cases; unit tests for blob store, VFS cache, fetch store, and `setFiles` resolver.

### Fixed

- **`snapshot_data` nested text** — `getOwnVisibleText` only read direct child `TEXT_NODE`s, returning `""` for buttons with nested markup like `<button><span>Sign in</span></button>`. Falls back to `el.textContent` when no direct text nodes are found.
- **Opaque `TypeError` duplication in error pipeline** — `resolve_message_fallback` now includes stack trace context instead of duplicating the error name, and guards against `name == message` to prevent `"TypeError: TypeError"`. `classify.rs` reuses `split_name_message`, keeps `Runtime.message` as the raw JS message (format applied at `Display` boundary only). 34 new tests covering unit and integration paths.

## [0.7.0] — 2026-06-09

### Fixed

- Remediated `problems.md` review gaps end-to-end: shared binary fetch encoding, refId allocator, snapshot mutation detection, observation semantics, and interactable parity.
- Added `problems.md` E2E fixtures and tests.
- Fixed `web-js` `WasmAsyncError` compile.

[0.11.0]: https://www.npmjs.com/package/@pi-oxide/extension-js/v/0.11.0
[0.10.3]: https://www.npmjs.com/package/@pi-oxide/extension-js/v/0.10.3
[0.8.1]: https://www.npmjs.com/package/@pi-oxide/extension-js/v/0.8.1
[0.8.0]: https://www.npmjs.com/package/@pi-oxide/extension-js/v/0.8.0
[0.7.0]: https://www.npmjs.com/package/@pi-oxide/extension-js/v/0.7.0
