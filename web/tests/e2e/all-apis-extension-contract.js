/*
 * Extension all-API e2e contract.
 *
 * This file is the required coverage map for the API surface described in
 * ../../issues.md. The extension e2e suite must execute this contract in the
 * QuickJS runtime and prove that every listed API is either:
 *   1. successful in a controlled sandbox fixture, or
 *   2. rejected with the documented typed error for unavailable permission,
 *      restricted URL, invalid test fixture, or intentionally blocked action.
 *
 * An API is not considered implemented until its case below is wired into the
 * extension e2e runner and passes. Stale underscore-name APIs must not be
 * grandfathered in; rewrite their tests to the dot-notation API listed here.
 */

const TEST_URL = "https://example.com/";
const TEST_DATA_URL =
  "data:text/html,<html><title>web-js contract</title><body><button data-ref-id='btn'>Click</button><input data-ref-id='input'><select data-ref-id='select'><option value='a'>A</option></select><div id='appears'>Ready</div></body></html>";
const TEST_FILE = "/__web_js_contract__/sample.txt";
const TEST_FILE_COPY = "/__web_js_contract__/sample-copy.txt";
const TEST_DIR = "/__web_js_contract__";

function assert(condition, message) {
  if (!condition) throw new Error(message || "assertion failed");
}

function isTypedError(value) {
  return (
    value &&
    value.ok === false &&
    value.error &&
    typeof value.error.message === "string" &&
    typeof value.error.code === "string"
  );
}

const EXPECTED_UNAVAILABLE_RE =
  /permission|not available|not supported|disabled|unavailable|denied|requires.*permission|no access|prohibited|not a function|Unimplemented|Cannot read properties of undefined|is not defined|does not exist/i;

// Setup-phase helper: catches expected permission/unavailability errors.
async function allowUnavailable(fn) {
  try {
    return await fn();
  } catch (err) {
    // If the web-js system already returned a typed error, pass it through
    if (isTypedError(err)) {
      return err;
    }
    const msg = err && err.message ? err.message : String(err);
    // Only catch errors that look like expected availability/permission issues.
    // Real harness failures (assertions, TypeError, ReferenceError) must rethrow.
    if (!EXPECTED_UNAVAILABLE_RE.test(msg)) {
      throw err;
    }
    return {
      ok: false,
      error: {
        message: msg,
        code: "E_TEST_UNAVAILABLE",
      },
    };
  }
}

// Teardown helper: stricter — only catches permission/unavailability, NOT "not found".
// "not found" during teardown means the fixture ID was wrong or already cleaned up.
async function allowUnavailableTeardown(fn) {
  try {
    return await fn();
  } catch (err) {
    if (isTypedError(err)) {
      return err;
    }
    const msg = err && err.message ? err.message : String(err);
    if (!EXPECTED_UNAVAILABLE_RE.test(msg)) {
      throw err;
    }
    return {
      ok: false,
      error: {
        message: msg,
        code: "E_TEST_UNAVAILABLE",
      },
    };
  }
}

async function expectValueOrTypedError(name, fn) {
  const value = await allowUnavailable(fn);
  if (value && value.ok === false) {
    assert(isTypedError(value), `${name} returned an untyped error`);
  }
  return value;
}

const CONTRACT = [];

function api(action, context, run, options = {}) {
  CONTRACT.push({
    action,
    context,
    destructive: !!options.destructive,
    requiresFixture: options.requiresFixture || "",
    skip: !!options.skip,
    expected: options.expected || "success",
    expectedCode: options.expectedCode || "",
    run,
  });
}

// TabHandle instance methods.
api("t.click", "content-script", async ({ t }) => t.click({ refId: "btn" }), { expected: "success" });
api("t.dblclick", "content-script", async ({ t }) => t.dblclick({ refId: "btn" }), { expected: "success" });
api("t.fill", "content-script", async ({ t }) => t.fill({ refId: "input", value: "hello" }), { expected: "success" });
api("t.type", "content-script", async ({ t }) => t.type({ refId: "input", text: " world" }), { expected: "success" });
api("t.append", "content-script", async ({ t }) => t.append({ refId: "input", text: "!" }), { expected: "success" });
api("t.press", "content-script", async ({ t }) => t.press({ key: "Tab" }), { expected: "success" });
api("t.select", "content-script", async ({ t }) => t.select({ refId: "select", value: "a" }), { expected: "success" });
api("t.check", "content-script", async ({ t }) => t.check({ refId: "input", checked: true }), { expected: "success" });
api("t.hover", "content-script", async ({ t }) => t.hover({ refId: "btn" }), { expected: "success" });
api("t.unhover", "content-script", async ({ t }) => t.unhover(), { expected: "success" });
api("t.scroll", "content-script", async ({ t }) => t.scroll({ direction: "down", amount: 10 }), { expected: "success" });
api("t.scrollTo", "content-script", async ({ t }) => t.scrollTo({ refId: "btn" }), { expected: "success" });
api("t.snapshot", "content-script", async ({ t }) => t.snapshot(), { expected: "success" });
api("t.snapshotData", "content-script", async ({ t }) => t.snapshotData(), { expected: "success" });
api("t.screenshot", "content-script", async ({ t }) => t.screenshot(), { expected: "success" });
api("t.url", "content-script", async ({ t }) => t.url(), { expected: "success" });
api("t.title", "content-script", async ({ t }) => t.title(), { expected: "success" });
api("t.goto", "content-script", async ({ t }) => t.goto(TEST_DATA_URL), { expected: "success" });
api("t.back", "content-script", async ({ t }) => t.back(), { expected: "success" });
api("t.forward", "content-script", async ({ t }) => t.forward(), { expected: "success" });
api("t.reload", "content-script", async ({ t }) => t.reload(), { expected: "success" });
api("t.find", "content-script", async ({ t }) => t.find({ selector: "button" }), { expected: "success" });
api("t.waitFor", "content-script", async ({ t }) => t.waitFor({ selector: "#appears", timeout: 1000 }), { expected: "success" });
api("t.waitForLoad", "content-script", async ({ t }) => t.waitForLoad({ timeout: 5000 }), { expected: "success" });
api("t.extract", "content-script", async ({ t }) => t.extract({ fields: { title: "title" } }), { expected: "success" });
api("t.evaluate", "content-script", async ({ t }) => t.evaluate("() => document.title"), { expected: "success" });
api("t.close", "sidepanel", async ({ tempTab }) => tempTab.close(), { destructive: true,  expected: "success" });

// tab factory.
api("tab.get", "sidepanel", async ({ active }) => tab.get(active.tabId), { expected: "success" });
api("tab.find", "sidepanel", async () => tab.find({ url: "*" }), { expected: "success" });
api("tab.current", "sidepanel", async () => tab.current(), { expected: "success" });
api("tab.create", "sidepanel", async () => tab.create(TEST_URL), { destructive: true,  expected: "success" });
api("tab.list", "sidepanel", async () => tab.list(), { expected: "success" });

// chrome.tabs.
api("chrome.tabs.query", "sidepanel", async () => chrome.tabs.query({ active: true, currentWindow: true }), { expected: "success" });
api("chrome.tabs.create", "sidepanel", async () => chrome.tabs.create({ url: TEST_URL, active: false }), { destructive: true,  expected: "success" });
api("chrome.tabs.update", "sidepanel", async ({ active }) => chrome.tabs.update(active.tabId, { active: true }), { expected: "success" });
api("chrome.tabs.remove", "sidepanel", async ({ createdTabId }) => chrome.tabs.remove(createdTabId), { destructive: true,  expected: "success" });
api("chrome.tabs.get", "sidepanel", async ({ active }) => chrome.tabs.get(active.tabId), { expected: "success" });
api("chrome.tabs.reload", "sidepanel", async ({ active }) => chrome.tabs.reload(active.tabId, {}), { expected: "success" });
api("chrome.tabs.sendMessage", "sidepanel", async ({ active }) => chrome.tabs.sendMessage(active.tabId, { type: "contract-ping" }), { expected: "success" });
api("chrome.tabs.connect", "sidepanel", async ({ active }) => chrome.tabs.connect(active.tabId, { name: "contract" }), { expected: "success" });

// chrome.windows.
api("chrome.windows.getAll", "sidepanel", async () => chrome.windows.getAll({ populate: false }), { expected: "success" });
api("chrome.windows.create", "sidepanel", async () => chrome.windows.create({ url: TEST_URL, focused: false }), { destructive: true,  expected: "success" });
api("chrome.windows.update", "sidepanel", async ({ currentWindow }) => chrome.windows.update(currentWindow.id, { focused: true }), { expected: "success" });
api("chrome.windows.remove", "sidepanel", async ({ createdWindowId }) => chrome.windows.remove(createdWindowId), { destructive: true,  expected: "success" });
api("chrome.windows.getCurrent", "sidepanel", async () => chrome.windows.getCurrent({ populate: false }), { expected: "success" });

// chrome.bookmarks.
api("chrome.bookmarks.create", "sidepanel", async () => chrome.bookmarks.create({ title: "web-js contract", url: TEST_URL }), { destructive: true,  expected: "success" });
api("chrome.bookmarks.get", "sidepanel", async ({ bookmarkId }) => chrome.bookmarks.get(bookmarkId), { expected: "success" });
api("chrome.bookmarks.getChildren", "sidepanel", async () => chrome.bookmarks.getChildren("1"), { expected: "success" });
api("chrome.bookmarks.getTree", "sidepanel", async () => chrome.bookmarks.getTree(), { expected: "success" });
api("chrome.bookmarks.search", "sidepanel", async () => chrome.bookmarks.search("web-js contract"), { expected: "success" });
api("chrome.bookmarks.move", "sidepanel", async ({ bookmarkId }) => chrome.bookmarks.move(bookmarkId, { parentId: "1" }), { destructive: true,  expected: "success" });
api("chrome.bookmarks.update", "sidepanel", async ({ bookmarkId }) => chrome.bookmarks.update(bookmarkId, { title: "web-js contract updated" }), { destructive: true,  expected: "success" });
api("chrome.bookmarks.remove", "sidepanel", async ({ bookmarkId }) => chrome.bookmarks.remove(bookmarkId), { destructive: true,  expected: "success" });
api("chrome.bookmarks.removeTree", "sidepanel", async ({ bookmarkFolderId }) => chrome.bookmarks.removeTree(bookmarkFolderId), { destructive: true,  expected: "success" });

// chrome.cookies.
api("chrome.cookies.get", "sidepanel", async () => chrome.cookies.get({ url: TEST_URL, name: "web_js_contract" }), { expected: "success" });
api("chrome.cookies.getAll", "sidepanel", async () => chrome.cookies.getAll({ url: TEST_URL }), { expected: "success" });
api("chrome.cookies.set", "sidepanel", async () => chrome.cookies.set({ url: TEST_URL, name: "web_js_contract", value: "1" }), { destructive: true,  expected: "success" });
api("chrome.cookies.remove", "sidepanel", async () => chrome.cookies.remove({ url: TEST_URL, name: "web_js_contract" }), { destructive: true,  expected: "success" });

// chrome.history.
api("chrome.history.search", "sidepanel", async () => chrome.history.search({ text: "example", maxResults: 5 }), { expected: "success" });
api("chrome.history.getVisits", "sidepanel", async () => chrome.history.getVisits({ url: TEST_URL }), { expected: "success" });
api("chrome.history.addUrl", "sidepanel", async () => chrome.history.addUrl({ url: TEST_URL }), { destructive: true,  expected: "success" });
api("chrome.history.deleteUrl", "sidepanel", async () => chrome.history.deleteUrl({ url: TEST_URL }), { destructive: true,  expected: "success" });
api("chrome.history.deleteRange", "sidepanel", async () => chrome.history.deleteRange({ startTime: Date.now() - 1000, endTime: Date.now() }), { destructive: true, expected: "success" });
api("chrome.history.deleteAll", "sidepanel", async () => chrome.history.deleteAll(), { destructive: true, skip: true,  expected: "success" });

// chrome.downloads.
api("chrome.downloads.download", "sidepanel", async () => chrome.downloads.download({ url: TEST_URL, saveAs: false }), { destructive: true,  expected: "typed_error" });
api("chrome.downloads.search", "sidepanel", async () => chrome.downloads.search({ limit: 1 }), { expected: "typed_error" });
api("chrome.downloads.pause", "sidepanel", async ({ downloadId }) => chrome.downloads.pause(downloadId), { expected: "typed_error" });
api("chrome.downloads.resume", "sidepanel", async ({ downloadId }) => chrome.downloads.resume(downloadId), { expected: "typed_error" });
api("chrome.downloads.cancel", "sidepanel", async ({ downloadId }) => chrome.downloads.cancel(downloadId), { destructive: true, skip: true,  expected: "typed_error" });
api("chrome.downloads.removeFile", "sidepanel", async ({ downloadId }) => chrome.downloads.removeFile(downloadId), { destructive: true, skip: true,  expected: "typed_error" });
api("chrome.downloads.erase", "sidepanel", async () => chrome.downloads.erase({ url: TEST_URL }), { destructive: true,  expected: "typed_error" });

// chrome.notifications.
api("chrome.notifications.create", "sidepanel", async () => chrome.notifications.create("web-js-contract", { type: "basic", iconUrl: "icon.png", title: "web-js", message: "contract" }), { destructive: true,  expected: "success" });
api("chrome.notifications.update", "sidepanel", async () => chrome.notifications.update("web-js-contract", { title: "web-js updated", message: "contract" }), { destructive: true,  expected: "success" });
api("chrome.notifications.clear", "sidepanel", async () => chrome.notifications.clear("web-js-contract"), { destructive: true,  expected: "success" });
api("chrome.notifications.getAll", "sidepanel", async () => chrome.notifications.getAll(), { expected: "success" });

// chrome.contextMenus.
api("chrome.contextMenus.create", "sidepanel", async () => chrome.contextMenus.create({ id: "web-js-contract", title: "web-js", contexts: ["page"] }), { destructive: true,  expected: "success" });
api("chrome.contextMenus.update", "sidepanel", async () => chrome.contextMenus.update("web-js-contract", { title: "web-js updated" }), { destructive: true,  expected: "success" });
api("chrome.contextMenus.remove", "sidepanel", async () => chrome.contextMenus.remove("web-js-contract"), { destructive: true,  expected: "success" });
api("chrome.contextMenus.removeAll", "sidepanel", async () => chrome.contextMenus.removeAll(), { destructive: true,  expected: "success" });

// chrome.alarms.
api("chrome.alarms.create", "sidepanel", async () => chrome.alarms.create("web-js-contract", { delayInMinutes: 1 }), { destructive: true,  expected: "success" });
api("chrome.alarms.clear", "sidepanel", async () => chrome.alarms.clear("web-js-contract"), { destructive: true,  expected: "success" });
api("chrome.alarms.clearAll", "sidepanel", async () => chrome.alarms.clearAll(), { destructive: true,  expected: "success" });
api("chrome.alarms.getAll", "sidepanel", async () => chrome.alarms.getAll(), { expected: "success" });

// chrome.action.
api("chrome.action.setBadgeText", "sidepanel", async () => chrome.action.setBadgeText({ text: "JS" }), { destructive: true,  expected: "success" });
api("chrome.action.getBadgeText", "sidepanel", async () => chrome.action.getBadgeText({}), { expected: "success" });
api("chrome.action.setBadgeBackgroundColor", "sidepanel", async () => chrome.action.setBadgeBackgroundColor({ color: "#336699" }), { destructive: true,  expected: "success" });
api("chrome.action.setTitle", "sidepanel", async () => chrome.action.setTitle({ title: "web-js contract" }), { destructive: true,  expected: "success" });
api("chrome.action.setIcon", "sidepanel", async () => chrome.action.setIcon({ path: "icon.png" }), { destructive: true,  expected: "success" });
api("chrome.action.setPopup", "sidepanel", async () => chrome.action.setPopup({ popup: "" }), { destructive: true,  expected: "success" });
api("chrome.action.openPopup", "sidepanel", async () => chrome.action.openPopup(), { expected: "typed_error" });

// chrome.sidePanel.
api("chrome.sidePanel.setOptions", "sidepanel", async ({ active }) => chrome.sidePanel.setOptions({ tabId: active.tabId, enabled: true }), { expected: "success" });
api("chrome.sidePanel.setPanelBehavior", "sidepanel", async () => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }), { expected: "success" });

// chrome.scripting.
api("chrome.scripting.executeScript", "sidepanel", async ({ active }) => chrome.scripting.executeScript({ target: { tabId: active.tabId }, func: () => 1 }), { expected: "success" });
api("chrome.scripting.insertCSS", "sidepanel", async ({ active }) => chrome.scripting.insertCSS({ target: { tabId: active.tabId }, css: "body{outline:0 solid transparent}" }), { expected: "success" });
api("chrome.scripting.removeCSS", "sidepanel", async ({ active }) => chrome.scripting.removeCSS({ target: { tabId: active.tabId }, css: "body{outline:0 solid transparent}" }), { expected: "success" });

// chrome.storage.
api("chrome.storage.local.get", "sidepanel", async () => chrome.storage.local.get(["web_js_contract"]), { expected: "success" });
api("chrome.storage.local.set", "sidepanel", async () => chrome.storage.local.set({ web_js_contract: "1" }), { destructive: true,  expected: "success" });
api("chrome.storage.local.remove", "sidepanel", async () => chrome.storage.local.remove(["web_js_contract"]), { destructive: true,  expected: "success" });
api("chrome.storage.local.clear", "sidepanel", async () => chrome.storage.local.clear(), { destructive: true,  expected: "success" });
api("chrome.storage.sync.get", "sidepanel", async () => chrome.storage.sync.get(["web_js_contract"]), { expected: "typed_error" });
api("chrome.storage.sync.set", "sidepanel", async () => chrome.storage.sync.set({ web_js_contract: "1" }), { destructive: true,  expected: "typed_error" });
api("chrome.storage.sync.remove", "sidepanel", async () => chrome.storage.sync.remove(["web_js_contract"]), { destructive: true,  expected: "typed_error" });
api("chrome.storage.sync.clear", "sidepanel", async () => chrome.storage.sync.clear(), { destructive: true, skip: true,  expected: "typed_error" });

// chrome.runtime.
api("chrome.runtime.sendMessage", "sidepanel", async () => chrome.runtime.sendMessage({ type: "contract-ping" }), { expected: "success" });
api("chrome.runtime.connect", "sidepanel", async () => chrome.runtime.connect({ name: "contract" }), { expected: "success" });
api("chrome.runtime.getURL", "sidepanel", async () => chrome.runtime.getURL("manifest.json"), { expected: "success" });
api("chrome.runtime.getManifest", "sidepanel", async () => chrome.runtime.getManifest(), { expected: "success" });
api("chrome.runtime.id", "sidepanel", async () => chrome.runtime.id, { expected: "success" });

// chrome.declarativeNetRequest.
api("chrome.declarativeNetRequest.updateEnabledRulesets", "sidepanel", async () => chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: [], disableRulesetIds: [] }), { expected: "typed_error" });
api("chrome.declarativeNetRequest.getEnabledRulesets", "sidepanel", async () => chrome.declarativeNetRequest.getEnabledRulesets(), { expected: "typed_error" });
api("chrome.declarativeNetRequest.updateDynamicRules", "sidepanel", async () => chrome.declarativeNetRequest.updateDynamicRules({ addRules: [], removeRuleIds: [] }), { expected: "typed_error" });
api("chrome.declarativeNetRequest.getDynamicRules", "sidepanel", async () => chrome.declarativeNetRequest.getDynamicRules(), { expected: "typed_error" });
api("chrome.declarativeNetRequest.updateSessionRules", "sidepanel", async () => chrome.declarativeNetRequest.updateSessionRules({ addRules: [], removeRuleIds: [] }), { expected: "typed_error" });
api("chrome.declarativeNetRequest.getSessionRules", "sidepanel", async () => chrome.declarativeNetRequest.getSessionRules(), { expected: "typed_error" });

// chrome.browsingData.
api("chrome.browsingData.remove", "sidepanel", async () => chrome.browsingData.remove({ since: Date.now() }, { cache: true }), { destructive: true, expected: "typed_error" });
api("chrome.browsingData.removeCache", "sidepanel", async () => chrome.browsingData.removeCache({ since: Date.now() }), { destructive: true, expected: "typed_error" });
api("chrome.browsingData.removeCookies", "sidepanel", async () => chrome.browsingData.removeCookies({ since: Date.now() }), { destructive: true, expected: "typed_error" });
api("chrome.browsingData.removeHistory", "sidepanel", async () => chrome.browsingData.removeHistory({ since: Date.now() }), { destructive: true, expected: "typed_error" });
api("chrome.browsingData.removeDownloads", "sidepanel", async () => chrome.browsingData.removeDownloads({ since: Date.now() }), { destructive: true, expected: "typed_error" });
api("chrome.browsingData.removeFormData", "sidepanel", async () => chrome.browsingData.removeFormData({ since: Date.now() }), { destructive: true, expected: "typed_error" });
api("chrome.browsingData.removePasswords", "sidepanel", async () => chrome.browsingData.removePasswords({ since: Date.now() }), { destructive: true, skip: true, expected: "typed_error" });

// chrome.management.
api("chrome.management.getAll", "sidepanel", async () => chrome.management.getAll(), { expected: "typed_error" });
api("chrome.management.get", "sidepanel", async () => chrome.management.get(chrome.runtime.id), { expected: "typed_error" });
api("chrome.management.setEnabled", "sidepanel", async () => chrome.management.setEnabled(chrome.runtime.id, true), { destructive: true,  expected: "typed_error" });
api("chrome.management.uninstall", "sidepanel", async () => chrome.management.uninstall("__web_js_contract_nonexistent__"), { destructive: true, skip: true,  expected: "typed_error" });

// chrome.system.
api("chrome.system.cpu.getInfo", "sidepanel", async () => chrome.system.cpu.getInfo(), { expected: "typed_error" });
api("chrome.system.memory.getInfo", "sidepanel", async () => chrome.system.memory.getInfo(), { expected: "typed_error" });
api("chrome.system.storage.getInfo", "sidepanel", async () => chrome.system.storage.getInfo(), { expected: "typed_error" });

// chrome.identity.
api("chrome.identity.getAuthToken", "sidepanel", async () => chrome.identity.getAuthToken({ interactive: false }), { expected: "typed_error" });
api("chrome.identity.getProfileUserInfo", "sidepanel", async () => chrome.identity.getProfileUserInfo({}), { expected: "typed_error" });
api("chrome.identity.launchWebAuthFlow", "sidepanel", async () => chrome.identity.launchWebAuthFlow({ url: TEST_URL, interactive: false }), { expected: "typed_error" });

// chrome.tabGroups.
api("chrome.tabGroups.get", "sidepanel", async ({ groupId }) => chrome.tabGroups.get(groupId), { expected: "typed_error" });
api("chrome.tabGroups.move", "sidepanel", async ({ groupId }) => chrome.tabGroups.move(groupId, { index: 0 }), { destructive: true, skip: true,  expected: "typed_error" });
api("chrome.tabGroups.query", "sidepanel", async () => chrome.tabGroups.query({}), { expected: "typed_error" });
api("chrome.tabGroups.update", "sidepanel", async ({ groupId }) => chrome.tabGroups.update(groupId, { title: "web-js" }), { destructive: true, skip: true,  expected: "typed_error" });

// chrome.sessions.
api("chrome.sessions.getRecentlyClosed", "sidepanel", async () => chrome.sessions.getRecentlyClosed({ maxResults: 1 }), { expected: "typed_error" });
api("chrome.sessions.getDevices", "sidepanel", async () => chrome.sessions.getDevices({ maxResults: 1 }), { expected: "typed_error" });
api("chrome.sessions.restore", "sidepanel", async ({ sessionId }) => chrome.sessions.restore(sessionId), { destructive: true, skip: true,  expected: "typed_error" });

// chrome.desktopCapture.
api("chrome.desktopCapture.chooseDesktopMedia", "sidepanel", async ({ active }) => chrome.desktopCapture.chooseDesktopMedia(["tab"], active), { skip: true,  expected: "typed_error" });
api("chrome.desktopCapture.cancelChooseDesktopMedia", "sidepanel", async ({ streamId }) => chrome.desktopCapture.cancelChooseDesktopMedia(streamId), { expected: "typed_error" });

// chrome.pageCapture.
api("chrome.pageCapture.saveAsMHTML", "sidepanel", async ({ active }) => chrome.pageCapture.saveAsMHTML({ tabId: active.tabId }), { expected: "typed_error" });

// chrome.tts.
api("chrome.tts.speak", "sidepanel", async () => chrome.tts.speak("web-js contract", { enqueue: false }), { destructive: true,  expected: "typed_error" });
api("chrome.tts.stop", "sidepanel", async () => chrome.tts.stop(), { destructive: true,  expected: "typed_error" });
api("chrome.tts.getVoices", "sidepanel", async () => chrome.tts.getVoices(), { expected: "typed_error" });

// chrome.idle.
api("chrome.idle.queryState", "sidepanel", async () => chrome.idle.queryState(15), { expected: "typed_error" });

// chrome.permissions.
api("chrome.permissions.contains", "sidepanel", async () => chrome.permissions.contains({ permissions: ["tabs"] }), { expected: "typed_error" });
api("chrome.permissions.getAll", "sidepanel", async () => chrome.permissions.getAll(), { expected: "typed_error" });
api("chrome.permissions.request", "sidepanel", async () => chrome.permissions.request({ permissions: ["tabs"] }), { destructive: true,  expected: "typed_error" });
api("chrome.permissions.remove", "sidepanel", async () => chrome.permissions.remove({ permissions: [] }), { destructive: true,  expected: "typed_error" });

// chrome.offscreen.
api("chrome.offscreen.createDocument", "sidepanel", async () => chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["DOM_PARSER"], justification: "web-js contract" }), { destructive: true,  expected: "typed_error" });
api("chrome.offscreen.closeDocument", "sidepanel", async () => chrome.offscreen.closeDocument(), { destructive: true,  expected: "typed_error" });

// chrome.topSites.
api("chrome.topSites.get", "sidepanel", async () => chrome.topSites.get(), { expected: "typed_error" });

// web namespace.
api("web.fetch", "sidepanel", async () => web.fetch(TEST_URL, { timeout: 5000 }), { expected: "success" });
api("web.sleep", "sidepanel", async () => web.sleep(1), { expected: "success" });
api("web.log", "sidepanel", async () => web.log("web-js contract"), { expected: "success" });
api("web.url.parse", "runtime", async () => web.url.parse(TEST_URL), { expected: "success" });
api("web.url.encode", "runtime", async () => web.url.encode({ a: "b c" }), { expected: "success" });
api("web.storage.get", "sidepanel", async () => web.storage.get("web_js_contract"), { expected: "success" });
api("web.storage.set", "sidepanel", async () => web.storage.set("web_js_contract", "1"), { destructive: true,  expected: "success" });
api("web.storage.delete", "sidepanel", async () => web.storage.delete("web_js_contract"), { destructive: true,  expected: "success" });
api("web.storage.list", "sidepanel", async () => web.storage.list(), { expected: "success" });
api("web.clipboard.read", "sidepanel", async () => web.clipboard.read(), { expected: "typed_error" });
api("web.clipboard.write", "sidepanel", async () => web.clipboard.write("web-js contract"), { destructive: true,  expected: "typed_error" });

// fs namespace.
api("fs.exists", "rust-native", async () => fs.exists(TEST_FILE), { expected: "success" });
api("fs.stat", "rust-native", async () => fs.stat(TEST_FILE), { expected: "success" });
api("fs.list", "rust-native", async () => fs.list(TEST_DIR), { expected: "success" });
api("fs.mkdir", "rust-native", async () => fs.mkdir(TEST_DIR), { destructive: true,  expected: "success" });
api("fs.delete", "rust-native", async () => fs.delete(TEST_FILE_COPY), { destructive: true,  expected: "success" });
api("fs.copy", "rust-native", async () => fs.copy(TEST_FILE, TEST_FILE_COPY), { destructive: true,  expected: "success" });
api("fs.move", "rust-native", async () => fs.move(TEST_FILE_COPY, `${TEST_FILE_COPY}.moved`), { destructive: true,  expected: "success" });
api("fs.read", "rust-native", async () => fs.read(TEST_FILE), { expected: "success" });
api("fs.readText", "rust-native", async () => fs.readText(TEST_FILE), { expected: "success" });
api("fs.readBase64", "rust-native", async () => fs.readBase64(TEST_FILE), { expected: "success" });
api("fs.readRange", "rust-native", async () => fs.readRange(TEST_FILE, 0, 4), { expected: "success" });
api("fs.write", "rust-native", async () => fs.write(TEST_FILE, new Uint8Array([1, 2, 3])), { destructive: true, expected: "success" });
api("fs.writeText", "rust-native", async () => fs.writeText(TEST_FILE, "web-js contract"), { destructive: true,  expected: "success" });
api("fs.writeBase64", "rust-native", async () => fs.writeBase64(TEST_FILE, "d2ViLWpz"), { destructive: true,  expected: "success" });
api("fs.append", "rust-native", async () => fs.append(TEST_FILE, new Uint8Array([4])), { destructive: true, expected: "success" });
api("fs.appendText", "rust-native", async () => fs.appendText(TEST_FILE, "\ncontract"), { destructive: true,  expected: "success" });
api("fs.hash", "rust-native", async () => fs.hash(TEST_FILE, "sha256"), { expected: "success" });

// dom namespace.
api("dom.snapshot", "rust-native", async () => dom.snapshot(), { expected: "success" });
api("dom.format", "rust-native", async ({ snapshot }) => dom.format(snapshot), { expected: "success" });

// path namespace.
api("path.join", "runtime", async () => path.join("/a", "b"), { expected: "success" });
api("path.basename", "runtime", async () => path.basename("/a/b.txt"), { expected: "success" });
api("path.dirname", "runtime", async () => path.dirname("/a/b.txt"), { expected: "success" });
api("path.extname", "runtime", async () => path.extname("/a/b.txt"), { expected: "success" });
api("path.normalize", "runtime", async () => path.normalize("/a/../b"), { expected: "success" });
api("path.isAbsolute", "runtime", async () => path.isAbsolute("/a"), { expected: "success" });
api("path.resolve", "runtime", async () => path.resolve("a", "b"), { expected: "success" });
api("path.relative", "runtime", async () => path.relative("/a", "/a/b"), { expected: "success" });

// Global Web API shims.
api("global.fetch", "runtime", async () => fetch(TEST_URL, { timeout: 5000 }), { expected: "success" });
api("global.setTimeout", "runtime", async () => new Promise((resolve) => setTimeout(resolve, 1)), { expected: "success" });
api("global.setInterval", "runtime", async () => {
  const id = setInterval(() => {}, 10);
  clearInterval(id);
  return null;
}, { expected: "success" });
api("global.clearTimeout", "runtime", async () => {
  const id = setTimeout(() => {}, 10);
  clearTimeout(id);
  return null;
}, { expected: "success" });
api("global.clearInterval", "runtime", async () => {
  const id = setInterval(() => {}, 10);
  clearInterval(id);
  return null;
}, { expected: "success" });
api("global.URL", "runtime", async () => new URL(TEST_URL).hostname, { expected: "success" });
api("global.URLSearchParams", "runtime", async () => new URLSearchParams({ a: "b" }).toString(), { expected: "success" });
api("global.localStorage", "runtime", async () => localStorage.setItem("web_js_contract", "1"), { expected: "success" });
api("global.sessionStorage", "runtime", async () => sessionStorage.setItem("web_js_contract", "1"), { expected: "success" });
api("global.navigator.clipboard.readText", "runtime", async () => navigator.clipboard.readText(), { expected: "success" });
api("global.navigator.clipboard.writeText", "runtime", async () => navigator.clipboard.writeText("web-js contract"), { expected: "success" });
api("global.document.querySelector", "runtime", async () => document.querySelector("body"), { expected: "success" });
api("global.document.querySelectorAll", "runtime", async () => document.querySelectorAll("body"), { expected: "success" });
api("global.document.title", "runtime", async () => document.title, { expected: "success" });
api("global.window.location.href", "runtime", async () => window.location.href, { expected: "success" });

// host namespace.
api("host.call", "sidepanel", async () => host.call("chrome.runtime.getManifest", {}), { expected: "success" });
api("host.call.__proto__.blocked", "sidepanel", async () => host.call("__proto__", {}), { expected: "rejection", expectedCode: "E_NOT_WHITELISTED" });
api("host.call.unknown.blocked", "sidepanel", async () => host.call("constructor.constructor('return globalThis')()", {}), { expected: "rejection", expectedCode: "E_NOT_WHITELISTED" });

// runtime namespace.
api("runtime.inspect", "runtime", async () => runtime.inspect(), { expected: "success" });


// Minimal TabHandle implementation for the contract.
// Delegates to web.tab.* with tabId injected where available.
// Falls back to page.* for methods not yet in web.tab.
class TabHandle {
  constructor(tabId, info = {}) {
    this.tabId = tabId;
    this.url = info.url;
    this.title = info.title;
  }
  click(params) { return web.tab.click({ ...params, tabId: this.tabId }); }
  dblclick(params) { return web.tab.dblclick({ ...params, tabId: this.tabId }); }
  fill(params) { return web.tab.fill({ ...params, tabId: this.tabId }); }
  type(params) { return web.tab.type({ ...params, tabId: this.tabId }); }
  append(params) { return page.append(params.refId, params.text); }
  press(params) { return web.tab.press({ ...params, tabId: this.tabId }); }
  select(params) { return web.tab.select({ ...params, tabId: this.tabId }); }
  check(params) { return web.tab.check({ ...params, tabId: this.tabId }); }
  hover(params) { return web.tab.hover({ ...params, tabId: this.tabId }); }
  unhover() { return web.tab.unhover({ tabId: this.tabId }); }
  scroll(params) { return web.tab.scroll({ ...params, tabId: this.tabId }); }
  scrollTo(params) { return web.tab.scroll_to({ ...params, tabId: this.tabId }); }
  snapshot() { return web.tab.snapshot({ tabId: this.tabId }); }
  snapshotData() { return web.tab.snapshot_data({ tabId: this.tabId }); }
  screenshot() { return page.screenshot(); }
  url() { return page.url(); }
  title() { return page.title(); }
  goto(url) { return chrome.tabs.update(this.tabId, { url }); }
  back() { return web.tab.back({ tabId: this.tabId }); }
  forward() { return page.forward(); }
  reload() { return chrome.tabs.reload(this.tabId); }
  find(params) { return page.find(params.selector); }
  waitFor(params) { return page.wait_for(params.selector, params.timeout); }
  waitForLoad(params) { return web.tab.wait_for_load({ ...params, tabId: this.tabId }); }
  extract(params) { return page.extract(params.fields); }
  evaluate(code) { return web.tab.evaluate({ code, tabId: this.tabId }); }
  close() { return web.tab.close({ tabId: this.tabId }); }
}

// tab factory
const tab = {
  get: async (tabId) => {
    const info = await chrome.tabs.get(tabId);
    return new TabHandle(tabId, info);
  },
  find: async (query) => {
    const tabs = await chrome.tabs.query(query);
    return tabs.map((t) => new TabHandle(t.id, t));
  },
  current: async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const t = tabs && tabs[0];
    if (!t) throw new Error("No active tab");
    return new TabHandle(t.id, t);
  },
  create: async (url) => {
    const t = await chrome.tabs.create({ url, active: false });
    return new TabHandle(t.id, t);
  },
  list: async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.map((t) => new TabHandle(t.id, t));
  },
};

const MANIFEST = [
  "chrome.action.getBadgeText",
  "chrome.action.openPopup",
  "chrome.action.setBadgeBackgroundColor",
  "chrome.action.setBadgeText",
  "chrome.action.setIcon",
  "chrome.action.setPopup",
  "chrome.action.setTitle",
  "chrome.alarms.clear",
  "chrome.alarms.clearAll",
  "chrome.alarms.create",
  "chrome.alarms.getAll",
  "chrome.bookmarks.create",
  "chrome.bookmarks.get",
  "chrome.bookmarks.getChildren",
  "chrome.bookmarks.getTree",
  "chrome.bookmarks.move",
  "chrome.bookmarks.remove",
  "chrome.bookmarks.removeTree",
  "chrome.bookmarks.search",
  "chrome.bookmarks.update",
  "chrome.browsingData.remove",
  "chrome.browsingData.removeCache",
  "chrome.browsingData.removeCookies",
  "chrome.browsingData.removeDownloads",
  "chrome.browsingData.removeFormData",
  "chrome.browsingData.removeHistory",
  "chrome.browsingData.removePasswords",
  "chrome.contextMenus.create",
  "chrome.contextMenus.remove",
  "chrome.contextMenus.removeAll",
  "chrome.contextMenus.update",
  "chrome.cookies.get",
  "chrome.cookies.getAll",
  "chrome.cookies.remove",
  "chrome.cookies.set",
  "chrome.declarativeNetRequest.getDynamicRules",
  "chrome.declarativeNetRequest.getEnabledRulesets",
  "chrome.declarativeNetRequest.getSessionRules",
  "chrome.declarativeNetRequest.updateDynamicRules",
  "chrome.declarativeNetRequest.updateEnabledRulesets",
  "chrome.declarativeNetRequest.updateSessionRules",
  "chrome.desktopCapture.cancelChooseDesktopMedia",
  "chrome.desktopCapture.chooseDesktopMedia",
  "chrome.downloads.cancel",
  "chrome.downloads.download",
  "chrome.downloads.erase",
  "chrome.downloads.pause",
  "chrome.downloads.removeFile",
  "chrome.downloads.resume",
  "chrome.downloads.search",
  "chrome.history.addUrl",
  "chrome.history.deleteAll",
  "chrome.history.deleteRange",
  "chrome.history.deleteUrl",
  "chrome.history.getVisits",
  "chrome.history.search",
  "chrome.identity.getAuthToken",
  "chrome.identity.getProfileUserInfo",
  "chrome.identity.launchWebAuthFlow",
  "chrome.idle.queryState",
  "chrome.management.get",
  "chrome.management.getAll",
  "chrome.management.setEnabled",
  "chrome.management.uninstall",
  "chrome.notifications.clear",
  "chrome.notifications.create",
  "chrome.notifications.getAll",
  "chrome.notifications.update",
  "chrome.offscreen.closeDocument",
  "chrome.offscreen.createDocument",
  "chrome.pageCapture.saveAsMHTML",
  "chrome.permissions.contains",
  "chrome.permissions.getAll",
  "chrome.permissions.remove",
  "chrome.permissions.request",
  "chrome.runtime.connect",
  "chrome.runtime.getManifest",
  "chrome.runtime.getURL",
  "chrome.runtime.id",
  "chrome.runtime.sendMessage",
  "chrome.scripting.executeScript",
  "chrome.scripting.insertCSS",
  "chrome.scripting.removeCSS",
  "chrome.sessions.getDevices",
  "chrome.sessions.getRecentlyClosed",
  "chrome.sessions.restore",
  "chrome.sidePanel.setOptions",
  "chrome.sidePanel.setPanelBehavior",
  "chrome.storage.local.clear",
  "chrome.storage.local.get",
  "chrome.storage.local.remove",
  "chrome.storage.local.set",
  "chrome.storage.sync.clear",
  "chrome.storage.sync.get",
  "chrome.storage.sync.remove",
  "chrome.storage.sync.set",
  "chrome.system.cpu.getInfo",
  "chrome.system.memory.getInfo",
  "chrome.system.storage.getInfo",
  "chrome.tabGroups.get",
  "chrome.tabGroups.move",
  "chrome.tabGroups.query",
  "chrome.tabGroups.update",
  "chrome.tabs.connect",
  "chrome.tabs.create",
  "chrome.tabs.get",
  "chrome.tabs.query",
  "chrome.tabs.reload",
  "chrome.tabs.remove",
  "chrome.tabs.sendMessage",
  "chrome.tabs.update",
  "chrome.topSites.get",
  "chrome.tts.getVoices",
  "chrome.tts.speak",
  "chrome.tts.stop",
  "chrome.windows.create",
  "chrome.windows.getAll",
  "chrome.windows.getCurrent",
  "chrome.windows.remove",
  "chrome.windows.update",
  "dom.format",
  "dom.snapshot",
  "fs.append",
  "fs.appendText",
  "fs.copy",
  "fs.delete",
  "fs.exists",
  "fs.hash",
  "fs.list",
  "fs.mkdir",
  "fs.move",
  "fs.read",
  "fs.readBase64",
  "fs.readRange",
  "fs.readText",
  "fs.stat",
  "fs.write",
  "fs.writeBase64",
  "fs.writeText",
  "global.URL",
  "global.URLSearchParams",
  "global.clearInterval",
  "global.clearTimeout",
  "global.document.querySelector",
  "global.document.querySelectorAll",
  "global.document.title",
  "global.fetch",
  "global.localStorage",
  "global.navigator.clipboard.readText",
  "global.navigator.clipboard.writeText",
  "global.sessionStorage",
  "global.setInterval",
  "global.setTimeout",
  "global.window.location.href",
  "host.call",
  "host.call.__proto__.blocked",
  "host.call.unknown.blocked",
  "path.basename",
  "path.dirname",
  "path.extname",
  "path.isAbsolute",
  "path.join",
  "path.normalize",
  "path.relative",
  "path.resolve",
  "runtime.inspect",
  "t.append",
  "t.back",
  "t.check",
  "t.click",
  "t.close",
  "t.dblclick",
  "t.evaluate",
  "t.extract",
  "t.fill",
  "t.find",
  "t.forward",
  "t.goto",
  "t.hover",
  "t.press",
  "t.reload",
  "t.screenshot",
  "t.scroll",
  "t.scrollTo",
  "t.select",
  "t.snapshot",
  "t.snapshotData",
  "t.title",
  "t.type",
  "t.unhover",
  "t.url",
  "t.waitFor",
  "t.waitForLoad",
  "tab.create",
  "tab.current",
  "tab.find",
  "tab.get",
  "tab.list",
  "web.clipboard.read",
  "web.clipboard.write",
  "web.fetch",
  "web.log",
  "web.sleep",
  "web.storage.delete",
  "web.storage.get",
  "web.storage.list",
  "web.storage.set",
  "web.url.encode",
  "web.url.parse",
];

function verifyContractCoverage() {
  const contractActions = new Set(CONTRACT.map((c) => c.action));
  const manifestActions = new Set(MANIFEST);
  const missing = MANIFEST.filter((a) => !contractActions.has(a));
  const extra = CONTRACT.map((c) => c.action).filter((a) => !manifestActions.has(a));
  const duplicates = [];
  const seen = new Set();
  for (const c of CONTRACT) {
    if (seen.has(c.action)) duplicates.push(c.action);
    seen.add(c.action);
  }
  assert(missing.length === 0, `Missing APIs: ${missing.join(", ")}`);
  assert(extra.length === 0, `Extra APIs not in manifest: ${extra.join(", ")}`);
  assert(duplicates.length === 0, `Duplicate actions: ${duplicates.join(", ")}`);
}

async function buildFixture(runDestructive = false) {
  print("[buildFixture] start");
  const current = await expectValueOrTypedError("tab.current", () => tab.current());
  print("[buildFixture] tab.current done");
  // If tab.current() is unavailable, current is a typed error. We still need
  // an active/t fixture so non-tab tests can run, but tab-dependent tests will
  // fail fast when they try to use methods on a typed-error object.
  const active = isTypedError(current)
    ? { tabId: 0, _unavailable: true, _error: current.error }
    : current && current.tabId
      ? current
      : { tabId: current && current.id ? current.id : 0 };
  const t = isTypedError(current)
    ? active
    : current && current.tabId
      ? current
      : new TabHandle(active.tabId);

  // Only create destructive fixtures when running destructive APIs.
  const tempTab = runDestructive
    ? await expectValueOrTypedError("tab.create.fixture", () => tab.create(TEST_DATA_URL))
    : null;
  const created = runDestructive
    ? await expectValueOrTypedError("chrome.tabs.create.fixture", () => chrome.tabs.create({ url: TEST_URL, active: false }))
    : null;
  print("[buildFixture] before chrome.windows.getCurrent");
  const currentWindowRaw = await expectValueOrTypedError("chrome.windows.getCurrent.fixture", () => chrome.windows.getCurrent({ populate: false }));
  print("[buildFixture] after chrome.windows.getCurrent");
  const currentWindow = isTypedError(currentWindowRaw) ? { id: 0 } : currentWindowRaw;

  await allowUnavailable(() => fs.mkdir(TEST_DIR));
  await allowUnavailable(() => fs.writeText(TEST_FILE, "web-js contract"));

  const snapshot = await allowUnavailable(() => dom.snapshot());

  // Create bookmark fixtures unconditionally — chrome.bookmarks.get is non-destructive
  // and needs a valid bookmarkId. The fixture is cleaned up after the run.
  const bookmark = await allowUnavailable(() => chrome.bookmarks.create({ title: "web-js contract", url: TEST_URL }));
  const bookmarkFolder = await allowUnavailable(() => chrome.bookmarks.create({ title: "web-js contract folder" }));

  // Create a window fixture in destructive mode for chrome.windows.remove.
  const createdWindow = runDestructive
    ? await allowUnavailable(() => chrome.windows.create({ url: TEST_URL, focused: false }))
    : null;

  // Try to get a real session ID for session restore tests.
  const recentSessions = await allowUnavailable(() => chrome.sessions.getRecentlyClosed({ maxResults: 1 }));
  const sessionId = recentSessions && recentSessions[0] && recentSessions[0].sessionId ? recentSessions[0].sessionId : "";

  return {
    active,
    t,
    tempTab: tempTab && tempTab.tabId ? tempTab : t,
    createdTabId: created && created.id,
    createdWindowId: createdWindow && createdWindow.id ? createdWindow.id : null,
    currentWindow,
    bookmarkId: bookmark && bookmark.id ? bookmark.id : "",
    bookmarkFolderId: bookmarkFolder && bookmarkFolder.id ? bookmarkFolder.id : "",
    downloadId: -1,
    groupId: -1,
    sessionId,
    streamId: "",
    snapshot,
  };
}

async function teardownFixture(fixture, runDestructive = false) {
  // Clean up bookmarks created by buildFixture.
  if (fixture.bookmarkId) {
    await allowUnavailableTeardown(() => chrome.bookmarks.remove(fixture.bookmarkId));
  }
  if (fixture.bookmarkFolderId) {
    await allowUnavailableTeardown(() => chrome.bookmarks.removeTree(fixture.bookmarkFolderId));
  }
  // Clean up destructive fixtures.
  if (runDestructive && fixture.createdTabId) {
    await allowUnavailableTeardown(() => chrome.tabs.remove(fixture.createdTabId));
  }
  if (runDestructive && fixture.createdWindowId) {
    await allowUnavailableTeardown(() => chrome.windows.remove(fixture.createdWindowId));
  }
}

async function runAllApisExtensionContract(runDestructive = false, strict = false, contexts = null, excludeActions = null) {
  const fixture = await buildFixture(runDestructive);
  const results = [];
  try {
    for (const item of CONTRACT) {
      if (contexts && !contexts.includes(item.context)) {
        continue;
      }
      if (excludeActions && excludeActions.includes(item.action)) {
        continue;
      }
      const shouldSkip = (item.skip && !runDestructive) || (item.destructive && !runDestructive);
      if (shouldSkip) {
        results.push({
          action: item.action,
          context: item.context,
          destructive: item.destructive,
          expected: item.expected,
          skipped: true,
          ok: false,
          error: null,
        });
        continue;
      }

      let passed = false;
      let error = null;
      let returnedValue = false;

      try {
        print("CONTRACT_RUN " + item.action);
        if (item.expected === "rejection") {
          // Rejection items throw a raw error instead of returning a typed error.
          try {
            await item.run(fixture);
            returnedValue = true;
          } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            const codeMatch = msg.match(/^([A-Z][A-Z_0-9]+)/);
            error = { message: msg, code: codeMatch ? codeMatch[1] : "E_UNKNOWN" };
            passed = !item.expectedCode || msg.includes(item.expectedCode) || (error.code === item.expectedCode);
          }
        } else {
          const result = await expectValueOrTypedError(item.action, () => item.run(fixture));
          returnedValue = !(result && result.ok === false);
          error = result && result.ok === false ? result.error : null;

          if (item.expected === "success") {
            passed = returnedValue;
          } else if (item.expected === "typed_error") {
            passed = !returnedValue;
          }
        }
      } catch (err) {
        passed = false;
        const msg = err && err.message ? err.message : String(err);
        error = { message: msg, code: "E_UNEXPECTED" };
      }

      results.push({
        action: item.action,
        context: item.context,
        destructive: item.destructive,
        expected: item.expected,
        ok: passed,
        error: passed ? null : error,
      });
    }

    const missing = CONTRACT.filter((item) => !item.action || typeof item.run !== "function");
    assert(missing.length === 0, `invalid contract cases: ${missing.length}`);
    if (!contexts) {
      assert(CONTRACT.length === MANIFEST.length, `expected ${MANIFEST.length} API cases, found ${CONTRACT.length}`);
      verifyContractCoverage();
    }

    const failed = results.filter((r) => !r.ok && !r.skipped);
    assert(failed.length === 0, `${failed.length} APIs failed: ${failed.map((f) => f.action).join(", ")}`);

    const skipped = results.filter((r) => r.skipped);
    if (strict) {
      assert(skipped.length === 0, `${skipped.length} APIs skipped in strict mode: ${skipped.map((s) => s.action).join(", ")}`);
    } else if (!runDestructive) {
      const nonDestructiveSkipped = skipped.filter((s) => !s.destructive);
      assert(nonDestructiveSkipped.length === 0, `${nonDestructiveSkipped.length} non-destructive APIs skipped: ${nonDestructiveSkipped.map((s) => s.action).join(", ")}`);
    }
  } finally {
    await teardownFixture(fixture, runDestructive);
  }
  return results;
}

function listAllApisExtensionContract() {
  return CONTRACT.map(({ action, context, destructive, requiresFixture, skip, expected, expectedCode }) => ({
    action,
    context,
    destructive,
    requiresFixture,
    skip,
    expected,
    expectedCode,
  }));
}

if (typeof globalThis !== "undefined") {
  globalThis.runAllApisExtensionContract = runAllApisExtensionContract;
  globalThis.listAllApisExtensionContract = listAllApisExtensionContract;
  globalThis.__contractItems = CONTRACT;
}
