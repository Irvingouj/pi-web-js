# web-js / web-lua Parity Review

**Date:** 2026-05-27
**web-js path:** `/Users/oujunyi/code/web-js`
**web-lua path:** `/Users/oujunyi/code/web-lua`

## 1. JS API Surface Parity (`crates/*-core/src/web/mod.rs` and submodules)

### web-lua (reference)
- Modular registration using piccolo `Table`s.
- Submodules: `bookmarks`, `chrome`, `clipboard`, `cookies`, `dom`, `fetch`, `fs`, `history`, `host`, `log`, `notifications`, `page`, `protector`, `runtime`, `sidepanel`, `storage`, `tab`, `url`.
- Macros: `lua_api!`, `lua_api_doc!`, `set_protected!`, `set_protected_global!`.
- Lua prelude (`prelude.lua` + `PATH_PRELUDE`) injects top-level aliases: `tab.*`, `runtime.*`, `page.go`, `path.*`, etc.
- `fs` registered both under `web.fs` and as a global `fs`.
- `chrome.*` namespaces fully wrapped with `set_protected!`.
- `web.fetch` and `web.sleep` validated against `FetchParams` / `SleepParams`.
- Full VFS API: `exists`, `stat`, `list`, `mkdir`, `delete`, `copy`, `move`, `read`, `read_text`, `read_base64`, `read_range`, `write`, `write_text`, `write_base64`, `append`, `append_text`, `append_base64`, `update`, `hash`.
- Page API: `snapshot`, `snapshot_data`, `snapshot_text`, `click`, `dblclick`, `fill`, `type`, `press`, `select`, `check`, `hover`, `unhover`, `scroll`, `scroll_to`, `url`, `title`, `screenshot`, `goto`, `back`, `forward`, `reload`, `wait`, `tabs`, `switch`, `new_tab`, `close`, `active_tab`, `find`, `wait_for`, `extract`, `append`.
- Sidepanel API mirrors most of the page API.
- `host.call(action, params)` -> `Action::Host(action)`.
- `runtime.inspect()` returns a table of globals with type/value/keys.

### web-js
- Single-file API registration for rquickjs.
- Injects native functions: `__webJsLog`, `__webJsUrlParse`, `__webJsUrlEncode`, `__webJsRuntimeInspect`.
- Evaluates a large JS string (`build_async_api_js()`) that creates namespaces: `web`, `web.url`, `web.tab`, `web.storage`, `web.cookies`, `web.history`, `web.bookmarks`, `web.notifications`, `web.clipboard`, `fs`, `chrome.*`, `dom`, `page`, `sidepanel`, `host`, `runtime`.
- JS prelude injects top-level aliases: `tab.*`, `runtime.*`, `page.go`, `path.*`, `page.fetch`.
- `web.storage` and `web.clipboard` wrapped for positional arg ergonomics.
- No `lua_api_doc!`-style documentation registry; no `generateApiDocs` export.

### Checklist
- [x] Core namespaces present (`web`, `web.tab`, `web.storage`, `web.cookies`, `web.history`, `web.bookmarks`, `web.notifications`, `web.clipboard`, `fs`, `chrome`, `dom`, `page`, `sidepanel`, `host`, `runtime`)
- [x] Top-level JS aliases (`tab.*`, `runtime.*`, `page.go`, `path.*`) — injected via JS prelude
- [x] API documentation registry (`generateApiDocs`) — exported via wasm_bindgen, generates markdown + JSON
- [x] `web.fetch` / `web.sleep`
- [x] Full `fs` VFS API
- [x] Full `page` interaction API
- [x] Full `sidepanel` interaction API
- [x] `host.call`
- [x] `runtime.inspect`

---

## 2. Extension Content Script / Background Script Parity (`crates/extension-*/js/`)

### web-lua files
- `crates/extension-lua/js/index.ts`
- `crates/extension-lua/js/runner.ts`
- `crates/extension-lua/js/worker.ts`

### web-js files
- `crates/extension-js/js/index.ts`
- `crates/extension-js/js/runner.ts`
- `crates/extension-js/js/worker.ts`

### Checklist
- [x] `ExtensionSession` proxy class (spawns Worker, `asyncRelay`, `runCellAsync`, `reset`, `inspectGlobals`, `setFuelLimit`, `loadLibrary`, `stopWith`) — **functionally identical**
- [x] Main-thread command dispatcher (`runner.ts`) — handles `storage_*`, `clipboard_*`, `fetch`, `sleep`, `page_*`, `sidepanel_*`, `dom_snapshot`, `dom_format`, `tab_*`, `cookies_*`, `history_*`, `bookmarks_*`, `notifications_*`, `chrome_*` passthrough — **nearly identical (~2000 lines)**
- [x] Worker bootstrap (`worker.ts`) — loads WASM, defines `__extension_*_relay`, message handlers — **identical**
- [x] Content-script / background script packaging (manifest, background.js, content-script.js)

---

## 3. Extension Rust Host Parity (`crates/extension-*/src/`)

### web-lua files
- `crates/extension-lua/src/lib.rs`
- `crates/extension-lua/src/session.rs`
- `crates/extension-lua/src/log.rs`

### web-js files
- `crates/extension-js/src/lib.rs`
- `crates/extension-js/src/session.rs`
- `crates/extension-js/src/log.rs`

### Checklist
- [x] `lib.rs` module exports (`log`, `session`) — identical structure
- [x] `generate_api_docs` WASM export — `generateApiDocs(format)` exported via wasm_bindgen
- [x] `session.rs` methods: `new`, `reset`, `set_fuel_limit`, `load_library`, `inspect_globals`, `stop_with`, `run_cell_async`
- [x] JS prelude injection in `register_web_module()` — `tab.*`, `runtime.*`, `page.go`, `path.*`, `page.fetch`
- [x] API doc alias registrations — registered via `api_docs::register_all_api_docs()` in `web/mod.rs`
- [x] `__extension_*_relay` wiring (`__extension_js_relay` vs `__extension_lua_relay`)

---

## 4. Demo / Showcase App Parity (`web/src/showcase.ts`)

### web-lua files
- `web-lua/web/src/showcase.ts`

### web-js files
- `web-js/web/src/showcase.ts`

### Checklist
- [x] 10-section notebook covering: Welcome, Variables & Control Flow, Functions & Arrow Functions, Objects & Arrays, JSON Encoding & Decoding, HTTP Requests, Local Storage, Cryptography, URL Utilities, Async Operations
- [x] Same APIs exercised (`web.fetch`, `web.storage`, `crypto`, `web.url`, `web.sleep`)
- [x] Same cell structure and markdown formatting
- [ ] Showcase references Boa engine in web-js footer — **web-lua equivalent should reference piccolo (cosmetic)**

---

## 5. E2E Test Parity (`web/tests/e2e/`)

### web-lua files (15 tests)
- `chrome-action-windows.spec.ts`
- `chrome-alarms-menus.spec.ts`
- `chrome-tabs.spec.ts`
- `debug-ext.spec.ts`
- `dom-snapshot.spec.ts`
- `extension-smoke.spec.ts`
- `extension.spec.ts`
- `fetch.spec.ts`
- `fs.spec.ts`
- `host-call.spec.ts`
- `notebook.spec.ts`
- `page-agent.spec.ts`
- `page-interactions.spec.ts`
- `storage.spec.ts`
- `url-log-sleep.spec.ts`

### web-js files (15 tests)
- `chrome-action-windows.spec.ts`
- `chrome-alarms-menus.spec.ts`
- `chrome-tabs.spec.ts`
- `debug-ext.spec.ts`
- `dom-snapshot.spec.ts`
- `extension-smoke.spec.ts`
- `extension.spec.ts`
- `fetch.spec.ts`
- `fs.spec.ts`
- `host-call.spec.ts`
- `notebook.spec.ts`
- `page-agent.spec.ts`
- `page-interactions.spec.ts`
- `storage.spec.ts`
- `url-log-sleep.spec.ts`

### Checklist
- [x] `chrome-action-windows.spec.ts`
- [x] `chrome-alarms-menus.spec.ts`
- [x] `chrome-tabs.spec.ts`
- [x] `debug-ext.spec.ts`
- [x] `dom-snapshot.spec.ts`
- [x] `extension-smoke.spec.ts`
- [x] `extension.spec.ts`
- [x] `fetch.spec.ts`
- [x] `fs.spec.ts`
- [x] `host-call.spec.ts`
- [x] `notebook.spec.ts`
- [x] `page-agent.spec.ts`
- [x] `page-interactions.spec.ts`
- [x] `storage.spec.ts`
- [x] `url-log-sleep.spec.ts`

---

## 6. Type / Command Parameter Parity (`types.rs`, `command_params.rs`, `action.rs`, `state.rs`)

### web-lua files
- `crates/web-lua-core/src/types.rs`
- `crates/web-lua-core/src/command_params.rs`
- `crates/web-lua-core/src/action.rs`
- `crates/web-lua-core/src/state.rs`

### web-js files
- `crates/web-js-core/src/types.rs`
- `crates/web-js-core/src/command_params.rs`
- `crates/web-js-core/src/action.rs`
- `crates/web-js-core/src/state.rs`

### Checklist
- [x] `CellError`, `CellStatus`, `GlobalVariable`, `GlobalsSnapshot`, `AsyncCommand`, `AsyncResponse`, `AsyncError`, `RunResult` — structurally identical
- [ ] `CellError` has extra `StrictMode` variant in web-lua — **web-js lacks this variant** (JS engine difference; low risk)
- [x] `Action` enum (~160 variants) — identical including `Host(String)` and `Other(String)` catch-alls
- [x] All param structs present: `FetchParams`, `SleepParams`, `PageClickParams`, `PageDblClickParams`, `PageFillParams`, `PageTypeParams`, `PagePressParams`, `PageSelectParams`, `PageCheckParams`, `PageHoverParams`, `PageScrollParams`, `PageScrollToParams`, `PageGotoParams`, `PageFindParams`, `PageWaitForParams`, `PageExtractParams`, `PageAppendParams`, `PageWaitParams`, `StorageGetParams`, `StorageSetParams`, `StorageDeleteParams`, `DomSnapshotParams`, `DomFormatParams`, `TabClickParams`, `TabFillParams`, `TabEvaluateParams`, `TabBackParams`, `TabWaitForLoadParams`, `TabScrollToParams`, `TabTypeParams`, `TabPressParams`, `TabSelectParams`, `TabCheckParams`, `TabHoverParams`, `TabUnhoverParams`, `TabScrollParams`, `TabDblClickParams`, `FsWriteParams`, `FsPathParams`, `FsCopyParams`, `FsUpdateParams`, `FsHashParams`, `FsReadRangeParams`
- [x] `#[ts(export_to = "web/src/types/generated.ts")]` annotations — present on all exported types
- [x] `HostState` struct — identical

---

## 7. Build Script / Toolchain Parity (`scripts/build.js`, `scripts/bundle-wasm.js`, `Cargo.toml`)

### web-lua files
- `scripts/build.js`
- `scripts/bundle-wasm.js`
- `Cargo.toml`

### web-js files
- `scripts/build.js`
- `scripts/bundle-wasm.js`
- `Cargo.toml`

### Checklist
- [x] WASM build pipeline: `cargo build --target wasm32-unknown-unknown` -> `wasm-bindgen` -> `bundle-wasm.js` — identical
- [x] `bundle-wasm.js` base64-embedding post-processor — identical
- [x] `generateApiDocs("markdown")` and `generateApiDocs("json")` generation after WASM bundling — exported via wasm_bindgen
- [x] TypeScript compilation (`tsc`) for extension `content-script.ts` with ESM-marker stripping — implemented
- [x] Copying `web/src/types/generated.ts` into extension js dir as `generated.ts` for tsc — implemented
- [x] `dom-semantic-tree` and `web-fs` shared crates
- [ ] `web-lua` workspace includes `piccolo` and `web-lua-plugin-crypto`; `web-js` workspace includes `rquickjs` — **different engine dependencies**

---

## Summary Table

| Area | web-lua files | web-js files | Missing in web-js | Risk Level |
|------|---------------|--------------|-------------------|------------|
| 1. JS API Surface | 19 submodules in `web/mod.rs` + prelude | Single `mod.rs` + JS string + prelude | None | **Low** |
| 2. Extension Scripts | `index.ts`, `runner.ts`, `worker.ts` | `index.ts`, `runner.ts`, `worker.ts` | None | **Low** |
| 3. Extension Rust Host | `lib.rs`, `session.rs`, `log.rs` | `lib.rs`, `session.rs`, `log.rs` | None | **Low** |
| 4. Demo / Showcase | `showcase.ts` | `showcase.ts` | None (cosmetic engine name difference only) | **Low** |
| 5. E2E Tests | 15 `.spec.ts` files | 15 `.spec.ts` files | None | **Low** |
| 6. Types / Commands | `types.rs`, `command_params.rs`, `action.rs`, `state.rs` | `types.rs`, `command_params.rs`, `action.rs`, `state.rs` | `StrictMode` variant (JS engine difference) | **Low** |
| 7. Build / Toolchain | `build.js`, `bundle-wasm.js`, `Cargo.toml` | `build.js`, `bundle-wasm.js`, `Cargo.toml` | None | **Low** |

---

## Overall Assessment

- **Low-risk gaps:** `CellError::StrictMode` variant (JS engine difference — QuickJS does not produce this error type), cosmetic showcase engine name.
- **Medium-risk gaps:** None remaining. All top-level aliases (`tab.*`, `runtime.*`, `page.go`, `path.*`), parameter ergonomics (`web.storage.get("key")`), and missing APIs (`page.fetch`, `path.*`) have been addressed.
- **High-risk gaps:** None remaining. The E2E test suite is now fully covered (15/15 files).
