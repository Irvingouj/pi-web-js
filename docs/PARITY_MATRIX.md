# web-lua → web-js Parity Matrix

## Engine Choice

**Requirement**: QuickJS as the guest JavaScript engine.  
**Decision**: Use **QuickJS** via [`rquickjs`](https://github.com/DelSkayn/rquickjs) as the guest JS engine.

**Why QuickJS works for `wasm32-unknown-unknown`**
- QuickJS is written in C and requires `libc` (stdlib.h, malloc, pthread, etc.).
- The `wasm32-unknown-unknown` Rust target has no C standard library.
- We compile QuickJS C sources with a **stub C standard library** (`/tmp/fake-stdlib`) providing minimal declarations (stdio.h, stdlib.h, string.h, pthread.h, etc.) sufficient for QuickJS compilation.
- We use **Homebrew LLVM clang** (`/opt/homebrew/opt/llvm/bin/clang`) as the cross-compiler, which includes the `wasm32` backend.
- `rquickjs-sys` uses the `cc` crate for C compilation and `bindgen` for FFI bindings. We set:
  - `CC_wasm32_unknown_unknown=/opt/homebrew/opt/llvm/bin/clang`
  - `CFLAGS_wasm32_unknown_unknown=-I/tmp/fake-stdlib`
  - `LIBCLANG_PATH=/opt/homebrew/opt/llvm/lib`
  - `BINDGEN_EXTRA_CLANG_ARGS=-I/tmp/fake-stdlib`
- `rquickjs` provides safe Rust bindings around QuickJS with `Ctx<'js>`, `Value<'js>`, `Func::new`, and `Context::with` for scoped execution.

**Security model**
- Guest JS must not access host globals directly.
- Only explicit host capabilities are exposed through registered native functions.
- `eval` is explicitly disabled in the global scope.
- No `window`, `document`, `fetch`, `chrome`, or filesystem access is injected into the JS global scope unless routed through approved host APIs (`web.*`, `page.*`, `fs.*`, etc.).

---

## Capability Parity

| Category | Lua API (`web-lua`) | JS API (`web-js`) | Web | Extension |
|----------|---------------------|-------------------|:---:|:---:|
| **Core Runtime** | | | | |
| Execution | `run_cell(code, stdin)` | `runCell(code, stdin)` | ✅ | ✅ |
| Fuel limit | `set_fuel_limit(n)` | `setFuelLimit(n)` | ✅ | ✅ |
| Reset | `reset()` | `reset()` | ✅ | ✅ |
| Inspect globals | `inspect_globals()` | `inspectGlobals()` | ✅ | ✅ |
| Load library | `load_library(source)` | `loadLibrary(source)` | ✅ | ✅ |
| Stdout | `print(...)` | `console.log(...)` / `print(...)` | ✅ | ✅ |
| Stderr | `io.stderr:write(...)` | `console.error(...)` / `console.warn(...)` | ✅ | ✅ |
| Stdin | `input()`, `read()` | `input()`, `read()` | ✅ | ✅ |
| Commands | `emit(value)` | `emit(value)` | ✅ | ✅ |
| **Network** | | | | |
| Fetch | `web.fetch(url, opts)` | `await web.fetch(url, opts)` | ✅ | ✅ |
| Sleep | `web.sleep(ms)` | `await web.sleep(ms)` | ✅ | ✅ |
| **Page / DOM** | | | | |
| Navigate | `page.goto(url)` | `await page.goto(url)` | ✅ | ❌ |
| Click | `page.click(opts)` | `await page.click(ref_id)` | ✅ | ❌ |
| Fill | `page.fill(opts)` | `await page.fill(ref_id, value)` | ✅ | ❌ |
| Type | `page.type(opts)` | `await page.type(ref_id, text)` | ✅ | ❌ |
| Append | `page.append(opts)` | `await page.append(ref_id, text)` | ✅ | ❌ |
| Press key | `page.press(opts)` | `await page.press(key)` | ✅ | ❌ |
| Select | `page.select(opts)` | `await page.select(ref_id, value)` | ✅ | ❌ |
| Check | `page.check(opts)` | `await page.check(ref_id, checked)` | ✅ | ❌ |
| Hover | `page.hover(opts)` | `await page.hover(ref_id)` | ✅ | ❌ |
| Unhover | `page.unhover()` | `await page.unhover()` | ✅ | ❌ |
| Scroll | `page.scroll(opts)` | `await page.scroll(direction, amount)` | ✅ | ❌ |
| ScrollTo | `page.scrollTo(opts)` | `await page.scroll_to(ref_id)` | ✅ | ❌ |
| DblClick | `page.dblclick(opts)` | `await page.dblclick(ref_id)` | ✅ | ❌ |
| URL | `page.url()` | `await page.url()` | ✅ | ❌ |
| Title | `page.title()` | `await page.title()` | ✅ | ❌ |
| Back | `page.back()` | `await page.back()` | ✅ | ❌ |
| Forward | `page.forward()` | `await page.forward()` | ✅ | ❌ |
| Reload | `page.reload()` | `await page.reload()` | ✅ | ❌ |
| Wait | `page.wait(opts)` | `await page.wait(ms)` | ✅ | ❌ |
| Find | `page.find(opts)` | `await page.find(selector)` | ✅ | ❌ |
| WaitFor | `page.waitFor(opts)` | `await page.wait_for(selector, timeout)` | ✅ | ❌ |
| Extract | `page.extract(opts)` | `await page.extract(fields)` | ✅ | ❌ |
| Snapshot | `page.snapshot(opts)` | `await page.snapshot(opts)` | ✅ | ❌ |
| SnapshotText | `page.snapshotText(...)` | `await page.snapshot_text(...)` | ✅ | ❌ |
| SnapshotData | `page.snapshotData(...)` | `await page.snapshot_data(...)` | ✅ | ❌ |
| Screenshot | `page.screenshot()` | `await page.screenshot()` | ⚠️ | ⚠️ |
| **Tab (Extension)** | `tab.*` | `web.tab.*` | ❌ | ✅ |
| Query | `tab.query(opts)` | `await web.tab.query(opts)` | ❌ | ✅ |
| Create | `tab.create(opts)` | `await web.tab.create(opts)` | ❌ | ✅ |
| Activate | `tab.activate(tabId)` | `await web.tab.activate(tabId)` | ❌ | ✅ |
| Close | `tab.close(tabId)` | `await web.tab.close(tabId)` | ❌ | ✅ |
| ExecuteScript | `tab.executeScript(tabId, script)` | `await web.tab.execute_script(tabId, script)` | ❌ | ✅ |
| Click | `tab.click(tabId, refId)` | `await web.tab.click(tabId, refId)` | ❌ | ✅ |
| Fill | `tab.fill(tabId, refId, value)` | `await web.tab.fill(tabId, refId, value)` | ❌ | ✅ |
| Snapshot | `tab.snapshot(tabId)` | `await web.tab.snapshot(tabId)` | ❌ | ✅ |
| ScrollTo | `tab.scrollTo(tabId, x, y, refId)` | `await web.tab.scroll_to(tabId, x, y, refId)` | ❌ | ✅ |
| Evaluate | `tab.evaluate(tabId, script)` | `await web.tab.evaluate(tabId, script)` | ❌ | ✅ |
| Type | `tab.type(tabId, refId, text)` | `await web.tab.type(tabId, refId, text)` | ❌ | ✅ |
| Press | `tab.press(tabId, key)` | `await web.tab.press(tabId, key)` | ❌ | ✅ |
| Select | `tab.select(tabId, refId, value)` | `await web.tab.select(tabId, refId, value)` | ❌ | ✅ |
| Check | `tab.check(tabId, refId, checked)` | `await web.tab.check(tabId, refId, checked)` | ❌ | ✅ |
| Hover | `tab.hover(tabId, refId)` | `await web.tab.hover(tabId, refId)` | ❌ | ✅ |
| Unhover | `tab.unhover(tabId)` | `await web.tab.unhover(tabId)` | ❌ | ✅ |
| Scroll | `tab.scroll(tabId, direction, amount)` | `await web.tab.scroll(tabId, direction, amount)` | ❌ | ✅ |
| Dblclick | `tab.dblclick(tabId, refId)` | `await web.tab.dblclick(tabId, refId)` | ❌ | ✅ |
| Back | `tab.back(tabId)` | `await web.tab.back(tabId)` | ❌ | ✅ |
| WaitForLoad | `tab.waitForLoad(tabId, timeout)` | `await web.tab.wait_for_load(tabId, timeout)` | ❌ | ✅ |
| Fetch | `tab.fetch(tabId, url, opts)` | `await web.tab.fetch(tabId, url, opts)` | ❌ | ✅ |
| **Sidepanel** | `sidepanel.*` | `sidepanel.*` | ✅ | ❌ |
| **Storage** | | | | |
| Get | `storage.get(key)` | `await web.storage.get(key)` | ✅ | ✅ |
| Set | `storage.set(key, value)` | `await web.storage.set(key, value)` | ✅ | ✅ |
| Delete | `storage.delete(key)` | `await web.storage.delete(key)` | ✅ | ✅ |
| List | `storage.list()` | `await web.storage.list()` | ✅ | ✅ |
| **Filesystem** | | | | |
| Exists | `fs.exists(path)` | `await fs.exists(path)` | ✅ | ✅ |
| Stat | `fs.stat(path)` | `await fs.stat(path)` | ✅ | ✅ |
| List | `fs.list(path)` | `await fs.list(path)` | ✅ | ✅ |
| Mkdir | `fs.mkdir(path)` | `await fs.mkdir(path)` | ✅ | ✅ |
| Delete | `fs.delete(path)` | `await fs.delete(path)` | ✅ | ✅ |
| Copy | `fs.copy(from, to)` | `await fs.copy(from, to)` | ✅ | ✅ |
| Move | `fs.move(from, to)` | `await fs.move(from, to)` | ✅ | ✅ |
| Read | `fs.read(path)` → base64 | `await fs.read(path)` → base64 string | ✅ | ✅ |
| ReadText | `fs.readText(path)` | `await fs.read_text(path)` | ✅ | ✅ |
| ReadBase64 | `fs.readBase64(path)` | `await fs.read_base64(path)` | ✅ | ✅ |
| ReadRange | `fs.readRange(path, offset, len)` | `await fs.read_range(path, offset, len)` | ✅ | ✅ |
| Write | `fs.write(path, data)` base64 | `await fs.write(path, data)` base64 | ✅ | ✅ |
| WriteText | `fs.writeText(path, text)` | `await fs.write_text(path, text)` | ✅ | ✅ |
| WriteBase64 | `fs.writeBase64(path, b64)` | `await fs.write_base64(path, b64)` | ✅ | ✅ |
| Append | `fs.append(path, data)` | `await fs.append(path, data)` | ✅ | ✅ |
| AppendText | `fs.appendText(path, text)` | `await fs.append_text(path, text)` | ✅ | ✅ |
| AppendBase64 | `fs.appendBase64(path, b64)` | `await fs.append_base64(path, b64)` | ✅ | ✅ |
| Update | `fs.update(path, offset, data)` | `await fs.update(path, offset, data)` | ✅ | ✅ |
| Hash | `fs.hash(path, algo)` | `await fs.hash(path, algo)` | ✅ | ✅ |
| **DOM Semantic Tree** | | | | |
| Snapshot | `dom.snapshot(opts)` | `await dom.snapshot(opts)` | ✅ | ✅ |
| Format | `dom.format(snapshot, format)` | `await dom.format(snapshot, format)` | ✅ | ✅ |
| **Chrome APIs (Extension)** | `chrome.*` | `chrome.*` | ❌ | ✅ |
| RuntimeSendMessage | `chrome.runtime.sendMessage(msg)` | `await chrome.runtime.sendMessage(msg)` | ❌ | ✅ |
| TabsQuery | `chrome.tabs.query(queryInfo)` | `await chrome.tabs.query(queryInfo)` | ❌ | ✅ |
| TabsCreate | `chrome.tabs.create(createProperties)` | `await chrome.tabs.create(createProperties)` | ❌ | ✅ |
| TabsUpdate | `chrome.tabs.update(tabId, updateProperties)` | `await chrome.tabs.update(tabId, updateProperties)` | ❌ | ✅ |
| TabsRemove | `chrome.tabs.remove(tabIds)` | `await chrome.tabs.remove(tabIds)` | ❌ | ✅ |
| TabsGet | `chrome.tabs.get(tabId)` | `await chrome.tabs.get(tabId)` | ❌ | ✅ |
| TabsReload | `chrome.tabs.reload(tabId, opts)` | `await chrome.tabs.reload(tabId, opts)` | ❌ | ✅ |
| TabsSendMessage | `chrome.tabs.sendMessage(tabId, message)` | `await chrome.tabs.sendMessage(tabId, message)` | ❌ | ✅ |
| AlarmsCreate | `chrome.alarms.create(name, alarmInfo)` | `await chrome.alarms.create(name, alarmInfo)` | ❌ | ✅ |
| AlarmsClear | `chrome.alarms.clear(name)` | `await chrome.alarms.clear(name)` | ❌ | ✅ |
| ActionSetBadgeText | `chrome.action.setBadgeText(details)` | `await chrome.action.setBadgeText(details)` | ❌ | ✅ |
| ActionSetBadgeBackgroundColor | `chrome.action.setBadgeBackgroundColor(details)` | `await chrome.action.setBadgeBackgroundColor(details)` | ❌ | ✅ |
| ActionSetTitle | `chrome.action.setTitle(details)` | `await chrome.action.setTitle(details)` | ❌ | ✅ |
| ActionSetIcon | `chrome.action.setIcon(details)` | `await chrome.action.setIcon(details)` | ❌ | ✅ |
| ContextMenusCreate | `chrome.contextMenus.create(createProperties)` | `await chrome.contextMenus.create(createProperties)` | ❌ | ✅ |
| ContextMenusRemove | `chrome.contextMenus.remove(menuItemId)` | `await chrome.contextMenus.remove(menuItemId)` | ❌ | ✅ |
| WindowsGetAll | `chrome.windows.getAll(getInfo)` | `await chrome.windows.getAll(getInfo)` | ❌ | ✅ |
| WindowsCreate | `chrome.windows.create(createData)` | `await chrome.windows.create(createData)` | ❌ | ✅ |
| WindowsUpdate | `chrome.windows.update(windowId, updateInfo)` | `await chrome.windows.update(windowId, updateInfo)` | ❌ | ✅ |
| WindowsRemove | `chrome.windows.remove(windowId)` | `await chrome.windows.remove(windowId)` | ❌ | ✅ |
| SidePanelSetOptions | `chrome.sidePanel.setOptions(options)` | `await chrome.sidePanel.setOptions(options)` | ❌ | ✅ |
| CookiesGet | `chrome.cookies.get(details)` | `await chrome.cookies.get(details)` | ❌ | ✅ |
| CookiesSet | `chrome.cookies.set(details)` | `await chrome.cookies.set(details)` | ❌ | ✅ |
| CookiesRemove | `chrome.cookies.remove(details)` | `await chrome.cookies.remove(details)` | ❌ | ✅ |
| CookiesGetAll | `chrome.cookies.getAll(details)` | `await chrome.cookies.getAll(details)` | ❌ | ✅ |
| BookmarksSearch | `chrome.bookmarks.search(query)` | `await chrome.bookmarks.search(query)` | ❌ | ✅ |
| BookmarksCreate | `chrome.bookmarks.create(bookmark)` | `await chrome.bookmarks.create(bookmark)` | ❌ | ✅ |
| BookmarksRemove | `chrome.bookmarks.remove(id)` | `await chrome.bookmarks.remove(id)` | ❌ | ✅ |
| HistorySearch | `chrome.history.search(query)` | `await chrome.history.search(query)` | ❌ | ✅ |
| HistoryDeleteUrl | `chrome.history.deleteUrl(details)` | `await chrome.history.deleteUrl(details)` | ❌ | ✅ |
| NotificationsCreate | `chrome.notifications.create(notificationId, options)` | `await chrome.notifications.create(notificationId, options)` | ❌ | ✅ |
| NotificationsClear | `chrome.notifications.clear(notificationId)` | `await chrome.notifications.clear(notificationId)` | ❌ | ✅ |
| ScriptingExecuteScript | `chrome.scripting.executeScript(target, func)` | `await chrome.scripting.executeScript(target, func)` | ❌ | ✅ |
| **Other** | | | | |
| Host call | `host.call(action, params)` | `await host.call(action, params)` | ✅ | ✅ |
| Runtime inspect | `runtime.inspect()` | `runtime.inspect()` | ✅ | ✅ |
| URL parse | `url.parse(url)` | `web.url.parse(url)` | ✅ | ✅ |
| URL encode | `url.encode(str)` | `web.url.encode(str)` | ✅ | ✅ |
| Web log | `web.log(...)` | `web.log(...)` | ✅ | ✅ |
| JSON | `json.encode(t)`, `json.decode(s)` | Native `JSON.stringify`, `JSON.parse` | ✅ | ✅ |
| **Extension Page APIs** | | | | |
| PageTabs | `page.tabs()` | `await page.tabs()` | ❌ | ✅ |
| PageSwitch | `page.switch(tabId)` | `await page.switch(tabId)` | ❌ | ✅ |
| PageNewTab | `page.newTab(url)` | `await page.new_tab(url)` | ❌ | ✅ |
| PageClose | `page.close(tabId)` | `await page.close(tabId)` | ❌ | ✅ |
| PageActiveTab | `page.activeTab()` | `await page.active_tab()` | ❌ | ✅ |
| **Cookies (web)** | | | | |
| Get | `cookies.get(details)` | `await web.cookies.get(details)` | ❌ | ✅ |
| Set | `cookies.set(details)` | `await web.cookies.set(details)` | ❌ | ✅ |
| Delete | `cookies.remove(details)` | `await web.cookies.delete(details)` | ❌ | ✅ |
| List | `cookies.getAll(details)` | `await web.cookies.list(details)` | ❌ | ✅ |
| **Clipboard** | | | | |
| Read | `clipboard.read()` | `await web.clipboard.read()` | ❌ | ✅ |
| Write | `clipboard.write(data)` | `await web.clipboard.write(data)` | ❌ | ✅ |

### Legend
- ✅ — Implemented and working in this context
- ❌ — Not available in this context (extension-only or web-only)
- ⚠️ — Partial / not yet implemented

---

## Design Differences

### Async Model
- **Lua**: Uses coroutine yield/resume. Lua calls a sync-looking API, the VM yields, the worker resolves the async call, then resumes with the result.
- **JS**: Native `async/await` and `Promise`. Guest JS uses `await` on async host APIs. QuickJS natively supports Promises. The host bridge wraps async calls in a `__webJsTriggerAsync` mechanism that stores `resolve`/`reject` callbacks in `__webJsPending[call_id]`, then resumes the Promise when the host responds via `resume_cell`.

### Fuel System
- **Lua**: Piccolo's built-in `Fuel` system counts VM instructions.
- **JS**: QuickJS does not have a built-in instruction counter, but it supports an **interrupt handler** (`Runtime::set_interrupt_handler`). We implement fuel by storing a limit in an `Arc<AtomicU64>` and decrementing it on each interrupt check. When the counter reaches zero, execution is interrupted and reported as `CellError::FuelExhausted`.

### Binary Data
- **Lua**: Base64-encoded strings on the wire because Lua strings are byte sequences but JSON serialization needs text.
- **JS**: Currently still base64-encoded strings over the JSON bridge because wasm-bindgen + serde_json do not natively transfer `Uint8Array` for async command parameters. The JS API accepts plain strings/objects and the host converts to/from base64. Future work: transfer `Uint8Array` directly via wasm-bindgen typed arrays.

### Error Model
- **Lua**: Structured `CellError` with `kind: compile | runtime | strict_mode | fuel_exhausted | internal`.
- **JS**: Structured `CellError` with `kind: compile | runtime | fuel_exhausted | internal`. No `strict_mode` because JS uses `let`/`const`/`var` for variable control; undeclared variables in strict mode throw `ReferenceError` which is classified as a runtime error.

### Globals / Security
- **Lua**: Custom strict mode via `__index` metamethod on globals table.
- **JS**: QuickJS runs with a clean global scope. We explicitly inject only approved host APIs (`print`, `input`, `read`, `emit`, `web`, `page`, `fs`, `dom`, `host`, `runtime`, `console`, etc.). `eval` is disabled. No `window`, `document`, `fetch`, `chrome`, or filesystem access unless routed through approved APIs.
