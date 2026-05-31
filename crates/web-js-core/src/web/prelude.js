var __makeAsyncCache = {};
function makeAsync(action) {
  if (__makeAsyncCache[action]) return __makeAsyncCache[action];
  var fn = function(...args) {
    return new Promise((resolve, reject) => {
      let params;
      if (args.length === 0) params = {};
      else if (args.length === 1) params = args[0];
      else params = args;
      __webJsTriggerAsync(action, params, resolve, reject);
    });
  };
  __makeAsyncCache[action] = fn;
  return fn;
}
function makeNamespace(spec) {
  const ns = {};
  for (const key in spec) ns[key] = makeAsync(spec[key]);
  return ns;
}

// web namespace
var web = {};
web.fetch = function(url, options) {
  if (typeof url === 'string') {
    options = options || {};
    var params = {
      url: url,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || 30000
    };
    if (options.body) params.body = options.body;
    return makeAsync('fetch')(params);
  }
  return makeAsync('fetch')(url);
};
web.sleep = function(ms) { return makeAsync('sleep')({duration: ms || 1000}); };
web.mock_async = makeAsync('mock_async');
web.log = function(...args) { return __webJsLog(...args); };

// web.url
web.url = {};
web.url.parse = function(url) { return __webJsUrlParse(url); };
web.url.encode = function(params) { return __webJsUrlEncode(params); };

// web.tab
web.tab = makeNamespace({
  query: 'tab_query',
  create: 'tab_create',
  activate: 'tab_activate',
  close: 'tab_close',
  execute_script: 'tab_execute_script',
  click: 'tab_click',
  fill: 'tab_fill',
  snapshot: 'tab_snapshot',
  snapshot_text: 'tab_snapshot_text',
  snapshot_data: 'tab_snapshot_data',
  scroll_to: 'tab_scroll_to',
  evaluate: 'tab_evaluate',
  back: 'tab_back',
  wait_for_load: 'tab_wait_for_load',
  type: 'tab_type',
  press: 'tab_press',
  select: 'tab_select',
  check: 'tab_check',
  hover: 'tab_hover',
  unhover: 'tab_unhover',
  scroll: 'tab_scroll',
  dblclick: 'tab_dblclick',
  fetch: 'tab_fetch',
});

// web.storage (wrapped for positional arg ergonomics)
web.storage = {};
web.storage.get = function(key) { return makeAsync('storage_get')({key: key}); };
web.storage.set = function(key, value) { return makeAsync('storage_set')({key: key, value: value}); };
web.storage.delete = function(key) { return makeAsync('storage_delete')({key: key}); };
web.storage.list = function() { return makeAsync('storage_list')({}); };

// web.cookies (wrapped for positional arg ergonomics)
web.cookies = {};
web.cookies.get = function(name, url) { return makeAsync('cookies_get')({name: name, url: url}); };
web.cookies.set = function(details) { return makeAsync('cookies_set')(details); };
web.cookies.delete = function(name, url) { return makeAsync('cookies_delete')({name: name, url: url}); };
web.cookies.list = function(filter) { return makeAsync('cookies_list')(filter || {}); };

// web.history (wrapped for positional arg ergonomics)
web.history = {};
web.history.search = function(query) { return makeAsync('history_search')({text: query}); };
web.history.delete = function(url) { return makeAsync('history_delete')({url: url}); };

// web.bookmarks (wrapped for positional arg ergonomics)
web.bookmarks = {};
web.bookmarks.search = function(query) { return makeAsync('bookmarks_search')({query: query}); };
web.bookmarks.create = function(bookmark) { return makeAsync('bookmarks_create')(bookmark); };
web.bookmarks.delete = function(id) { return makeAsync('bookmarks_delete')({id: id}); };

// web.notifications (wrapped for positional arg ergonomics)
web.notifications = {};
web.notifications.create = function(id, options) { return makeAsync('notifications_create')({id: id || null, options: options}); };
web.notifications.clear = function(id) { return makeAsync('notifications_clear')({id: id}); };

// web.clipboard (wrapped for positional arg ergonomics)
web.clipboard = {};
web.clipboard.read = function() { return makeAsync('clipboard_read')({}); };
web.clipboard.write = function(text) { return makeAsync('clipboard_write')({text: text}); };

// fs namespace — base APIs
var fs = {};
fs.exists = function(path) { return makeAsync('fs_exists')({path: path}); };
fs.stat = function(path) { return makeAsync('fs_stat')({path: path}); };
fs.list = function(path) { return makeAsync('fs_list')({path: path}); };
fs.mkdir = function(path) { return makeAsync('fs_mkdir')({path: path}); };
fs.delete = function(path) { return makeAsync('fs_delete')({path: path}); };
fs.copy = function(from, to) { return makeAsync('fs_copy')({from: from, to: to}); };
fs.move = function(from, to) { return makeAsync('fs_move')({from: from, to: to}); };
fs.read = function(path) { return makeAsync('fs_read')({path: path}); };
fs.read_text = function(path) { return makeAsync('fs_read_text')({path: path}); };
fs.read_base64 = function(path) { return makeAsync('fs_read_base64')({path: path}); };
fs.read_range = function(path, offset, len) { return makeAsync('fs_read_range')({path: path, offset: offset, length: len}); };
fs.write = function(path, data) { return makeAsync('fs_write')({path: path, data: data}); };
fs.write_text = function(path, text) { return makeAsync('fs_write_text')({path: path, data: text}); };
fs.write_base64 = function(path, b64) { return makeAsync('fs_write_base64')({path: path, data: b64}); };
fs.append = function(path, data) { return makeAsync('fs_append')({path: path, data: data}); };
fs.append_text = function(path, text) { return makeAsync('fs_append_text')({path: path, data: text}); };
fs.append_base64 = function(path, b64) { return makeAsync('fs_append_base64')({path: path, data: b64}); };
fs.update = function(path, offset, data) { return makeAsync('fs_update')({path: path, offset: offset, data: data}); };
fs.hash = function(path, algo) { return makeAsync('fs_hash')({path: path, algorithm: algo}); };

// CamelCase aliases (matching the API contract naming convention)
fs.readText = fs.read_text;
fs.readBase64 = fs.read_base64;
fs.readRange = fs.read_range;
fs.writeText = fs.write_text;
fs.writeBase64 = fs.write_base64;
fs.appendText = fs.append_text;

// Node.js fs compatibility layer
fs.readFile = function(path, options, callback) {
  if (typeof options === 'function') { callback = options; options = undefined; }
  const encoding = typeof options === 'string' ? options : (options && options.encoding);
  const promise = (encoding === 'utf8' || encoding === 'utf-8') ? fs.read_text(path) : fs.read(path);
  if (typeof callback === 'function') {
    promise.then(data => callback(null, data), err => callback(err));
  }
  return promise;
};
fs.readFileSync = function(path, options) { throw new Error('fs.readFileSync is not supported in web-js; use await fs.readFile(path, options) instead'); };
fs.writeFile = function(path, data, options, callback) {
  if (typeof options === 'function') { callback = options; options = undefined; }
  const promise = fs.write_text(path, data);
  if (typeof callback === 'function') {
    promise.then(() => callback(null), err => callback(err));
  }
  return promise;
};
fs.writeFileSync = function(path, data, options) { throw new Error('fs.writeFileSync is not supported in web-js; use await fs.writeFile(path, data) instead'); };
fs.appendFile = function(path, data, options, callback) {
  if (typeof options === 'function') { callback = options; options = undefined; }
  const promise = fs.append_text(path, data);
  if (typeof callback === 'function') {
    promise.then(() => callback(null), err => callback(err));
  }
  return promise;
};
fs.appendFileSync = function(path, data, options) { throw new Error('fs.appendFileSync is not supported in web-js; use await fs.appendFile(path, data) instead'); };
fs.existsSync = function(path) { throw new Error('fs.existsSync is not supported in web-js; use await fs.exists(path) instead'); };
fs.readdirSync = function(path, options) { throw new Error('fs.readdirSync is not supported in web-js; use await fs.list(path) instead'); };
fs.mkdirSync = function(path, options) { throw new Error('fs.mkdirSync is not supported in web-js; use await fs.mkdir(path) instead'); };
fs.unlinkSync = function(path) { throw new Error('fs.unlinkSync is not supported in web-js; use await fs.delete(path) instead'); };
fs.rmdirSync = function(path) { throw new Error('fs.rmdirSync is not supported in web-js; use await fs.delete(path) instead'); };
fs.copyFileSync = function(src, dest) { throw new Error('fs.copyFileSync is not supported in web-js; use await fs.copy(src, dest) instead'); };
fs.renameSync = function(oldPath, newPath) { throw new Error('fs.renameSync is not supported in web-js; use await fs.move(oldPath, newPath) instead'); };
fs.statSync = function(path) { throw new Error('fs.statSync is not supported in web-js; use await fs.stat(path) instead'); };
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

// chrome namespace
var chrome = {};

// chrome.runtime
chrome.runtime = makeNamespace({
  sendMessage: 'chrome_runtime_sendMessage',
});

// chrome.tabs — with positional arg support
chrome.tabs = {};
chrome.tabs.query = function(queryInfo, callback) {
  const p = makeAsync('chrome_tabs_query')(queryInfo || {});
  if (typeof callback === 'function') p.then(r => callback(r), e => callback(e));
  return p;
};
chrome.tabs.create = function(createProperties, callback) {
  const p = makeAsync('chrome_tabs_create')(createProperties || {});
  if (typeof callback === 'function') p.then(r => callback(r), e => callback(e));
  return p;
};
chrome.tabs.update = function(tabId, updateProperties, callback) {
  if (typeof updateProperties === 'function') { callback = updateProperties; updateProperties = {}; }
  const params = Object.assign({}, updateProperties);
  if (tabId !== undefined && tabId !== null) params.tabId = tabId;
  const p = makeAsync('chrome_tabs_update')(params);
  if (typeof callback === 'function') p.then(r => callback(r), e => callback(e));
  return p;
};
chrome.tabs.remove = function(tabIds, callback) {
  const p = makeAsync('chrome_tabs_remove')({tabIds: tabIds});
  if (typeof callback === 'function') p.then(r => callback(r), e => callback(e));
  return p;
};
chrome.tabs.get = function(tabId, callback) {
  const p = makeAsync('chrome_tabs_get')({tabId: tabId});
  if (typeof callback === 'function') p.then(r => callback(r), e => callback(e));
  return p;
};
chrome.tabs.reload = function(tabId, reloadProperties, callback) {
  if (typeof reloadProperties === 'function') { callback = reloadProperties; reloadProperties = {}; }
  const params = Object.assign({}, reloadProperties);
  if (tabId !== undefined && tabId !== null) params.tabId = tabId;
  const p = makeAsync('chrome_tabs_reload')(params);
  if (typeof callback === 'function') p.then(r => callback(r), e => callback(e));
  return p;
};
chrome.tabs.sendMessage = function(tabId, message, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  const p = makeAsync('chrome_tabs_sendMessage')({tabId: tabId, message: message, options: options || {}});
  if (typeof callback === 'function') p.then(r => callback(r), e => callback(e));
  return p;
};

// chrome.alarms — with positional arg support
chrome.alarms = {};
chrome.alarms.create = function(name, alarmInfo, callback) {
  if (typeof alarmInfo === 'function') { callback = alarmInfo; alarmInfo = {}; }
  const p = makeAsync('chrome_alarms_create')({name: name || null, alarmInfo: alarmInfo || {}});
  if (typeof callback === 'function') p.then(r => callback(r), e => callback(e));
  return p;
};
chrome.alarms.clear = function(name, callback) {
  const p = makeAsync('chrome_alarms_clear')({name: name || null});
  if (typeof callback === 'function') p.then(r => callback(r), e => callback(e));
  return p;
};

// chrome.action
chrome.action = makeNamespace({
  setBadgeText: 'chrome_action_setBadgeText',
  setBadgeBackgroundColor: 'chrome_action_setBadgeBackgroundColor',
  setTitle: 'chrome_action_setTitle',
  setIcon: 'chrome_action_setIcon',
});

// chrome.contextMenus
chrome.contextMenus = makeNamespace({
  create: 'chrome_contextMenus_create',
  remove: 'chrome_contextMenus_remove',
});

// chrome.windows
chrome.windows = makeNamespace({
  getAll: 'chrome_windows_getAll',
  getCurrent: 'chrome_windows_getCurrent',
  create: 'chrome_windows_create',
  update: 'chrome_windows_update',
  remove: 'chrome_windows_remove',
});

// chrome.sessions
chrome.sessions = makeNamespace({
  getRecentlyClosed: 'chrome_sessions_getRecentlyClosed',
  getDevices: 'chrome_sessions_getDevices',
  restore: 'chrome_sessions_restore',
});

// chrome.sidePanel
chrome.sidePanel = makeNamespace({
  setOptions: 'chrome_sidePanel_setOptions',
});

// chrome.cookies
chrome.cookies = makeNamespace({
  get: 'chrome_cookies_get',
  set: 'chrome_cookies_set',
  remove: 'chrome_cookies_remove',
  getAll: 'chrome_cookies_getAll',
});

// chrome.bookmarks
chrome.bookmarks = makeNamespace({
  search: 'chrome_bookmarks_search',
  create: 'chrome_bookmarks_create',
  remove: 'chrome_bookmarks_remove',
});

// chrome.history
chrome.history = makeNamespace({
  search: 'chrome_history_search',
  deleteUrl: 'chrome_history_deleteUrl',
});

// chrome.notifications
chrome.notifications = makeNamespace({
  create: 'chrome_notifications_create',
  clear: 'chrome_notifications_clear',
});

// chrome.scripting
chrome.scripting = makeNamespace({
  executeScript: 'chrome_scripting_executeScript',
});

// chrome.storage.local / chrome.storage.sync
chrome.storage = {};
chrome.storage.local = {
  get: function(keys) {
    if (typeof keys === 'object' && keys !== null && !Array.isArray(keys)) {
      return makeAsync('storage_get_many')({keys: Object.keys(keys), defaults: keys});
    }
    if (typeof keys === 'string') {
      return makeAsync('storage_get_many')({keys: [keys]});
    }
    if (Array.isArray(keys)) {
      return makeAsync('storage_get_many')({keys: keys});
    }
    return makeAsync('storage_get_all')({});
  },
  set: function(items) {
    if (typeof items === 'object' && items !== null) {
      return makeAsync('storage_set_many')({items: items});
    }
    return Promise.resolve(null);
  },
  remove: function(keys) {
    if (typeof keys === 'string') {
      return makeAsync('storage_delete_many')({keys: [keys]});
    } else if (Array.isArray(keys)) {
      return makeAsync('storage_delete_many')({keys: keys});
    }
    return Promise.resolve(null);
  },
  clear: function() {
    return makeAsync('storage_clear')({});
  }
};
chrome.storage.sync = Object.assign({}, chrome.storage.local);

// dom namespace
var dom = {};
dom.snapshot = makeAsync('dom_snapshot');
dom.format = makeAsync('dom_format');

// page namespace — with CSS selector support
var page = {};
page.snapshot = makeAsync('page_snapshot_text');
page.snapshot_data = makeAsync('page_snapshot_data');
page.snapshot_text = makeAsync('page_snapshot_text');
function _isSelector(s) {
  return typeof s === 'string' && /[\.\#\[\s]/.test(s);
}
function _resolveRef(selectorOrRef, actionFn) {
  if (_isSelector(selectorOrRef)) {
    return page.find(selectorOrRef).then(results => {
      if (results && results.length > 0) return actionFn(results[0].refId);
      throw new Error('No element matching: ' + selectorOrRef);
    });
  }
  return actionFn(selectorOrRef);
}
page.click = function(ref_id) {
  if (_isSelector(ref_id)) {
    return page.find(ref_id).then(results => {
      if (results && results.length > 0) return makeAsync('page_click')({refId: results[0].refId, label: results[0].refId});
      throw new Error('No element matching: ' + ref_id);
    });
  }
  return makeAsync('page_click')({refId: ref_id, label: ref_id});
};
page.dblclick = function(ref_id) {
  return _resolveRef(ref_id, r => makeAsync('page_dblclick')({refId: r}));
};
page.fill = function(ref_id, value) {
  if (_isSelector(ref_id)) {
    return page.find(ref_id).then(results => {
      if (results && results.length > 0) return makeAsync('page_fill')({refId: results[0].refId, label: results[0].refId, value: value});
      throw new Error('No element matching: ' + ref_id);
    });
  }
  return makeAsync('page_fill')({refId: ref_id, label: ref_id, value: value});
};
page.type = function(ref_id, text) {
  if (_isSelector(ref_id)) {
    return page.find(ref_id).then(results => {
      if (results && results.length > 0) return makeAsync('page_type')({refId: results[0].refId, label: results[0].refId, text: text});
      throw new Error('No element matching: ' + ref_id);
    });
  }
  return makeAsync('page_type')({refId: ref_id, label: ref_id, text: text});
};
page.press = function(key) { return makeAsync('page_press')({key: key}); };
page.select = function(ref_id, value) {
  return _resolveRef(ref_id, r => makeAsync('page_select')({refId: r, value: value}));
};
page.check = function(ref_id, checked) {
  return _resolveRef(ref_id, r => makeAsync('page_check')({refId: r, checked: checked !== undefined ? checked : true}));
};
page.hover = function(ref_id) {
  return _resolveRef(ref_id, r => makeAsync('page_hover')({refId: r}));
};
page.unhover = function() { return makeAsync('page_unhover')({}); };
page.scroll = function(direction, amount) { return makeAsync('page_scroll')({direction: direction !== undefined ? direction : 'down', amount: amount !== undefined ? amount : 300}); };
page.scroll_to = function(ref_id) {
  return _resolveRef(ref_id, r => makeAsync('page_scroll_to')({refId: r}));
};
page.url = function() { return makeAsync('page_url')({}); };
page.title = function() { return makeAsync('page_title')({}); };
page.screenshot = function() { return makeAsync('page_screenshot')({}); };
page.goto = function(url) { return makeAsync('page_goto')({url: url}); };
page.back = function() { return makeAsync('page_back')({}); };
page.forward = function() { return makeAsync('page_forward')({}); };
page.reload = function() { return makeAsync('page_reload')({}); };
page.wait = function(ms) { return makeAsync('page_wait')({ms: ms !== undefined ? ms : 1000}); };
page.tabs = function() { return makeAsync('page_tabs')({}); };
page.switch = function(tab_id) { return makeAsync('page_switch')({tabId: tab_id}); };
page.new_tab = function(url) { return makeAsync('page_new_tab')({url: url}); };
page.close = function(tab_id) { return makeAsync('page_close')({tabId: tab_id}); };
page.active_tab = function() { return makeAsync('page_active_tab')({}); };
page.find = function(selector) { return makeAsync('page_find')({selector: selector}); };
page.wait_for = function(selector, timeout) { return makeAsync('page_wait_for')({selector: selector, timeout: timeout !== undefined ? timeout : 30000}); };
page.extract = function(fields) { return makeAsync('page_extract')({fields: fields}); };
page.append = function(ref_id, text) {
  return _resolveRef(ref_id, r => makeAsync('page_append')({refId: r, text: text}));
};

// path namespace (pure JS path utilities)
var path = {};
path.join = function(...parts) {
  const segments = [];
  for (const part of parts) {
    for (const seg of String(part).split('/')) {
      if (seg !== '') segments.push(seg);
    }
  }
  return '/' + segments.join('/');
};
path.basename = function(p) {
  const parts = String(p).split('/');
  return parts[parts.length - 1] || '';
};
path.dirname = function(p) {
  const s = String(p);
  const idx = s.lastIndexOf('/');
  if (idx <= 0) return '/';
  return s.slice(0, idx);
};
path.extname = function(p) {
  const base = path.basename(p);
  const idx = base.lastIndexOf('.');
  return idx > 0 ? base.slice(idx) : '';
};
path.normalize = function(p) {
  const parts = String(p).split('/');
  const segments = [];
  for (const part of parts) {
    if (part === '..') { segments.pop(); }
    else if (part !== '' && part !== '.') { segments.push(part); }
  }
  let result = '/' + segments.join('/');
  if (p.endsWith('/') && segments.length > 0) result += '/';
  return result;
};
path.isAbsolute = function(p) {
  return String(p).startsWith('/');
};
path.sep = '/';
path.resolve = function(...parts) {
  let resolved = '';
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = String(parts[i]);
    if (path.isAbsolute(p)) {
      resolved = p + (resolved ? '/' + resolved : '');
      break;
    } else {
      resolved = p + (resolved ? '/' + resolved : '');
    }
  }
  return path.normalize(resolved || '/');
};
path.relative = function(from, to) {
  const fromParts = path.normalize(from).split('/').filter(Boolean);
  const toParts = path.normalize(to).split('/').filter(Boolean);
  let i = 0;
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++;
  const up = fromParts.length - i;
  const down = toParts.slice(i);
  return Array(up).fill('..').concat(down).join('/');
};

// sidepanel namespace
var sidepanel = {};
sidepanel.snapshot = makeAsync('sidepanel_snapshot_text');
sidepanel.snapshot_data = makeAsync('sidepanel_snapshot_data');
sidepanel.click = function(ref_id) { return makeAsync('sidepanel_click')({refId: ref_id}); };
sidepanel.dblclick = function(ref_id) { return makeAsync('sidepanel_dblclick')({refId: ref_id}); };
sidepanel.fill = function(ref_id, value) { return makeAsync('sidepanel_fill')({refId: ref_id, value: value}); };
sidepanel.type = function(ref_id, text) { return makeAsync('sidepanel_type')({refId: ref_id, text: text}); };
sidepanel.press = function(key) { return makeAsync('sidepanel_press')({key: key}); };
sidepanel.select = function(ref_id, value) { return makeAsync('sidepanel_select')({refId: ref_id, value: value}); };
sidepanel.check = function(ref_id, checked) { return makeAsync('sidepanel_check')({refId: ref_id, checked: checked !== undefined ? checked : true}); };
sidepanel.hover = function(ref_id) { return makeAsync('sidepanel_hover')({refId: ref_id}); };
sidepanel.unhover = function() { return makeAsync('sidepanel_unhover')({}); };
sidepanel.scroll = function(direction, amount) { return makeAsync('sidepanel_scroll')({direction: direction !== undefined ? direction : 'down', amount: amount !== undefined ? amount : 300}); };
sidepanel.scroll_to = function(ref_id) { return makeAsync('sidepanel_scroll_to')({refId: ref_id}); };
sidepanel.url = function() { return makeAsync('sidepanel_url')({}); };
sidepanel.title = function() { return makeAsync('sidepanel_title')({}); };
sidepanel.wait = function(ms) { return makeAsync('sidepanel_wait')({ms: ms !== undefined ? ms : 1000}); };
sidepanel.append = function(ref_id, text) { return makeAsync('sidepanel_append')({refId: ref_id, text: text}); };

// host namespace
var host = {};
host.call = function(action, params) { return makeAsync('host_call')({action: action, params: params !== undefined ? params : {}}); };

// runtime namespace
var runtime = {};
runtime.inspect = function() { return __webJsRuntimeInspect(); };

// Top-level aliases (JS prelude matching web-lua's prelude.lua)
// tab.* high-level aliases
var __tab = {};
for (const key in web.tab) __tab[key] = web.tab[key];
__tab.current = function() {
  return chrome.tabs.query({active: true, currentWindow: true}).then(function(tabs) {
    return tabs && tabs[0] ? tabs[0].id : null;
  });
};
__tab.open = function(url) {
  return chrome.tabs.create({url: url || ''}).then(function(t) {
    return t && t.id;
  });
};
__tab.focus = function(tabId) {
  return __tab.current().then(function(currentId) {
    var id = tabId || currentId;
    if (id) return chrome.tabs.update(id, {active: true}).then(function() { return id; });
    return id;
  });
};
__tab.url = function(tabId) {
  return __tab.current().then(function(currentId) {
    var id = tabId || currentId;
    if (!id) return null;
    return chrome.tabs.get(id).then(function(t) {
      return t && t.url;
    });
  });
};
__tab.title = function(tabId) {
  return __tab.current().then(function(currentId) {
    var id = tabId || currentId;
    if (!id) return null;
    return chrome.tabs.get(id).then(function(t) {
      return t && t.title;
    });
  });
};
__tab.reload = function(tabId) {
  return __tab.current().then(function(currentId) {
    var id = tabId || currentId;
    if (id) return chrome.tabs.reload(id).then(function() { return id; });
    return id;
  });
};
__tab.sleep = web.sleep;

// runtime.* aliases
var runtime_fetch = web.fetch;
var runtime_sleep = web.sleep;
var runtime_storage = web.storage;
var runtime_clipboard = web.clipboard;
var runtime_notifications = web.notifications;

// page.* convenience aliases
page.go = page.goto;
page.open = page.new_tab;
page.enter = function() { return page.press('Enter'); };
page.wait_for_load = function(timeout) {
  return makeAsync('chrome_tabs_query')({active: true, currentWindow: true}).then(function(tabs) {
    var id = tabs && tabs[0] ? tabs[0].id : null;
    return makeAsync('tab_wait_for_load')([id, timeout]);
  });
};
page.fetch = function(url) {
  return makeAsync('chrome_tabs_query')({active: true, currentWindow: true}).then(function(tabs) {
    var id = tabs && tabs[0] ? tabs[0].id : null;
    return makeAsync('tab_fetch')([id, url]);
  });
};

// Global Web APIs — LLM-optimized
// Global fetch
var fetch = web.fetch;

// setTimeout / setInterval / clearTimeout / clearInterval
var __timeoutId = 0;
var __timeoutCancelled = {};
var __intervalCancelled = {};
function setTimeout(fn, ms) {
  const id = ++__timeoutId;
  web.sleep(ms || 0).then(() => {
    if (!__timeoutCancelled[id]) {
      try { fn(); } catch(e) {}
    }
    delete __timeoutCancelled[id];
  });
  return id;
}
function setInterval(fn, ms) {
  const id = ++__timeoutId;
  function tick() {
    if (__intervalCancelled[id]) return;
    try { fn(); } catch(e) {}
    web.sleep(ms || 0).then(tick);
  }
  tick();
  return id;
}
function clearTimeout(id) {
  __timeoutCancelled[id] = true;
}
function clearInterval(id) {
  __intervalCancelled[id] = true;
}

// URL class
function URL(url, base) {
  const parsed = __webJsUrlParse(url);
  this.href = url;
  this.protocol = parsed.scheme + ':';
  this.host = parsed.host + (parsed.port ? ':' + parsed.port : '');
  this.hostname = parsed.host || '';
  this.port = parsed.port ? String(parsed.port) : '';
  this.pathname = parsed.path || '/';
  this.search = parsed.query_string ? '?' + parsed.query_string : '';
  this.hash = parsed.fragment ? '#' + parsed.fragment : '';
  this.searchParams = new URLSearchParams(parsed.query_string || '');
}
URL.prototype.toString = function() { return this.href; };
URL.prototype.toJSON = function() { return this.href; };

// URLSearchParams
function URLSearchParams(init) {
  this._params = [];
  if (typeof init === 'string') {
    const pairs = init.split('&');
    for (const p of pairs) {
      const [k, v] = p.split('=');
      if (k) this._params.push([decodeURIComponent(k), decodeURIComponent(v || '')]);
    }
  } else if (init && typeof init === 'object') {
    for (const key in init) {
      this._params.push([key, String(init[key])]);
    }
  }
}
URLSearchParams.prototype.append = function(name, value) { this._params.push([name, value]); };
URLSearchParams.prototype.delete = function(name) { this._params = this._params.filter(p => p[0] !== name); };
URLSearchParams.prototype.get = function(name) { const p = this._params.find(p => p[0] === name); return p ? p[1] : null; };
URLSearchParams.prototype.getAll = function(name) { return this._params.filter(p => p[0] === name).map(p => p[1]); };
URLSearchParams.prototype.has = function(name) { return this._params.some(p => p[0] === name); };
URLSearchParams.prototype.set = function(name, value) { this.delete(name); this.append(name, value); };
URLSearchParams.prototype.toString = function() { return this._params.map(p => encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1])).join('&'); };

// localStorage / sessionStorage — Proxy-backed so Object.keys() and property access work
var localStorage = new Proxy({
  getItem: function(key) { return __webJsLocalStorageGet(key); },
  setItem: function(key, value) { return __webJsLocalStorageSet(key, value); },
  removeItem: function(key) { return __webJsLocalStorageRemove(key); },
  clear: function() { return __webJsLocalStorageClear(); },
  key: function(index) { return __webJsLocalStorageKey(index); },
  get length() { return __webJsLocalStorageLength(); }
}, {
  get: function(target, prop) {
    if (prop in target) return target[prop];
    if (typeof prop === 'symbol') return undefined;
    var val = __webJsLocalStorageGet(prop);
    return val === null ? undefined : val;
  },
  set: function(target, prop, value) {
    if (typeof prop === 'symbol') return false;
    __webJsLocalStorageSet(prop, value);
    return true;
  },
  ownKeys: function(target) {
    var keys = [];
    var len = __webJsLocalStorageLength();
    for (var i = 0; i < len; i++) {
      var k = __webJsLocalStorageKey(i);
      if (k !== null) keys.push(k);
    }
    return keys;
  },
  getOwnPropertyDescriptor: function(target, prop) {
    if (typeof prop === 'symbol') return undefined;
    var val = __webJsLocalStorageGet(prop);
    if (val !== null) {
      return { value: val, writable: true, enumerable: true, configurable: true };
    }
    return undefined;
  },
  has: function(target, prop) {
    if (typeof prop === 'symbol') return false;
    return __webJsLocalStorageGet(prop) !== null;
  },
  deleteProperty: function(target, prop) {
    if (typeof prop === 'symbol') return false;
    __webJsLocalStorageRemove(prop);
    return true;
  }
});
var sessionStorage = localStorage;

// navigator
var navigator = {
  clipboard: {
    readText: function() { return web.clipboard.read(); },
    writeText: function(text) { return web.clipboard.write(text); }
  }
};

// document
var document = {
  querySelector: function(selector) { return __webJsQuerySelector(selector); },
  querySelectorAll: function(selector) { return __webJsQuerySelectorAll(selector); },
  get title() { return __webJsDocumentTitle(); },
  get URL() { return __webJsWindowLocationHref(); }
};

// window
var window = {
  location: {
    get href() { return __webJsWindowLocationHref(); },
    reload: function() { return page.reload(); },
    assign: function(url) { return page.goto(url); },
    replace: function(url) { return page.goto(url); }
  },
  document: document,
  fetch: fetch,
  localStorage: localStorage,
  sessionStorage: sessionStorage,
  navigator: navigator,
  setTimeout: setTimeout,
  setInterval: setInterval,
  clearTimeout: clearTimeout,
  clearInterval: clearInterval
};
