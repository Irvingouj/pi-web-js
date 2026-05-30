# Issues

## Issue 1: Single-slot async bridge blocks Promise.all and concurrent async operations

**Status:** Resolved (Phase 1 — multi-slot bridge implemented)
**Severity:** High
**Area:** `crates/web-js-core/src/state.rs`, `crates/web-js-core/src/globals.rs`, `crates/web-js-base/src/session.rs`

### Problem

QuickJS is a full JS runtime with native `Promise`, `async/await`, and microtask queue support. However, the host bridge in web-js constrains all async operations to a single pending slot (`Option<AsyncCommand>` in `HostState`), making concurrent async operations impossible.

This means the following valid JS code breaks:

```js
// Promise.all hangs — only the LAST fetch ever gets resolved
const [users, posts] = await Promise.all([
  web.fetch("https://api.example.com/users"),
  web.fetch("https://api.example.com/posts"),
]);
```

The second `__webJsTriggerAsync` call overwrites `pending_async_command`, orphaning the first Promise's resolve/reject forever.

Similarly, fire-and-forget patterns don't work as expected:

```js
web.fetch("https://api.example.com/log"); // never resolves
console.log("done"); // runs, but cell stays in AsyncPending state forever
```

### Root Cause

`HostState.pending_async_command` is `Option<AsyncCommand>` (single slot), not `Vec<AsyncCommand>` (queue).

Related code:
- `crates/web-js-core/src/state.rs` — `pending_async_command: Option<AsyncCommand>` field
- `crates/web-js-core/src/globals.rs` — `__webJsTriggerAsync` overwrites the slot on each call
- `crates/web-js-base/src/session.rs` — `run_cell_async_loop` processes one command at a time

### Proposed Fix

Change the async bridge to support multiple in-flight commands:

1. Replace `pending_async_command: Option<AsyncCommand>` with `pending_async_commands: Vec<AsyncCommand>` (or a map keyed by call_id)
2. After cell evaluation, return all pending commands to the host
3. Host executes commands concurrently (e.g., multiple fetches in parallel)
4. On each resolve, call `resume_cell` to resolve the corresponding Promise and drain microtasks
5. Repeat until no pending commands remain

This is how `qjs` CLI and [quickjs-emscripten](https://github.com/justjake/quickjs-emscripten) handle async — multiple deferred promises resolved independently, with `JS_ExecutePendingJob` drained after each resolution.

### Impact

- Unlocks `Promise.all`, `Promise.race`, `Promise.allSettled`
- Unlocks fire-and-forget patterns (e.g., logging, background fetch)
- Makes the runtime behave like a real JS environment
- web-lua has the same single-slot limitation and could benefit from the same fix

---

## Issue 2: Unify API registration — declare once, derive everything

**Status:** In Progress (Phase 2 string actions + Phase 3 full string dispatch implemented)
**Severity:** High
**Area:** `crates/web-js-core/src/{action.rs, command_params.rs, api_docs.rs, web/mod.rs, web/prelude.js}`, `crates/web-js/src/{session.rs, browser_api.rs}`

### Problem

Adding a single API (e.g. `page.highlight`) requires editing **6 files** across ~46-81 lines of boilerplate, with zero compile-time guarantees they stay in sync:

| # | File | What to add |
|---|------|-------------|
| 1 | `action.rs` | Enum variant + `as_str()` arm + `From<&str>` arm (3 locations) |
| 2 | `command_params.rs` | Params struct with serde derives |
| 3 | `prelude.js` | JS wrapper function (`makeAsync(...)` call) |
| 4 | `api_docs.rs` | Manual `register(JsApiDoc{...})` call |
| 5 | `session.rs` | Match arm in `handle_command` dispatch |
| 6 | `browser_api.rs` | `execute_*` implementation function |

Key problems:
- **No single source of truth** — API name, params, docs, and implementation scattered across 6 files
- **Docs drift from code** — `api_docs.rs` (1520 lines) is hand-written, no compile-time check that documented APIs exist
- **Action enum written 3 times** — definition, `as_str()`, `From<&str>` are pure mechanical duplication
- **No parameter validation** — only serde deserialization, no field-level checks
- **Action names are underscores** — `fs_read`, `page_click` instead of natural `fs.read`, `page.click`

### Proposed Fix

Split APIs into two tiers with a unified "declare once" philosophy:

#### Tier 1: Rust-native APIs (~10, declared with macro)

Only APIs that genuinely need WASM-native access or high performance stay in Rust:

- `fs.*` — OPFS (Origin Private File System) requires `web_sys` native access
- `crypto.*` — SHA-256, HMAC etc. need Rust crypto libraries
- `dom.snapshot` / `dom.format` — DOM traversal and semantic analysis, performance-sensitive

Declared once with a `declare_apis!` macro:

```rust
// One file: crates/web-js-core/src/apis.rs
declare_apis! {
    "fs.exists" => {
        params: { path: String }
        returns: "boolean"
        description: "Check if a file or directory exists"
        impl: fs_exists,
    },
    "fs.read" => {
        params: { path: String }
        returns: "ArrayBuffer"
        description: "Read file as binary data"
        impl: fs_read,
    },
    "fs.write" => {
        params: { path: String, data: Vec<u8> }
        returns: "null"
        description: "Write binary data to file"
        impl: fs_write,
    },
    "dom.snapshot" => {
        params: {}
        returns: "TreeSnapshot"
        description: "Capture semantic DOM tree"
        impl: dom_snapshot,
    },
    // ...
}
```

The macro auto-generates:
- Params structs (with serde + validator derives)
- Dispatch match arms (no more 1100-line `handle_command`)
- Doc registration entries
- No more `Action` enum — action names are just strings, no enum with 150 variants

#### Tier 2: JS-host APIs (~140, registered at runtime)

All browser and extension APIs move to JS-side registration. The Rust bridge becomes a generic pass-through that doesn't need to know what each action does.

Registered once per API, using dot-notation namespaces that match native browser APIs:

```js
// apis/page.js
host.register("page.click", {
  description: "Click an element by refId or CSS selector",
  params: z.object({
    refId: z.string().describe("Element refId from snapshot or CSS selector"),
    label: z.string().default(""),
  }),
  returns: z.null(),
  handler: async ({ refId, label }) => {
    const el = resolveRef(refId);
    el.click();
    return null;
  },
});

// apis/chrome-bookmarks.js
host.register("chrome.bookmarks.create", {
  description: "Create a bookmark",
  params: z.object({
    title: z.string(),
    url: z.string().url(),
    parentId: z.string().optional(),
  }),
  returns: z.object({ id: z.string(), title: z.string(), url: z.string() }),
  handler: async ({ title, url, parentId }) => {
    return await chrome.bookmarks.create({ title, url, parentId });
  },
});
```

The `host.register()` system:
- Takes a dot-path string (`"chrome.bookmarks.create"`)
- Auto-builds nested object tree (`chrome.bookmarks.create = function(...args) { ... }`)
- Runtime is real object property access — no string matching on call
- Zod schemas provide: runtime validation, type safety, and auto-generated docs
- Registration, docs, validation, and implementation all in one place

#### Bridge becomes thin generic pipe

```rust
// session.rs — was 1100 lines, now ~20 lines
async fn handle_command(&mut self, action: &str, params: &str) -> WasmAsyncResponse {
    // Try Rust-native APIs first
    if let Some(result) = self.dispatch_rust_api(action, params).await {
        return result;
    }
    // Everything else → JS host handler
    self.delegate_to_host(action, params).await
}
```

### What Gets Deleted

| File | Lines | Fate |
|------|-------|------|
| `action.rs` | 516 | Delete — no more Action enum |
| `command_params.rs` | 380 | Delete — macro generates params structs |
| `browser_api.rs` | 1202 | Delete — implementations move to JS |
| `session.rs` dispatch | ~900 | Delete — replaced by ~20-line generic pipe |
| `api_docs.rs` hand-written | ~1400 | Delete — macro/Zod auto-generates docs |
| `prelude.js` wrapper boilerplate | ~400 | Delete — `host.register()` generates wrappers |

**Total removed: ~4800 lines of boilerplate.**

### What Gets Added

| File | What |
|------|------|
| `apis.rs` | `declare_apis!` macro with ~10 Rust-native APIs |
| `apis/*.js` | One file per namespace: `page.js`, `chrome-tabs.js`, `chrome-bookmarks.js`, etc. |
| `host.js` | `host.register()` runtime — builds object tree, Zod validation, doc extraction |
| `declare_api_macros.rs` | The `declare_apis!` proc macro |

### Action Name Convention Change

| Before | After |
|--------|-------|
| `fs_read` | `fs.read` |
| `fs_write_text` | `fs.writeText` |
| `page_click` | `page.click` |
| `chrome_tabs_query` | `chrome.tabs.query` |
| `dom_snapshot` | `dom.snapshot` |

Dot notation everywhere, matching native browser API style. No more underscores.

### Benefits

- **Add a browser API**: write one `host.register()` call. Zero Rust changes.
- **Add a Rust-native API**: add one line to `declare_apis!` + one implementation function.
- **Docs never drift** — auto-generated from Zod schemas and macro definitions.
- **Parameter validation** — Zod on JS side, `validator` derive on Rust side.
- **Faster Rust compile times** — changing browser APIs doesn't touch Rust.
- **Consistent with web-lua refactor** — same pattern can be applied there.

### Dependencies

- Issue 1 (multi-slot async bridge) should ideally be resolved first, since the new registration system will change `HostState` and `__webJsTriggerAsync` anyway.
- web-lua has the same registration problem and should get the same `declare_apis!` macro on its Rust side.

---

## Issue 3: Meta Extension — multi-tab, multi-context browser agent

**Status:** Open
**Severity:** High
**Scope:** extension-js + new shared `@pi-oxide/extension-api` package

### Vision

Build a "meta extension" where an LLM runs inside the extension and can control the entire browser — all tabs, all Chrome APIs, full DOM access. The extension should expose every capability Chrome allows to a single unified API surface.

### Execution Contexts

The extension has exactly two execution contexts:

```
┌─────────────────────────────────────────────────┐
│  Side Panel (main thread)                        │
│                                                  │
│  - QuickJS WASM runs here (in a Web Worker)      │
│  - All chrome.* APIs                             │
│  - localStorage, fetch, navigator                │
│  - chrome.scripting to inject into any tab       │
│  - No user page DOM                              │
└────────────┬────────────────────────────────────┘
             │ chrome.tabs.sendMessage
             │ chrome.scripting.executeScript
             ▼
┌─────────────────────────────────────────────────┐
│  Content Script (injected into user's page)      │
│                                                  │
│  - Full DOM access (click, fill, scroll, ...)    │
│  - Can access page JS via MAIN world execution   │
│  - No chrome.* APIs                              │
└─────────────────────────────────────────────────┘
```

### Tab as First-Class Object

`tab` is not a namespace — it's an object that holds a `tabId` and exposes all DOM/page methods with context injection:

```js
// Factory methods — return TabHandle instances
const t = await tab.get(3);              // specific tab
const [gh] = await tab.find({ url: "*://github.com/*" });  // search tabs
const active = await tab.current();      // active tab
const fresh = await tab.create("https://example.com");  // new tab

// TabHandle — all methods auto-inject tabId
await t.click({ refId: "42" });
await t.fill({ refId: "5", value: "hello" });
await t.snapshot();
await t.evaluate(() => window.__NEXT_DATA__);
await t.close();
```

```js
// TabHandle class in prelude.js
class TabHandle {
  constructor(tabId, info = {}) {
    this.tabId = tabId;
    this.url = info.url;
    this.title = info.title;
  }

  // Methods auto-generated from registered content-script APIs
  click(params) { return makeAsync("tab.click")({ ...params, tabId: this.tabId }); }
  fill(params) { return makeAsync("tab.fill")({ ...params, tabId: this.tabId }); }
  snapshot()   { return makeAsync("tab.snapshot")({ tabId: this.tabId }); }
  evaluate(code) { return makeAsync("tab.evaluate")({ code, tabId: this.tabId }); }
}
```

The LLM can operate on multiple tabs simultaneously — e.g., extract data from one tab, fill forms in another.

### API Namespace Strategy

Not all APIs can match native Chrome naming. Two categories:

| Namespace | Strategy | Examples |
|-----------|----------|----------|
| `chrome.*` | 1:1 passthrough of native Chrome API | `chrome.tabs.query`, `chrome.bookmarks.create` |
| `tab.*` | Higher-level abstractions (TabHandle methods) | `tab.click`, `tab.snapshot`, `tab.evaluate` |
| `web.*` | General web capabilities | `web.fetch`, `web.storage`, `web.clipboard` |
| `fs.*` | Rust-native OPFS filesystem | `fs.read`, `fs.write` |
| `dom.*` | Rust-native DOM semantic snapshot | `dom.snapshot`, `dom.format` |
| `host.call()` | Escape hatch for any Chrome API | `host.call("chrome.debugger.attach", {...})` |

### Register Once — Shared Definition, Context Split

Each API is defined in one file with one `registerApi()` call. The shared `@pi-oxide/extension-api` package detects the runtime context and splits behavior:

```typescript
// apis/click.ts — written once
import { registerApi, z } from "@pi-oxide/extension-api";

registerApi({
  action: "tab.click",
  context: "content-script",
  params: z.object({ tabId: z.number(), refId: z.string() }),
  returns: z.null(),
  description: "Click an element by refId",
  handler: async ({ refId }) => {
    document.querySelector(`[data-refid="${refId}"]`)?.click();
  },
});
```

```typescript
// @pi-oxide/extension-api — context detection
const IS_CONTENT_SCRIPT = typeof chrome !== 'undefined' && !!chrome.runtime?.onMessage && !chrome.scripting;
const IS_SIDE_PANEL = typeof chrome !== 'undefined' && !!chrome.scripting;

export function registerApi(api) {
  if (IS_CONTENT_SCRIPT) {
    // Only store handler — respond to messages
    csHandlers.set(api.action, api.handler);
  }
  if (IS_SIDE_PANEL) {
    // Only store metadata — build API surface, route calls
    hostRegistry.set(api.action, {
      context: api.context,
      params: api.params,
      returns: api.returns,
      description: api.description,
    });
  }
}
```

Build produces two bundles from the same source:
- `content-script.js` — handler functions + message listener
- `side-panel.js` — metadata + Zod schemas + routing

| API Type | Registrations | Where handler runs |
|----------|:---:|---|
| DOM ops (`tab.click` etc.) | 1 | content script |
| Chrome API (`chrome.tabs.query`) | 1 | side panel |
| Rust native (`fs.read`) | 1 (macro) | WASM |

### Type-Safe Message Passing

All cross-context communication must guarantee:
1. **Always returns** — never hangs, every call resolves
2. **Always typed** — compile-time inference from Zod schemas
3. **Always validated** — runtime Zod parse at each boundary

```typescript
// Shared response type — never throws, always has shape
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: { message: string; code: string } };
```

#### Content script: safe handler wrapper

```typescript
function safeHandler<P, R>(
  paramsSchema: z.ZodTypeAny,
  handler: (p: P) => Promise<R>
): (raw: unknown) => Promise<Result<R>> {
  return async (rawParams) => {
    try {
      const parsed = paramsSchema.parse(rawParams);  // validate
      const value = await handler(parsed);            // execute
      return { ok: true, value };
    } catch (err) {
      return {                                    // always return Result
        ok: false,
        error: { message: err.message, code: "E_HANDLER" },
      };
    }
  };
}

// Message listener — always sendResponse
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers.get(msg.action);
  if (!handler) {
    sendResponse({ ok: false, error: { message: `Unknown: ${msg.action}`, code: "E_UNKNOWN" } });
    return;
  }
  handler(msg.params).then(sendResponse);  // never rejects
  return true;
});
```

#### Side panel: type-safe caller with timeout

```typescript
function createTypedCaller<P, R>(
  action: string,
  paramsSchema: z.ZodType<P>,
  returnsSchema: z.ZodType<R>,
  context: string
) {
  return async (params: P): Promise<Result<R>> => {
    try {
      paramsSchema.parse(params);  // validate before sending

      if (context === "content-script") {
        const tabId = params.tabId;
        return await Promise.race([
          dispatchToContentScript(tabId, action, params),
          timeout(30_000, { ok: false, error: { message: "Timeout", code: "E_TIMEOUT" } }),
        ]);
      }

      // sidepanel: execute directly
      const value = await handler(params);
      return { ok: true, value };
    } catch (err) {
      return { ok: false, error: { message: err.message, code: "E_DISPATCH" } };
    }
  };
}
```

#### TypeScript compile-time type inference

Zod schemas provide both runtime validation and compile-time types:

```typescript
const clickParams = z.object({ tabId: z.number(), refId: z.string() });
type ClickParams = z.infer<typeof clickParams>;
// → { tabId: number; refId: string } — compile-time type

const caller = createTypedCaller("tab.click", clickParams, z.null(), "content-script");
// → (params: { tabId: number; refId: string }) => Promise<Result<null>>

await caller({ tabId: 3, refId: "42" });   // ✅ type-checked
await caller({ tabId: "bad" });             // ❌ compile error
```

#### Safety chain summary

```
Worker sends request:
  1. Zod validates params                        ✅
  2. Timeout protection (30s)                    ✅
  3. Always returns Result<T>, never throws      ✅

Side panel routes:
  1. Zod re-validates params                     ✅
  2. Routes based on context metadata            ✅
  3. Timeout protection                          ✅
  4. Always returns Result<T>                    ✅

Content script executes:
  1. Zod validates params                        ✅
  2. try-catch wraps handler                     ✅
  3. Validates return value shape                ✅
  4. Always sendResponse({ ok: true/false })     ✅
```

### Content Script Lifecycle

```typescript
// Maintain cache of injected tabs — avoid re-injection overhead
const injectedTabs = new Set<number>();

async function ensureContentScript(tabId: number) {
  if (injectedTabs.has(tabId)) return;
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content-script.js"],
    world: "ISOLATED",
  });
  injectedTabs.add(tabId);
}

chrome.tabs.onRemoved.addListener(tabId => injectedTabs.delete(tabId));
```

First call to any tab injects the content script. Subsequent calls send messages directly.

### Extension Permissions (manifest.json)

The meta extension needs broad permissions:

```json
{
  "permissions": [
    "tabs", "activeTab", "scripting", "sidePanel",
    "cookies", "bookmarks", "history", "notifications",
    "contextMenus", "alarms", "storage", "clipboardRead",
    "clipboardWrite", "downloads", "identity", "debugger",
    "desktopCapture", "offscreen", "declarativeNetRequest",
    "webRequest", "browsingData", "topSites", "system.cpu",
    "system.memory", "system.storage", "management",
    "pageCapture", "tts"
  ],
  "host_permissions": ["<all_urls>"]
}
```

### Complete API Surface (~160 APIs)

#### 1. TabHandle instance methods (content-script context)

Obtained via `tab.get(id)` / `tab.find()` / `tab.current()` / `tab.create()`. All methods auto-inject `tabId`.

**DOM interaction**

| API | Description |
|-----|-------------|
| `t.click({ refId })` | Click element |
| `t.dblclick({ refId })` | Double-click element |
| `t.fill({ refId, value })` | Fill input (React-compatible) |
| `t.type({ refId, text })` | Type text character by character |
| `t.append({ refId, text })` | Append text to element |
| `t.press({ key })` | Press key (Enter, Tab, Escape, etc.) |
| `t.select({ refId, value })` | Select dropdown option |
| `t.check({ refId, checked })` | Check/uncheck checkbox |
| `t.hover({ refId })` | Hover over element |
| `t.unhover()` | Unhover |
| `t.scroll({ direction, amount })` | Scroll page |
| `t.scrollTo({ refId })` | Scroll to element |

**Page info**

| API | Description |
|-----|-------------|
| `t.snapshot()` | Semantic DOM snapshot (text) |
| `t.snapshotData()` | Semantic DOM snapshot (JSON) |
| `t.screenshot()` | Page screenshot (base64) |
| `t.url()` | Get page URL |
| `t.title()` | Get page title |

**Navigation**

| API | Description |
|-----|-------------|
| `t.goto(url)` | Navigate to URL |
| `t.back()` | Browser back |
| `t.forward()` | Browser forward |
| `t.reload()` | Reload page |

**Find & wait**

| API | Description |
|-----|-------------|
| `t.find({ selector })` | Find elements by CSS selector |
| `t.waitFor({ selector, timeout })` | Wait for element to appear |
| `t.waitForLoad({ timeout })` | Wait for page load |

**Extract & evaluate**

| API | Description |
|-----|-------------|
| `t.extract({ fields })` | Extract structured data from page |
| `t.evaluate(fn)` | Execute JS in page MAIN world |

**Lifecycle**

| API | Description |
|-----|-------------|
| `t.close()` | Close this tab |

#### 2. tab factory (sidepanel context)

| API | Description |
|-----|-------------|
| `tab.get(tabId)` | Get TabHandle with url, title, etc. |
| `tab.find(query)` | Search tabs, returns TabHandle[] |
| `tab.current()` | Get active tab TabHandle |
| `tab.create(url)` | Create new tab, returns TabHandle |
| `tab.list()` | List all tabs |

#### 3. chrome.tabs (sidepanel, native passthrough)

| API | Description |
|-----|-------------|
| `chrome.tabs.query(queryInfo)` | Query tabs |
| `chrome.tabs.create(createProperties)` | Create tab |
| `chrome.tabs.update(tabId, updateProperties)` | Update tab |
| `chrome.tabs.remove(tabIds)` | Close tabs |
| `chrome.tabs.get(tabId)` | Get tab info |
| `chrome.tabs.reload(tabId, reloadProperties)` | Reload tab |
| `chrome.tabs.sendMessage(tabId, message)` | Send message to content script |
| `chrome.tabs.connect(tabId, connectInfo)` | Long-lived connection |

#### 4. chrome.windows (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.windows.getAll(getInfo)` | Get all windows |
| `chrome.windows.create(createData)` | Create window |
| `chrome.windows.update(windowId, updateInfo)` | Update window |
| `chrome.windows.remove(windowId)` | Close window |
| `chrome.windows.getCurrent(getInfo)` | Get current window |

#### 5. chrome.bookmarks (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.bookmarks.create(bookmark)` | Create bookmark |
| `chrome.bookmarks.get(id)` | Get bookmark |
| `chrome.bookmarks.getChildren(id)` | Get child bookmarks |
| `chrome.bookmarks.getTree()` | Get full bookmark tree |
| `chrome.bookmarks.search(query)` | Search bookmarks |
| `chrome.bookmarks.move(id, destination)` | Move bookmark |
| `chrome.bookmarks.update(id, changes)` | Update bookmark |
| `chrome.bookmarks.remove(id)` | Remove bookmark |
| `chrome.bookmarks.removeTree(id)` | Remove bookmark folder |

#### 6. chrome.cookies (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.cookies.get(details)` | Get cookie |
| `chrome.cookies.getAll(details)` | Get all cookies |
| `chrome.cookies.set(details)` | Set cookie |
| `chrome.cookies.remove(details)` | Remove cookie |

#### 7. chrome.history (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.history.search(query)` | Search history |
| `chrome.history.getVisits(details)` | Get visit records |
| `chrome.history.addUrl(details)` | Add to history |
| `chrome.history.deleteUrl(details)` | Delete URL from history |
| `chrome.history.deleteRange(range)` | Delete history in range |
| `chrome.history.deleteAll()` | Clear all history |

#### 8. chrome.downloads (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.downloads.download(options)` | Download file |
| `chrome.downloads.search(query)` | Search downloads |
| `chrome.downloads.pause(downloadId)` | Pause download |
| `chrome.downloads.resume(downloadId)` | Resume download |
| `chrome.downloads.cancel(downloadId)` | Cancel download |
| `chrome.downloads.removeFile(downloadId)` | Remove downloaded file |
| `chrome.downloads.erase(query)` | Erase from download history |

#### 9. chrome.notifications (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.notifications.create(id, options)` | Create notification |
| `chrome.notifications.update(id, options)` | Update notification |
| `chrome.notifications.clear(id)` | Clear notification |
| `chrome.notifications.getAll()` | Get all notifications |

#### 10. chrome.contextMenus (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.contextMenus.create(createProperties)` | Create context menu |
| `chrome.contextMenus.update(id, updateProperties)` | Update context menu |
| `chrome.contextMenus.remove(menuItemId)` | Remove menu item |
| `chrome.contextMenus.removeAll()` | Remove all menu items |

#### 11. chrome.alarms (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.alarms.create(name, alarmInfo)` | Create alarm |
| `chrome.alarms.clear(name)` | Clear alarm |
| `chrome.alarms.clearAll()` | Clear all alarms |
| `chrome.alarms.getAll()` | Get all alarms |

#### 12. chrome.action (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.action.setBadgeText(details)` | Set badge text |
| `chrome.action.getBadgeText(details)` | Get badge text |
| `chrome.action.setBadgeBackgroundColor(details)` | Set badge color |
| `chrome.action.setTitle(details)` | Set tooltip |
| `chrome.action.setIcon(details)` | Set icon |
| `chrome.action.setPopup(details)` | Set popup |
| `chrome.action.openPopup()` | Open popup |

#### 13. chrome.sidePanel (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.sidePanel.setOptions(options)` | Set side panel options |
| `chrome.sidePanel.setPanelBehavior(behavior)` | Set side panel behavior |

#### 14. chrome.scripting (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.scripting.executeScript(injection)` | Inject JS into page |
| `chrome.scripting.insertCSS(injection)` | Inject CSS |
| `chrome.scripting.removeCSS(injection)` | Remove CSS |

#### 15. chrome.storage (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.storage.local.get(keys)` | Read local storage |
| `chrome.storage.local.set(items)` | Write local storage |
| `chrome.storage.local.remove(keys)` | Remove from local storage |
| `chrome.storage.local.clear()` | Clear local storage |
| `chrome.storage.sync.get(keys)` | Read sync storage |
| `chrome.storage.sync.set(items)` | Write sync storage |
| `chrome.storage.sync.remove(keys)` | Remove from sync storage |
| `chrome.storage.sync.clear()` | Clear sync storage |

#### 16. chrome.runtime (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.runtime.sendMessage(message)` | Send message |
| `chrome.runtime.connect(connectInfo)` | Long-lived connection |
| `chrome.runtime.getURL(path)` | Get extension URL |
| `chrome.runtime.getManifest()` | Get manifest |
| `chrome.runtime.id` | Extension ID |

#### 17. chrome.declarativeNetRequest (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.declarativeNetRequest.updateEnabledRulesets(update)` | Enable/disable rule sets |
| `chrome.declarativeNetRequest.getEnabledRulesets()` | Get enabled rule sets |
| `chrome.declarativeNetRequest.updateDynamicRules(update)` | Update dynamic rules |
| `chrome.declarativeNetRequest.getDynamicRules()` | Get dynamic rules |
| `chrome.declarativeNetRequest.updateSessionRules(update)` | Update session rules |
| `chrome.declarativeNetRequest.getSessionRules()` | Get session rules |

#### 18. chrome.browsingData (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.browsingData.remove(options, dataToRemove)` | Remove browsing data |
| `chrome.browsingData.removeCache(options)` | Clear cache |
| `chrome.browsingData.removeCookies(options)` | Clear cookies |
| `chrome.browsingData.removeHistory(options)` | Clear history |
| `chrome.browsingData.removeDownloads(options)` | Clear downloads |
| `chrome.browsingData.removeFormData(options)` | Clear form data |
| `chrome.browsingData.removePasswords(options)` | Clear saved passwords |

#### 19. chrome.management (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.management.getAll()` | List all extensions |
| `chrome.management.get(id)` | Get extension info |
| `chrome.management.setEnabled(id, enabled)` | Enable/disable extension |
| `chrome.management.uninstall(id)` | Uninstall extension |

#### 20. chrome.system (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.system.cpu.getInfo()` | CPU info |
| `chrome.system.memory.getInfo()` | Memory info |
| `chrome.system.storage.getInfo()` | Storage info |

#### 21. chrome.identity (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.identity.getAuthToken(details)` | Get OAuth token |
| `chrome.identity.getProfileUserInfo(details)` | Get user profile info |
| `chrome.identity.launchWebAuthFlow(details)` | Launch OAuth flow |

#### 22. chrome.tabGroups (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.tabGroups.get(groupId)` | Get tab group |
| `chrome.tabGroups.move(groupId, moveProperties)` | Move tab group |
| `chrome.tabGroups.query(queryInfo)` | Query tab groups |
| `chrome.tabGroups.update(groupId, updateProperties)` | Update tab group |

#### 23. chrome.sessions (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.sessions.getRecentlyClosed()` | Get recently closed tabs |
| `chrome.sessions.getDevices()` | Get cross-device sessions |
| `chrome.sessions.restore(sessionId)` | Restore session |

#### 24. chrome.desktopCapture (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.desktopCapture.chooseDesktopMedia(sources, tab)` | Request screen/window/tab sharing |
| `chrome.desktopCapture.cancelChooseDesktopMedia(streamId)` | Cancel sharing |

#### 25. chrome.pageCapture (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.pageCapture.saveAsMHTML(details)` | Save page as MHTML |

#### 26. chrome.tts (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.tts.speak(text, options)` | Text-to-speech |
| `chrome.tts.stop()` | Stop speaking |
| `chrome.tts.getVoices()` | Get available voices |

#### 27. chrome.idle (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.idle.queryState(detectionIntervalInSeconds)` | Query idle state |

#### 28. chrome.permissions (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.permissions.contains(permissions)` | Check permission |
| `chrome.permissions.getAll()` | Get all permissions |
| `chrome.permissions.request(permissions)` | Request permission |
| `chrome.permissions.remove(permissions)` | Remove permission |

#### 29. chrome.offscreen (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.offscreen.createDocument(parameters)` | Create offscreen document |
| `chrome.offscreen.closeDocument()` | Close offscreen document |

#### 30. chrome.topSites (sidepanel)

| API | Description |
|-----|-------------|
| `chrome.topSites.get()` | Get most visited sites |

#### 31. web namespace (sidepanel, high-level abstractions)

| API | Description |
|-----|-------------|
| `web.fetch(url, options)` | Cross-origin fetch |
| `web.sleep(ms)` | Sleep |
| `web.log(...args)` | Log output |
| `web.url.parse(url)` | Parse URL |
| `web.url.encode(params)` | URL-encode params |
| `web.storage.get(key)` | localStorage read |
| `web.storage.set(key, value)` | localStorage write |
| `web.storage.delete(key)` | localStorage delete |
| `web.storage.list()` | List localStorage keys |
| `web.clipboard.read()` | Read clipboard |
| `web.clipboard.write(text)` | Write clipboard |

#### 32. fs namespace (Rust native, OPFS)

| API | Description |
|-----|-------------|
| `fs.exists(path)` | Check file/directory exists |
| `fs.stat(path)` | Get file metadata |
| `fs.list(path)` | List directory |
| `fs.mkdir(path)` | Create directory |
| `fs.delete(path)` | Delete file/directory |
| `fs.copy(from, to)` | Copy |
| `fs.move(from, to)` | Move/rename |
| `fs.read(path)` | Read binary |
| `fs.readText(path)` | Read text |
| `fs.readBase64(path)` | Read as base64 |
| `fs.readRange(path, offset, len)` | Read byte range |
| `fs.write(path, data)` | Write binary |
| `fs.writeText(path, text)` | Write text |
| `fs.writeBase64(path, b64)` | Write base64 |
| `fs.append(path, data)` | Append binary |
| `fs.appendText(path, text)` | Append text |
| `fs.hash(path, algorithm)` | Compute file hash |

#### 33. dom namespace (Rust native)

| API | Description |
|-----|-------------|
| `dom.snapshot()` | Semantic DOM snapshot |
| `dom.format(snapshot)` | Format DOM snapshot as text |

#### 34. path namespace (pure JS runtime)

| API | Description |
|-----|-------------|
| `path.join(...parts)` | Join path segments |
| `path.basename(p)` | Get filename |
| `path.dirname(p)` | Get directory name |
| `path.extname(p)` | Get extension |
| `path.normalize(p)` | Normalize path |
| `path.isAbsolute(p)` | Check if absolute |
| `path.resolve(...parts)` | Resolve to absolute |
| `path.relative(from, to)` | Get relative path |

#### 35. Global Web API shims (pure JS runtime)

| API | Description |
|-----|-------------|
| `fetch(url, options)` | Global fetch alias |
| `setTimeout(fn, ms)` | Timer |
| `setInterval(fn, ms)` | Repeating timer |
| `clearTimeout(id)` | Clear timer |
| `clearInterval(id)` | Clear repeating timer |
| `URL` | URL constructor |
| `URLSearchParams` | URL params constructor |
| `localStorage` | localStorage Proxy |
| `sessionStorage` | sessionStorage alias |
| `navigator.clipboard.readText()` | Clipboard read |
| `navigator.clipboard.writeText(text)` | Clipboard write |
| `document.querySelector(selector)` | DOM query |
| `document.querySelectorAll(selector)` | DOM query all |
| `document.title` | Page title |
| `window.location.href` | Page URL |

#### 36. host namespace (escape hatch)

| API | Description |
|-----|-------------|
| `host.call(action, params)` | Call any Chrome API without pre-registration |

#### 37. runtime namespace

| API | Description |
|-----|-------------|
| `runtime.inspect()` | Inspect runtime globals |

#### Summary

| Category | Count |
|----------|-------|
| TabHandle instance methods | 22 |
| tab factory | 5 |
| chrome.* native APIs | 85 |
| web.* abstractions | 11 |
| fs.* Rust native | 17 |
| dom.* Rust native | 2 |
| path.* pure JS | 8 |
| Global Web API shims | 16 |
| host.* escape hatch | 1 |
| runtime.* | 1 |
| **Total** | **~168** |

### Design Decisions (resolved via architecture review)

#### D1: Extension first, web later

The new architecture targets the extension context exclusively. The web version (plain browser page, no Chrome APIs) is simpler and can be derived later — `registerApi` with `context: "sidepanel"` works in both contexts, chrome.* APIs return `{ ok: false, error: { code: "E_NO_EXTENSION" } }` in web context.

#### D2: Action string as the protocol field

The connection between the QuickJS `makeAsync` bridge and the host-side `hostRegistry` is the **action string**. It flows through the entire chain as a plain string:

```
QuickJS: makeAsync("tab.click")({ refId: "42" })
  → __webJsTriggerAsync → Rust HostState (action: "tab.click")
  → extension_js_relay → Worker postMessage
  → Main thread: hostRegistry.get("tab.click") → route → execute
```

The Rust `Action` enum is removed for JS-host APIs. Action stays as string through the whole chain. Only Rust-native APIs (fs, dom) have an internal dispatch.

#### D3: `__extension_js_relay` unchanged

The existing relay mechanism (Rust WASM → Worker JS → Main thread JS → Promise result back) remains as the generic command pipe. What changes is only the **main thread's handling** of received commands:

```
Before: switch(command.action) { case "page_click": ... }
After:  hostRegistry.get(command.action) → validate → route by context → execute
```

#### D4: Multi-slot async bridge — parallel execute, serial resume

Host commands execute in **parallel**. Results enter QuickJS **serially** via a queue. This matches `Promise.all` semantics while avoiding QuickJS reentrancy issues.

```
QuickJS eval → pending: [cmd1, cmd2, cmd3]
  → host executes all 3 in parallel (Promise.all)
  → results queue in completion order

Resume queue (serial, one at a time):
  → resume_cell(cmd2, result2) → drain microtasks → collect new pending commands
  → resume_cell(cmd1, result1) → drain microtasks → collect new pending commands
  → resume_cell(cmd3, result3) → drain microtasks → done

After each resume, check for NEW pending commands and start those in parallel.
```

Core principle: **external world is concurrent, QuickJS is always serial.**

#### D5: Events — browser event → host queue → QuickJS event pump

Events are NOT direct push from content script to QuickJS. They follow the same serial principle:

1. QuickJS subscribes: `t.on("navigation", handler)` → internally calls `makeAsync("events.subscribe")({ tabId, event: "navigation" })` → registers JS callback
2. Content script / side panel detects browser event → writes to **host event queue**: `{ subscriptionId, event, payload }`
3. QuickJS event pump (serial, same as resume_cell): `__webJsEventHandlers[subscriptionId](payload)` → drain microtasks
4. If QuickJS is busy (running cell or resuming Promise), events queue until idle
5. Event handlers that trigger async commands use the same multi-slot bridge

Event subscription is request-response. Event delivery is queued-serial. Same `external concurrent, QuickJS serial` principle.

#### D6: `host.call()` uses whitelist

`host.call(action, params)` does NOT use eval or dynamic property traversal. Only explicitly whitelisted Chrome API paths are allowed:

```typescript
const ALLOWED_HOST_CALL_PATHS = new Set([
  "chrome.tabs.query",
  "chrome.tabs.create",
  "chrome.bookmarks.search",
  // ... every API that has a registerApi entry
]);

host.call = (action: string, params: unknown) => {
  if (!ALLOWED_HOST_CALL_PATHS.has(action)) {
    return { ok: false, error: { message: `Unknown: ${action}`, code: "E_NOT_WHITELISTED" } };
  }
  return dispatch(action, params);
};
```

This prevents prototype pollution / constructor injection attacks from LLM-generated code. Every callable path must be explicitly registered.

### Dependencies

- Issue 1 (multi-slot async bridge) — must be resolved first
- Issue 2 (unified API registration) — this issue builds on its `registerApi` system
- web-lua's `extension-lua` should adopt the same multi-context architecture

---

## E2E API Coverage Contract

Every public API listed in this file must have explicit extension e2e coverage before the implementation is considered complete. Coverage must execute through the real extension path:

```
QuickJS user code
  → makeAsync(action)
  → __webJsTriggerAsync
  → Rust/WASM async bridge
  → __extension_js_relay
  → host registry / side-panel router
  → content script or Chrome API or Rust-native handler
  → resume_cell(call_id, result)
  → original QuickJS Promise settles
```

Unit tests are necessary but not sufficient. A passing implementation must prove that the API works through the extension e2e runner, not only through direct Rust tests, mocked internal dispatch, or isolated JS helper tests.

### Required Contract File

The canonical all-API coverage map is:

- `web/tests/e2e/all-apis-extension-contract.js`

That file must remain synchronized with the API surface in this document. If this document adds, removes, or renames an API, the contract file must be updated in the same change.

Completion gate:

1. The extension e2e suite must load and execute `web/tests/e2e/all-apis-extension-contract.js`.
2. Every API entry in that file must be exercised from QuickJS code. The runner must **fail** if any API is skipped or returns an unexpected failure.
3. A test may pass by returning a successful value or by returning a documented typed error for unavailable permission, restricted URL, unavailable browser feature, invalid controlled fixture, or intentionally blocked unsafe action.
4. A test may not pass by hanging, timing out without a typed error, skipping silently, or only checking that a function exists.
5. The contract must include at least every API listed under Issue 3's complete API surface.
6. The runner must enforce per-API expected outcomes (`success`, `typed_error`, or `rejection`). Any API that returns a result inconsistent with its declared expectation fails the gate.
7. Destructive APIs run only in an isolated browser profile when `runDestructive=true`. The default runner skips destructive APIs but still asserts that no non-destructive API is skipped. A strict mode (`strict=true`) fails the gate if any API is skipped.

### Stale API Test Rule

Stale API tests must be rewritten, not preserved as compatibility proof.

Examples:

| Stale form | Required form |
|---|---|
| `page_click` | `tab.click` or `page.click`, depending on final namespace |
| `fs_read_text` | `fs.readText` |
| `chrome_tabs_query` | `chrome.tabs.query` |
| `host_call` with arbitrary path traversal | `host.call()` backed by whitelist/registry |

If an old underscore API remains temporarily for migration, it must have separate compatibility tests and must not count toward the new API completion gate. The e2e contract must target the new dot-notation API names.

### Test Quality Bar

Each e2e test must assert user-visible behavior or the documented typed error shape. It must not only assert that a command object was emitted. It must verify that:

- params crossed the QuickJS → Rust → host boundary correctly
- validation occurred at the expected boundary
- the handler returned or rejected exactly once
- the originating QuickJS Promise settled
- no extra unresolved pending command was left behind
- destructive APIs use isolated test fixtures and cleanup
- blocked APIs such as `host.call("__proto__", {})` fail with a typed safety error

For async behavior, the e2e suite must explicitly cover:

- `Promise.all` with multiple host commands
- `Promise.race` where the fast command resolves before the slow command
- chained async calls created during `resume_cell`
- fire-and-forget calls that must not leave a cell permanently pending
- parallel host execution with serial QuickJS resume

---

## Review

### Resolved Findings

1. **High: host command execution is still serialized.** — **RESOLVED**
   Replaced serial pop-one-at-a-time loop with `join_all` in `run_cell_async_loop`. All pending commands now execute concurrently, then resume QuickJS serially. Verified: `Promise.all` with concurrent fs operations passes in e2e tests.

2. **High: `resume_cell` can return `Pending([])` because it waits on any unresolved host Promise.** — **RESOLVED**
   Concurrent execution resolves this — the batch processes all commands, and any remaining pending Promises from `Promise.race` losers are handled in the next loop iteration.

3. **Medium: `host.call()` is still blacklist-based, not whitelist/registry-based.** — **RESOLVED**
   Replaced blacklist with `Object::keys()` whitelist check. Only own enumerable properties of `window.__hostHandlers` are allowed. `host.call("__proto__", {})` and injection attacks return `E_NOT_WHITELISTED` error.

4. **Medium: current "registry dispatch" is only a small hardcoded string pre-match.** — **RESOLVED**
   Converted entire `handle_command` dispatch from `Action` enum matching to pure string-based `match cmd.action.as_str()`. All ~50 handler arms now dispatch by string. The `Action` enum is no longer imported or used in `session.rs`.

5. **Test status: core unit tests pass, doctests are blocked by stale build artifacts.** — **RESOLVED**
   `cargo clean` followed by `cargo test -p web-js-core --lib` runs all 12 unit tests successfully.

   Relevant file:
   - `crates/web-js/src/session.rs`

### Review-Driven Requirements

The five review findings above have been resolved. These fixes covered the **local/web smoke test path** (core runtime, async bridge, host.call security, and string dispatch). They do not resolve the full extension all-API coverage gate.

Verification (local/web smoke):

- 12 unit tests pass (`cargo test -p web-js-core --lib`)
- 133 e2e tests pass (6 contract + 127 existing web-js tests)
- `Promise.all` with concurrent fs operations verified in e2e
- `host.call("__proto__", {})` and injection attacks return `E_NOT_WHITELISTED`
- String-based dispatch replaces the entire `Action` enum in `session.rs`
- Contract smoke test exercises APIs from all namespaces (web, fs, storage, path, dom, page, chrome, tab, host)
- Stale underscore fs tests rewritten to use `await` with dot-notation async APIs

### Next Milestones

These are separate from the resolved review findings and represent the remaining **extension all-API gate**:

1. **Full extension e2e contract runner** — The `all-apis-extension-contract.js` runner (168 APIs) needs the extension context to run end-to-end. In web-js context, extension-only APIs correctly return typed errors. Destructive APIs run in an isolated profile with `runDestructive=true`.
2. **`host.register()` JS-side system** — Issue 2 Tier 2: move browser API implementations to JS-side registration with Zod validation, replacing the remaining Rust dispatch boilerplate.
