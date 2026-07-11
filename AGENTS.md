# AGENTS.md

Rules for agents working in this repository.

## What This Repo Is

`web-js` is the JavaScript/WASM execution runtime for browser agents, with the
Chrome extension runtime as the product path.

Current shape:
- `crates/extension-js`: MV3 extension runtime, QuickJS runner, tool bridge,
  content-script channel, and extension-facing tests.
- `crates/web-js-core`: shared QuickJS runtime and prelude.
- `crates/web-js`: plain web target for demo/playground use only.
- `crates/web-fs`: OPFS-backed virtual filesystem.
- `crates/dom-semantic-tree`: DOM-to-semantic-tree extraction.
- `web`: sidepanel UI, extension packaging, and extension E2E tests.

Core invariant: generated JavaScript runs inside the extension runner and
browser/page side effects go through typed extension APIs. The model does not
receive raw Chrome or DOM access except through explicit user code paths.

Do not duplicate canonical types in this file. Source types are the truth in
the crates and TypeScript modules that own them.

## Priority Order

The top three principles are:

1. Readability.
2. Maintainability.
3. Correctness.

Never sacrifice these for speed. A small patch is good only when it preserves
the extension boundary and fixes the real cause.

## Work Order

TDD is the default for non-trivial work:

1. Types first: model the real boundary and state.
2. Test second: write one public-behavior test that fails.
3. Implementation last: make that test pass.

Use vertical slices: one test, one minimal implementation, repeat. Do not write
a batch of speculative tests before the first implementation proves the path.

## Top Priority: Extension-JS Context ONLY

**We do NOT care about web-js context. All development, testing, and validation MUST happen in the Chrome extension context (extension-js).**

### Context Detection
- Extension context is active when `chrome.runtime.id` is set
- Web-js context is for demo/playground ONLY
- All real API testing happens through the extension runner

### API Availability by Context

| API | Extension ✅ | Web ❌ |
|-----|-------------|--------|
| `chrome.*` (tabs, bookmarks, history, cookies, storage, alarms, notifications, windows, action, contextMenus, sidePanel, scripting, runtime) | YES | NO |
| `page.*` (url, title, snapshot, click, fill, scroll, etc.) | YES | NO |
| `sidepanel.*` | YES | NO |
| `dom.*` | YES | NO |
| `host.*` | YES | NO |
| `web.*` | YES | YES |
| `fs.*` | YES | YES |
| `crypto.*` | YES | YES |
| `console.*` | YES | YES |

### Testing Rules
1. **All E2E tests MUST mock `chrome.runtime.id`** to trigger extension context
2. **Never test web-js context in isolation** — it's not the product
3. **Extension build is the ONLY deliverable** (`web/dist/` loaded as unpacked extension)
4. **API fixes must work in extension-js first**, web-js compatibility is secondary

### Build Target
- `npm run build` produces extension assets in `web/dist/`
- Load `web/dist/` as unpacked extension in Chrome
- Test through the sidepanel UI

### Native-Parity API Transport
- `chrome.*` and parity aliases (`bookmarks_search`, `history_search`, etc.) transport opaque `NativeArgs` arrays end-to-end
- Chrome invocation goes through `invokeNative(method, args)` only — the bridge must not reshape arguments
- Project-owned APIs (`page.*`, `tab.*`, `dom.*`) keep their existing normalization

### Content-Script Channel (first-party DOM APIs)
- All first-party `page.*` / `web.tab.*` DOM read/write APIs MUST use the content-script registry channel (`registryCall` → `handlers.*`)
- First-party APIs MUST NOT call `chrome.scripting.executeScript` internally
- `chrome.scripting.executeScript` is only for explicit user/agent code in QuickJS cells (opt-in MAIN-world scripting)
- There is no `web.tab.execute_script` — use `chrome.scripting.executeScript` from a cell when MAIN-world access is required

### Snapshot Text Rule
- SNAPSHOT RULE: IF IT IS VISIBLE TEXT, EXPOSE IT. DO NOT FILTER OUT ANY TEXT NO MATTER WHAT ELEMENT IT IS.
- SNAPSHOT RULE: DO NOT FILTER TEXT BY ELEMENT TYPE, ROLE, DIRECTNESS, STRUCTURAL WRAPPER STATUS, INTERACTIVITY, FILTER LIMITS, OR SNAPSHOT NODE LIMITS.

### Extension-JS Type Boundary Rules
- No visible `unknown` in extension-js public API, runner, worker, content-script, or test-facing types.
- External data must be narrowed at the first boundary with zod or a named type guard, then passed deeper as named types.
- Do not use `z.unknown()` or `Record<string, unknown>` for project-owned APIs. Use exact zod schemas with useful validation messages.
- Native Chrome parity may carry opaque `NativeArgs` only at the Chrome boundary; project-owned APIs (`page.*`, `web.tab.*`, `dom.*`, `host.*`) must not.
- Error responses must name the public function, parameter path, expected shape, received value type, and script line when available.
- Bare `[runtime error] TypeError:` is a bug. Fix the shared boundary that lost the message, not the caller.

### General Type Safety Rules
- TypeScript: never use `any`. Every `unknown`, `Object`, or `Record<string, string>` must be justified by a short comment and narrowed immediately at the boundary.
- TypeScript external data must be parsed declaratively with zod. Do not hand-roll shape parsing when a zod schema can express it.
- Rust external data must be parsed declaratively with serde, serde-wasm-bindgen, wasm-bindgen, or an equivalent typed boundary. Do not manually walk raw values when a derive/schema boundary can express the shape.
- Rust core code should receive concrete domain types, not raw `serde_json::Value` or `JsValue`.
- Prefer exhaustive enums/discriminated unions for closed states.

### When Fixing Bugs
1. Check if bug reproduces in extension context
2. Fix extension-js runner (`crates/extension-js/js/src/main/runner/` — `runtime.ts` + `tools/`)
3. Fix prelude if needed (`crates/web-js-core/src/web/prelude.js`)
4. Rebuild WASM (`npm run wasm`)
5. Test in extension build
6. Web-js compatibility is a nice-to-have, not required

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (via `gh`). See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
