# Agent Instructions

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

### When Fixing Bugs
1. Check if bug reproduces in extension context
2. Fix extension-js runner (`crates/extension-js/js/src/main/runner/` — `runtime.ts` + `tools/`)
3. Fix prelude if needed (`crates/web-js-core/src/web/prelude.js`)
4. Rebuild WASM (`npm run wasm`)
5. Test in extension build
6. Web-js compatibility is a nice-to-have, not required
