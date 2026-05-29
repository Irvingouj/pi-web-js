# web-js API Surface — LLM Usability Analysis

## Core Insight

LLMs are trained on billions of lines of real JavaScript. The closer our API is to real Web APIs (fetch, localStorage, chrome.*, document.*, Node.js fs), the less the LLM needs to "learn" our custom abstractions. Every custom namespace (`web.tab`, `web.storage`) is friction.

## Current API Inventory (from `build_async_api_js()`)

### Tier 1 — Global / Web APIs
| What we have | What LLMs know | Gap |
|--------------|----------------|-----|
| `web.fetch(url)` | `fetch(url)` | **MISSING** — most common HTTP API |
| `web.sleep(ms)` | `setTimeout(fn, ms)` | **MISSING** — standard async primitive |
| `print(...)` | `console.log(...)` | PARTIAL — `console.log` works but `print` is non-standard |
| `web.log(...)` | `console.log(...)` | Redundant — `console` already exists |
| `web.url.parse(url)` | `new URL(url)` | **MISSING** |
| `web.url.encode(params)` | `new URLSearchParams(params)` | **MISSING** |
| — | `localStorage.getItem(key)` | **MISSING** |
| — | `sessionStorage.getItem(key)` | **MISSING** |
| — | `document.title` | **MISSING** |
| — | `document.querySelector(selector)` | **MISSING** |
| — | `document.querySelectorAll(selector)` | **MISSING** |
| — | `window.location.href` | **MISSING** |
| — | `window.location.reload()` | **MISSING** |
| — | `navigator.clipboard.writeText(text)` | **MISSING** |
| — | `navigator.clipboard.readText()` | **MISSING** |

### Tier 2 — Chrome Extension APIs
| What we have | What LLMs know | Gap |
|--------------|----------------|-----|
| `chrome.tabs.query({})` | `chrome.tabs.query({})` | ✅ Good — Promise-based, close to MV3 |
| `chrome.tabs.create({})` | `chrome.tabs.create({})` | ✅ Good |
| `chrome.tabs.update({})` | `chrome.tabs.update(tabId, {})` | ⚠️ Missing `tabId` as positional arg |
| `chrome.tabs.remove({})` | `chrome.tabs.remove(tabIds)` | ⚠️ Missing `tabIds` as positional arg |
| `chrome.tabs.get({})` | `chrome.tabs.get(tabId)` | ⚠️ Missing `tabId` as positional arg |
| `chrome.tabs.reload({})` | `chrome.tabs.reload(tabId)` | ⚠️ Missing `tabId` as positional arg |
| `chrome.tabs.sendMessage({})` | `chrome.tabs.sendMessage(tabId, message)` | ⚠️ Missing positional args |
| — | `chrome.storage.local.get(keys)` | **MISSING** — no `chrome.storage` at all |
| — | `chrome.storage.local.set(items)` | **MISSING** |
| `chrome.runtime.sendMessage({})` | `chrome.runtime.sendMessage(message)` | ⚠️ Missing positional arg |
| `chrome.cookies.get({})` | `chrome.cookies.get(details)` | ⚠️ OK but uses object-only |
| `chrome.cookies.set({})` | `chrome.cookies.set(details)` | ⚠️ OK |
| `chrome.bookmarks.search({})` | `chrome.bookmarks.search(query)` | ⚠️ Missing positional arg |
| `chrome.history.search({})` | `chrome.history.search(query)` | ⚠️ Missing positional arg |
| `chrome.notifications.create(id, options)` | `chrome.notifications.create(id, options)` | ✅ Good |
| `chrome.scripting.executeScript({})` | `chrome.scripting.executeScript(details)` | ⚠️ OK |
| `chrome.alarms.create({})` | `chrome.alarms.create(name, alarmInfo)` | ⚠️ Missing positional args |
| `chrome.windows.create({})` | `chrome.windows.create(createData)` | ⚠️ OK |
| `chrome.sidePanel.setOptions({})` | `chrome.sidePanel.setOptions(options)` | ⚠️ OK |

### Tier 3 — Node.js fs APIs
| What we have | What LLMs know | Gap |
|--------------|----------------|-----|
| `fs.read_text(path)` | `fs.readFileSync(path, 'utf8')` | **MISSING** |
| `fs.read(path)` | `fs.readFileSync(path)` | **MISSING** |
| `fs.write_text(path, text)` | `fs.writeFileSync(path, text)` | **MISSING** |
| `fs.write(path, data)` | `fs.writeFileSync(path, data)` | **MISSING** |
| `fs.append_text(path, text)` | `fs.appendFileSync(path, text)` | **MISSING** |
| `fs.exists(path)` | `fs.existsSync(path)` | **MISSING** |
| `fs.list(path)` | `fs.readdirSync(path)` | **MISSING** |
| `fs.mkdir(path)` | `fs.mkdirSync(path)` | **MISSING** |
| `fs.delete(path)` | `fs.unlinkSync(path)` / `fs.rmdirSync(path)` | **MISSING** |
| `fs.copy(from, to)` | `fs.copyFileSync(from, to)` | **MISSING** |
| `fs.move(from, to)` | `fs.renameSync(oldPath, newPath)` | **MISSING** |
| `fs.stat(path)` | `fs.statSync(path)` | **MISSING** |
| `path.join(...)` | `path.join(...)` | ✅ Good |
| `path.basename(p)` | `path.basename(p)` | ✅ Good |
| `path.dirname(p)` | `path.dirname(p)` | ✅ Good |
| `path.extname(p)` | `path.extname(p)` | ✅ Good |
| `path.normalize(p)` | `path.normalize(p)` | ✅ Good |
| `path.isAbsolute(p)` | `path.isAbsolute(p)` | ✅ Good |
| — | `path.resolve(...)` | **MISSING** |
| — | `path.relative(from, to)` | **MISSING** |

### Tier 4 — Browser Automation (page.*)
| What we have | What LLMs know | Gap |
|--------------|----------------|-----|
| `page.goto(url)` | `page.goto(url)` | ✅ Good |
| `page.click(ref_id)` | `page.click(selector)` | ⚠️ Uses ref_id instead of CSS selector |
| `page.fill(ref_id, value)` | `page.fill(selector, value)` | ⚠️ Uses ref_id instead of CSS selector |
| `page.type(ref_id, text)` | `page.type(selector, text)` | ⚠️ Uses ref_id instead of CSS selector |
| `page.press(key)` | `page.press(key)` | ✅ Good |
| `page.select(ref_id, value)` | `page.selectOption(selector, value)` | ⚠️ Uses ref_id instead of selector |
| `page.check(ref_id)` | `page.check(selector)` | ⚠️ Uses ref_id instead of selector |
| `page.hover(ref_id)` | `page.hover(selector)` | ⚠️ Uses ref_id instead of selector |
| `page.scroll(direction, amount)` | `page.scroll()` | ✅ Good |
| `page.wait(ms)` | `page.waitForTimeout(ms)` | ✅ Good |
| `page.wait_for(selector, timeout)` | `page.waitForSelector(selector, {timeout})` | ✅ Good |
| `page.find(selector)` | `page.locator(selector)` | ⚠️ Different naming |
| `page.url()` | `page.url()` | ✅ Good |
| `page.title()` | `page.title()` | ✅ Good |
| `page.back()` | `page.goBack()` | ✅ Good |
| `page.forward()` | `page.goForward()` | ✅ Good |
| `page.reload()` | `page.reload()` | ✅ Good |
| `page.screenshot()` | `page.screenshot()` | ✅ Good |
| `page.snapshot()` | — | Custom — OK |
| `page.extract(fields)` | — | Custom — OK |

## Proposed Redesign

### 1. Global Scope — Must Add

```javascript
// fetch — the most common HTTP API
fetch = web.fetch;

// setTimeout / setInterval / clearTimeout / clearInterval
// (wraps web.sleep with callback scheduling)
setTimeout = function(fn, ms) { ... };
setInterval = function(fn, ms) { ... };
clearTimeout = function(id) { ... };
clearInterval = function(id) { ... };

// URL class
URL = function(url, base) { ... };
URL.prototype = { ... };

// URLSearchParams
URLSearchParams = function(init) { ... };

// localStorage (wraps web.storage)
localStorage = {
  getItem: function(key) { return web.storage.get(key); },
  setItem: function(key, value) { return web.storage.set(key, value); },
  removeItem: function(key) { return web.storage.delete(key); },
  clear: function() { return web.storage.clear(); },
  key: function(index) { ... },
  length: ...
};

// sessionStorage (same as localStorage, separate namespace)
sessionStorage = { ...same as localStorage... };

// navigator (minimal stub)
navigator = {
  clipboard: {
    readText: function() { return web.clipboard.read(); },
    writeText: function(text) { return web.clipboard.write(text); }
  }
};

// document (minimal proxy)
document = {
  title: /* getter → page.title() */,
  URL: /* getter → page.url() */,
  querySelector: function(selector) { return page.find(selector); },
  querySelectorAll: function(selector) { return page.find(selector); }
};

// window (minimal proxy)
window = {
  location: {
    href: /* getter → page.url() */,
    reload: function() { return page.reload(); },
    assign: function(url) { return page.goto(url); },
    replace: function(url) { return page.goto(url); }
  },
  document: document,
  fetch: fetch,
  localStorage: localStorage,
  sessionStorage: sessionStorage,
  navigator: navigator
};
```

### 2. Chrome APIs — Fix Positional Args

Make all `chrome.*` APIs accept both positional and named arguments:

```javascript
chrome.tabs.query = function(queryInfo, callback) {
  // If callback provided, call it on resolution (old callback style)
  // If not, return Promise (MV3 style)
  return makeAsync('chrome_tabs_query')(queryInfo || {});
};
chrome.tabs.create = function(createProperties, callback) {
  return makeAsync('chrome_tabs_create')(createProperties || {});
};
chrome.tabs.update = function(tabId, updateProperties, callback) {
  return makeAsync('chrome_tabs_update')({tabId: tabId, ...updateProperties});
};
chrome.tabs.remove = function(tabIds, callback) {
  return makeAsync('chrome_tabs_remove')({tabIds: tabIds});
};
chrome.tabs.get = function(tabId, callback) {
  return makeAsync('chrome_tabs_get')({tabId: tabId});
};
chrome.tabs.reload = function(tabId, reloadProperties, callback) {
  return makeAsync('chrome_tabs_reload')({tabId: tabId, ...reloadProperties});
};
chrome.tabs.sendMessage = function(tabId, message, options, callback) {
  return makeAsync('chrome_tabs_sendMessage')({tabId: tabId, message, options: options || {}});
};

// NEW: chrome.storage.local
chrome.storage = {
  local: {
    get: function(keys) { return makeAsync('chrome_storage_local_get')({keys}); },
    set: function(items) { return makeAsync('chrome_storage_local_set')({items}); },
    remove: function(keys) { return makeAsync('chrome_storage_local_remove')({keys}); },
    clear: function() { return makeAsync('chrome_storage_local_clear')({}); }
  },
  sync: {
    get: function(keys) { return makeAsync('chrome_storage_sync_get')({keys}); },
    set: function(items) { return makeAsync('chrome_storage_sync_set')({items}); },
    remove: function(keys) { return makeAsync('chrome_storage_sync_remove')({keys}); },
    clear: function() { return makeAsync('chrome_storage_sync_clear')({}); }
  }
};

chrome.runtime.sendMessage = function(message, options, callback) {
  return makeAsync('chrome_runtime_sendMessage')({message, options: options || {}});
};
chrome.runtime.getManifest = function() { return {...}; };
chrome.runtime.getURL = function(path) { return chrome.runtime.getURL(path); };
chrome.runtime.id = '...';
```

### 3. Node.js fs Compatibility Layer

```javascript
fs.readFile = function(path, options, callback) {
  // if options is string (encoding), use it
  // if options is object, extract encoding
  // if callback provided, Node.js callback style
  // if no callback, return Promise (Node.js promises style)
  const encoding = typeof options === 'string' ? options : (options && options.encoding);
  if (encoding === 'utf8' || encoding === 'utf-8') {
    return fs.read_text(path);
  }
  return fs.read(path);
};
fs.readFileSync = function(path, options) {
  // Synchronous version — but we're async-only
  // We can either return a Promise or throw
  // Best: return Promise (it's the best we can do in async-only env)
  return fs.readFile(path, options);
};
fs.writeFile = function(path, data, options, callback) {
  return fs.write_text(path, data);
};
fs.writeFileSync = function(path, data, options) {
  return fs.writeFile(path, data, options);
};
fs.appendFile = function(path, data, options, callback) {
  return fs.append_text(path, data);
};
fs.existsSync = function(path) {
  return fs.exists(path);
};
fs.readdirSync = function(path, options) {
  return fs.list(path);
};
fs.mkdirSync = function(path, options) {
  return fs.mkdir(path);
};
fs.unlinkSync = function(path) {
  return fs.delete(path);
};
fs.rmdirSync = function(path) {
  return fs.delete(path);
};
fs.copyFileSync = function(src, dest) {
  return fs.copy(src, dest);
};
fs.renameSync = function(oldPath, newPath) {
  return fs.move(oldPath, newPath);
};
fs.statSync = function(path) {
  return fs.stat(path);
};

// fs.promises
fs.promises = {
  readFile: fs.readFile,
  writeFile: fs.writeFile,
  appendFile: fs.appendFile,
  mkdir: fs.mkdirSync,
  readdir: fs.readdirSync,
  unlink: fs.unlinkSync,
  rmdir: fs.rmdirSync,
  stat: fs.statSync,
  copyFile: fs.copyFileSync,
  rename: fs.renameSync
};
```

### 4. page.* — Add CSS Selector Support

The current `page.click(ref_id)` requires ref_id from a snapshot. LLMs often write `page.click('#submit')` or `page.click('button[type="submit"]')`. We should support both:

```javascript
page.click = function(selector_or_ref_id) {
  // If it's a CSS selector (contains #, ., [, or space), use find first
  // Otherwise treat as ref_id
  if (typeof selector_or_ref_id === 'string' && /[\.#\[\s]/.test(selector_or_ref_id)) {
    return page.find(selector_or_ref_id).then(results => {
      if (results && results.length > 0) {
        return makeAsync('page_click')({refId: results[0].refId});
      }
      throw new Error('No element matching: ' + selector_or_ref_id);
    });
  }
  return makeAsync('page_click')({refId: selector_or_ref_id});
};
```

### 5. Top-level Convenience Aliases

```javascript
// Already have these, keep them:
// tab.*, runtime.*, page.*, fs.*, path.*, chrome.*, dom.*, sidepanel.*

// Add:
globalThis.fetch = fetch;
globalThis.URL = URL;
globalThis.URLSearchParams = URLSearchParams;
globalThis.setTimeout = setTimeout;
globalThis.setInterval = setInterval;
globalThis.clearTimeout = clearTimeout;
globalThis.clearInterval = clearInterval;
globalThis.localStorage = localStorage;
globalThis.sessionStorage = sessionStorage;
globalThis.document = document;
globalThis.window = window;
globalThis.navigator = navigator;
```

## Implementation Priority

1. **P0 (Critical)**: `fetch`, `localStorage`, `sessionStorage`, `setTimeout`, `URL`, `console` (already works)
2. **P1 (High)**: Node.js `fs` compatibility (`readFile`, `writeFile`, `existsSync`, `readdirSync`, `mkdirSync`, `unlinkSync`, `statSync`)
3. **P2 (Medium)**: Chrome API positional args (`chrome.tabs.update(tabId, props)`, `chrome.tabs.remove(tabIds)`, etc.), `chrome.storage`
4. **P3 (Medium)**: `page.click(selector)`, `page.fill(selector, value)` — CSS selector support
5. **P4 (Low)**: `document` / `window` / `navigator` stubs, `fs.promises`, `path.resolve`, `path.relative`
