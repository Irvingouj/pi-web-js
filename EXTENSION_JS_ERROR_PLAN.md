# Extension-JS Precise Error Refactor Plan

This is an execution handoff. Do not treat it as permission to do partial implementation in this planning session.

## Goal

Make extension-js and Browsergent error reporting precise enough that an agent can identify:

- exact public function, e.g. `web.tab.dom`
- exact internal action, e.g. `tab_dom`
- exact parameter path, e.g. `tabId` or `target.tabId`
- expected type or shape
- received type and short safe preview
- script line when available
- machine-readable error code and category
- recovery hint only when the runtime actually knows the cause

The specific old conversation failures must stop producing opaque or guessed output:

- `await web.tab.url(tabId)` must not produce `[runtime error] TypeError:`
- `await web.tab.dom({ tabId, selector: "input[type='file']" })` must not produce `[runtime error] TypeError:`
- `chrome.scripting.executeScript({ target: { tabId }, func: () => ... })` must not reach Chrome and then report `Exactly one of 'func' and 'files' must be specified`
- Browsergent must not convert any empty `web.tab.*` TypeError into a generic “split click/snapshot” diagnosis

## Non-Negotiable Constraints

- Work in extension-js context only. Do not validate against web-js demo context.
- All E2E tests must force extension context with `chrome.runtime.id`.
- First-party DOM APIs must use the content-script registry path:
  - QuickJS cell
  - `makeAsync`
  - WASM async command
  - extension main thread relay
  - `registryCall`
  - content-script `handlers.*`
- Do not implement first-party `page.*` or `web.tab.*` DOM APIs with `chrome.scripting.executeScript`.
- Do not add dependencies. Use existing zod.
- Do not leave visible `unknown` in extension-js source or test-facing types.
- If an external boundary truly cannot be statically typed, narrow it immediately with zod or a named type guard and pass a named type deeper.
- Native Chrome parity may remain opaque only at the final Chrome invocation boundary, represented as a named `NativeArgs` type, never raw `unknown[]`.
- Do not hide broken schema coverage with casts.

## Current Evidence

Old exported conversation: `/Users/oujunyi/Downloads/browsergent-conversation-1783186461658.json`

Observed failures:

- `web.tab.url(tabId)` failed repeatedly as `[runtime error] TypeError:`
- `web.tab.dom({ tabId, selector })` failed repeatedly as `[runtime error] TypeError:`
- Browsergent added “split click/snapshot” hint because source contained `web.tab.*`
- `chrome.scripting.executeScript({ func })` failed as `Exactly one of 'func' and 'files' must be specified`
- `chrome.scripting.executeScript({ files: ["/skills/..."] })` failed as `Could not load file`

Browsergent source:

- `/Users/oujunyi/code/Browsergent/src/worker/agent-tools/run-js-tool.ts`
  - `classifyErrorBase` currently guesses cause for empty runtime TypeError.
  - The broad `callsWebTabStar(jsSource)` branch is the bad heuristic.
- `/Users/oujunyi/code/Browsergent/src/types/extjs-utils.ts`
  - `formatError` can only display what extension-js returns.

Extension-js source:

- `crates/web-js-core/src/web/prelude.js`
  - `makeAsync` normalizes args and captures source stack.
  - It currently cannot tell the user when a requested public function does not exist.
- `crates/extension-js/js/src/shared/cross/dispatch.ts`
  - Existing `formatValidationError` is the right central place for param messages.
- `crates/extension-js/js/src/shared/main/tool-registry.ts`
  - Existing `dispatchTool` and `dispatchValidated` are the right central path for main-thread API validation.
- `crates/extension-js/js/src/content-script/registry.ts`
  - Existing `dispatchContentScriptCall` is the right central path for content-script API validation.
- `crates/extension-js/js/src/shared/cross/tab-specs.ts`
  - Docs already recommend `web.tab.dom`, but no `tab_dom` spec exists.
- `crates/extension-js/js/src/shared/cross/page-specs.ts`
  - `page_dom` already exists and uses handler key `dom`.

## Desired Error Contract

Every project-owned API failure should serialize as an async error shaped like:

```ts
type ApiError = {
  message: string;
  code: string;
  category: string;
  action: string;
  publicName: string;
  line: number | null;
  paramPath?: string;
  expected?: string;
  receivedType?: string;
  receivedPreview?: string;
  hint?: string;
  recovery?: string[];
  details?: JsonObject;
};
```

Message examples:

```text
[web.tab.dom] (E_INVALID_PARAMS) line 3: invalid param 'tabId': expected number, received string ("941359232")
[web.tab.dom] (E_INVALID_PARAMS) line 3: missing required param 'selector': expected string
[chrome.scripting.executeScript] (E_UNTRANSPORTABLE_PARAM) line 5: param 'func' cannot be transported from run_js; use files with an extension-packaged path or web.tab.evaluate for isolated-world DOM inspection
[web.tab.url] (E_INVALID_PARAMS) line 2: expected web.tab.url(tabId: number), received object
```

Rules:

- Validation errors use `E_INVALID_PARAMS`, category `validation`.
- Non-transportable function args use `E_UNTRANSPORTABLE_PARAM`, category `transport`.
- Missing public API bindings use `E_UNKNOWN_API`, category `validation`, and name the missing public path.
- Content-script disconnected cases use existing content-script/resource codes, not `TypeError`.
- A bare `[runtime error] TypeError:` is never acceptable for project-owned APIs.

## Phase 1: Type Foundation In Extension-JS

Add named JSON and message types in one shared file, for example:

`crates/extension-js/js/src/shared/cross/json.ts`

Required types:

```ts
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonArray;
type JsonObject = { readonly [key: string]: JsonValue };
type JsonArray = readonly JsonValue[];
type NativeArg = JsonValue;
type NativeArgs = readonly NativeArg[];
type SafeErrorDetails = JsonObject;
```

Rules for executor agent:

- Replace `Record<string, unknown>` with `JsonObject` only where values truly cross process/runtime boundaries.
- Prefer domain-specific named object types over `JsonObject` in project-owned APIs.
- Replace `unknown[]` with `JsonArray`, `NativeArgs`, or a domain array.
- Replace generic `Promise<unknown>` with `Promise<JsonValue>` only at wire boundaries; otherwise use domain return types.
- Generated files may still contain unknown if produced by wasm-bindgen or ts-rs, but source code wrapping them must not expose it deeper.

Acceptance:

```bash
rg -n "\bunknown\b|z\.unknown\(|z\.record\(z\.unknown|Record<string, unknown>|as unknown" crates/extension-js/js/src crates/extension-js/js/test
```

Allowed remaining matches only:

- comments explaining removed prior state
- generated imports/types that cannot be edited
- string literals in tests that intentionally assert docs do not say `unknown`

## Phase 2: Boundary Narrowing

Create zod schemas or named guards for each external boundary:

- worker messages in `src/worker/worker.ts`
- main-thread worker responses in `src/main/session/extension-session.ts`
- content-script messages in `src/content-script/message-router.ts`
- content-script registry responses in `src/shared/main/content-script-response.ts`
- Chrome native parity inputs in `src/main/runner/chrome/native.ts`
- host calls in `src/main/runner/host.ts`
- file/set-files worker messages in `src/worker/resolve-set-files.ts`

Implementation rules:

- Parse once at function entry.
- Return typed validation errors for malformed user/API input.
- Throw early only for impossible internal states.
- Do not cast malformed external messages into `Command`.
- Do not pass raw event data deeper than the first function.

Required named schemas:

- `WorkerRequestSchema`
- `WorkerResponseSchema`
- `AsyncRelayCommandSchema`
- `RegistryCallMessageSchema`
- `RegistryCallResponseSchema`
- `NativeArgsSchema`
- `SafeErrorDetailsSchema`

Acceptance:

- TypeScript build passes without adding `any`.
- Boundary tests fail if malformed worker/content-script messages reach the executor.

## Phase 3: Central Validation Error Formatting

Improve `formatValidationError` in `crates/extension-js/js/src/shared/cross/dispatch.ts`.

Required output fields:

- public name from registered tool, e.g. `web.tab.dom`
- internal action, e.g. `tab_dom`
- first relevant zod issue path
- expected schema summary
- received type
- safe received preview, truncated to 120 chars
- all zod issue messages in `details.issues`

Required behavior:

- Root type mismatch:
  - `Invalid parameters for web.tab.dom: expected { tabId: number, selector: string, ... }, received string ("abc")`
- Nested type mismatch:
  - `Invalid parameters for chrome.scripting.executeScript at 'target.tabId': expected number, received string ("1")`
- Missing required:
  - `Invalid parameters for web.tab.dom at 'selector': required string`
- Custom rejection:
  - use custom message exactly, plus param path/details

Do not add per-tool error formatting. Keep this central.

Acceptance tests:

- Bad `web.tab.dom({ tabId: "x", selector: "input" })` names `web.tab.dom`, `tabId`, expected `number`, received `string`.
- Bad `web.tab.dom({ tabId: 1 })` names `selector`.
- Bad root call `web.tab.dom("input")` names expected object and received string.

## Phase 4: Public API Existence And Missing Function Errors

Fix missing API paths before Browsergent sees a raw JS engine TypeError.

Required behavior:

- If code calls `web.tab.nope(...)`, throw `E_UNKNOWN_API` with public path `web.tab.nope`.
- If code calls `web.tab.url(...)`, function exists.
- If code calls `web.tab.dom(...)`, function exists.
- If code accesses unknown namespace member without calling it, do not eagerly throw.

Implementation options:

- Preferred: install lightweight namespace `Proxy` objects in `prelude.js` after manifest setup.
- The proxy should only throw when a missing member is invoked as a function.
- Avoid large proxy framework. Keep helper local to prelude.

Acceptance tests in `crates/web-js-core/src/test_run_cell.rs`:

- registered APIs still work
- missing `web.tab.missing()` rejects with `E_UNKNOWN_API` and line
- missing `page.missing()` rejects with `E_UNKNOWN_API` and line
- no bare TypeError for missing registered namespace function

## Phase 5: Add `web.tab.url` And `web.tab.title`

Purpose:

- Agent naturally writes `web.tab.url(tabId)`.
- `page.url()` already exists.
- `web.tab.get(tabId)` already exposes url/title, but old trace shows the ergonomic alias is needed.

Implementation:

- Add schemas:
  - `TabUrlParamsSchema`: accepts `{ tabId: number }` and positional `tabId`.
  - `TabTitleParamsSchema`: same.
- Add specs in `src/main/runner/tools/tab.ts` or relevant tab spec path:
  - action `tab_url`, namespace `web.tab`, name `url`
  - action `tab_title`, namespace `web.tab`, name `title`
  - owner `main-thread`
  - fields `["tabId"]`
- Handler:
  - extract validated tabId
  - call `chrome_tabs_get` through existing `dispatchTool`
  - return `tab.url ?? ""` or `tab.title ?? ""`
- Do not use content-script for url/title.

Tests:

- unit: mocked `chrome.tabs.get` returns url/title.
- unit: invalid tabId shows `E_INVALID_PARAMS`.
- E2E extension: `await web.tab.url(tabId)` returns string and no TypeError.

## Phase 6: Wire `web.tab.dom`

Purpose:

- Browsergent docs already tell agents to use `web.tab.dom`.
- Existing `page.dom` content-script handler already does the real work.
- Implement tab-scoped variant without new DOM logic.

Implementation:

- Add `TabDomParamsSchema`:
  - exact shape: `{ tabId: number | bigint, selector: string, depth?: number, includeHidden?: boolean }`
  - `tabId` required
  - `selector` required
  - `depth` int 0..10 default 2
  - `includeHidden` default true
- Add `tab_dom` to `TAB_TOOL_SPECS`:
  - namespace `web.tab`
  - name `dom`
  - fields `["tabId", "selector"]`
  - returns `PageDomResultSchema`
  - handlerKey `dom`
  - owner stays content-script through existing `defineContentScriptTool`
- Do not add a new content-script handler.
- Existing `toHandlerAction("tab_dom")` maps to `dom`; verify it does.
- Existing tab routing should keep `tabId` for main-thread frame resolution, then content-script validation should tolerate or strip `tabId`.
- If content-script `PageDomParamsSchema` rejects extra `tabId`, adjust registry dispatch to validate tab action with `TabDomParamsSchema` before relay and pass only handler params `{ selector, depth, includeHidden }` into handler.

Important decision:

- Do not make `tabId` optional for `web.tab.dom`.
- Missing tabId should fail at schema layer, not later with `E_NO_TAB`.

Tests:

- unit: manifest includes `web.tab.dom`.
- unit: docs for `web.tab.snapshot` related APIs point to real `web.tab.dom`.
- unit/content-script relay: `web.tab.dom({ tabId, selector })` sends registry action `tab_dom` and handler key `dom`.
- E2E extension: create page with hidden file input, run `web.tab.dom({ tabId, selector: "input[type=file]", depth: 0 })`, assert nodes include `accept`/`filesCount`/attributes.
- invalid params:
  - `web.tab.dom({ tabId: "1", selector: "input" })`
  - `web.tab.dom({ tabId: 1 })`
  - `web.tab.dom("input")`

## Phase 7: Chrome Scripting ExecuteScript Transport Guard

Problem:

- QuickJS function values cannot cross JSON/native transport.
- Current path lets `{ func: () => ... }` degrade into a Chrome error saying neither `func` nor `files` exists.

Implementation:

- Define a schema for `chrome.scripting.executeScript` params that detects `func`.
- If `func` is present, return:
  - code `E_UNTRANSPORTABLE_PARAM`
  - category `transport`
  - publicName `chrome.scripting.executeScript`
  - paramPath `func`
  - hint: `Functions cannot be transported from run_js. Use files with extension-packaged paths for MAIN-world injection, or web.tab.evaluate for isolated-world DOM inspection.`
- For `files`, validate:
  - non-empty string array
  - no OPFS `/skills/...` path unless the extension can actually package/resolve it
  - message must explain Chrome requires extension-packaged file paths
- Preserve native parity for valid `files` calls.

Tests:

- `{ target: { tabId }, func: () => 1 }` fails before mocked Chrome is called.
- `{ target: { tabId }, files: ["/skills/foo.js"] }` fails with path explanation if unsupported.
- valid packaged `files` call still reaches mocked `chrome.scripting.executeScript`.

## Phase 8: Remove Visible `unknown`

Search target:

```bash
rg -n "\bunknown\b|z\.unknown\(|z\.record\(z\.unknown|Record<string, unknown>|as unknown" crates/extension-js/js/src crates/extension-js/js/test
```

Refactor groups:

1. Shared protocol/types
   - `manifest.ts`
   - `tool-registry.ts`
   - `dispatch.ts`
   - `normalize-agent-error.ts`
   - `content-script-response.ts`

2. Worker/session messages
   - `worker.ts`
   - `extension-session.ts`
   - worker tests
   - index/session tests

3. Content script
   - `registry.ts`
   - `message-router.ts`
   - `handlers.ts`
   - `dom-utils.ts`
   - `file-resolution.ts`

4. Chrome schemas and native parity
   - `schemas/chrome.ts`
   - `chrome/native.ts`
   - `tools/chrome/*`

5. Tests
   - replace loose `unknown[]` result expectations with named local result types.
   - replace `as unknown as T` double-casts with small typed test factories.

Rules:

- Do not replace `unknown` with `any`.
- Do not replace `unknown` with huge `JsonValue` everywhere when a smaller domain type exists.
- If a result can be arbitrary JSON by design, name it `JsonValue` or `JsonObject`.
- If Chrome type definitions force a cast, isolate it in one helper and document why.

Acceptance:

- zero visible `unknown` matches in editable extension-js source/tests, except generated files and literal output strings if unavoidable.
- `npm run build` in `crates/extension-js/js` passes.

## Phase 9: Browsergent Stop Over-Guessing

Repo: `/Users/oujunyi/code/Browsergent`

Read and follow `/Users/oujunyi/code/Browsergent/AGENTS.md`.

Implementation:

- In `src/worker/agent-tools/run-js-tool.ts`, change `classifyErrorBase`.
- Keep structured error pass-through first:
  - if extension-js supplies `source.hint`, use it.
  - if `source.code` is known, map by code.
  - if details contain param/action/publicName, do not add speculative hint.
- Delete or narrow this branch:
  - empty runtime TypeError + `callsWebTabStar(jsSource)` => split/snapshot hint.
- Replacement fallback:
  - `E_JS_RUNTIME` + empty message + `web.tab.*` source:
    - code stays `E_JS_RUNTIME`
    - hint: `The JS runtime returned an opaque TypeError without structured extension-js details. Call get_doc for the exact API name and argument shape, then retry with the documented signature.`
- Keep these source heuristics:
  - `setTimeout` / `setInterval` => use `web.sleep`
  - `.find(...).refId` => find returned undefined
- Only suggest split click/snapshot when:
  - `source.code` is `E_CONTENT_SCRIPT`, `E_STALE`, or `E_OBSERVATION_REQUIRED`, or
  - `source.details.reason` explicitly says reconnect/navigation/stale frame.

Tests:

- Structured `E_INVALID_PARAMS` from extension-js returns unchanged message/hint/details.
- Empty TypeError with `await web.tab.url(tabId)` does not include `split`, `snapshot`, or `reconnect`.
- Empty TypeError with `await web.tab.dom({ tabId, selector })` does not include `split`, `snapshot`, or `reconnect`.
- Empty TypeError with `await page.snapshot()` may still suggest tab-targeting only if current policy keeps that branch.
- `setTimeout` test still passes.
- `.find(...).refId` test still passes.

## Phase 10: Regression Tests From Old Trace

Add a small trace-derived test suite.

Extension-js:

- `await web.tab.url(tabId);`
- `await web.tab.snapshot(tabId);`
- `await web.tab.dom({ tabId, selector: "input[type='file']" });`
- `await chrome.scripting.executeScript({ target: { tabId }, func: () => 1 });`
- invalid variants for each.

Browsergent:

- Use mocked `runJs` returning old-style empty TypeError and source code from the exported trace.
- Assert Browsergent does not fabricate cause.

Acceptance:

- No test output contains bare `[runtime error] TypeError: ` for project-owned APIs.
- No Browsergent hint tells the agent to split click/snapshot for `web.tab.url` or `web.tab.dom`.

## Verification Commands

In `/Users/oujunyi/code/web-js`:

```bash
npm run wasm
cd crates/extension-js/js
npm test
npm run build
cd /Users/oujunyi/code/web-js
npm run test:e2e:extension -- harness.spec.ts
```

In `/Users/oujunyi/code/Browsergent`:

```bash
npm run typecheck
npm run test:unit
```

Optional after both repos pass:

```bash
npm run build
```

## Done Criteria

- `EXTENSION_JS_ERROR_PLAN.md` is complete and current.
- `AGENTS.md` contains the extension-js type-boundary rule.
- `web.tab.dom`, `web.tab.url`, and `web.tab.title` are real documented APIs.
- `chrome.scripting.executeScript({ func })` has a first-party transport error.
- `rg` shows no visible `unknown` in editable extension-js source/tests except explicitly allowed generated/literal cases.
- Old conversation snippets no longer produce opaque TypeError.
- Browsergent no longer over-guesses empty `web.tab.*` TypeErrors.
- All verification commands above pass.
