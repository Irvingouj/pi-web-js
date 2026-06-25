import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, "../../../..");
const REPO_ROOT = path.resolve(WEB_ROOT, "..");

export const EXTENSION_DIST = path.resolve(WEB_ROOT, "dist");
export const CONTRACT_PATH = path.resolve(
	__dirname,
	"../contract/all-apis-extension-contract.js",
);
export const EXTENSION_MANIFEST_PATH = path.resolve(
	REPO_ROOT,
	"crates/extension-js/js/manifest.json",
);

export const FIXTURE_ORIGIN = "https://extension-js.test";
export const FIXTURE_URL = `${FIXTURE_ORIGIN}/fixture`;

export const TESTCASE_SERVER_PORT = Number(
	process.env.TESTCASE_SERVER_PORT ?? "9292",
);
export const TESTCASE_SERVER_HOST =
	process.env.TESTCASE_SERVER_HOST ?? "127.0.0.1";
export const SIMPLE_FORM_1_URL = `http://${TESTCASE_SERVER_HOST}:${TESTCASE_SERVER_PORT}/testcases/simple-form-1/`;
export const DYNAMIC_FEED_URL = `http://${TESTCASE_SERVER_HOST}:${TESTCASE_SERVER_PORT}/testcases/dynamic-feed/`;
export const LARGE_DOM_URL = `http://${TESTCASE_SERVER_HOST}:${TESTCASE_SERVER_PORT}/testcases/large-dom/`;
export const MEDIA_DOWNLOAD_URL = `http://${TESTCASE_SERVER_HOST}:${TESTCASE_SERVER_PORT}/testcases/media-download/`;
export const STALE_REF_URL = `http://${TESTCASE_SERVER_HOST}:${TESTCASE_SERVER_PORT}/testcases/stale-ref/`;
export const FILE_UPLOAD_FORM_URL = `http://${TESTCASE_SERVER_HOST}:${TESTCASE_SERVER_PORT}/testcases/file-upload-form/`;
export const SLOW_NETWORK_URL = `http://${TESTCASE_SERVER_HOST}:${TESTCASE_SERVER_PORT}/testcases/slow-network/`;
export const SNAPSHOT_QUERY_URL = `http://${TESTCASE_SERVER_HOST}:${TESTCASE_SERVER_PORT}/testcases/snapshot-query/`;
export const COMPLEX_FORM_URL = `http://${TESTCASE_SERVER_HOST}:${TESTCASE_SERVER_PORT}/testcases/complex-form/`;
export const GREENHOUSE_COMBOBOX_URL = `http://${TESTCASE_SERVER_HOST}:${TESTCASE_SERVER_PORT}/testcases/greenhouse-combobox/`;
export const GREENHOUSE_REAL_URL = `http://${TESTCASE_SERVER_HOST}:${TESTCASE_SERVER_PORT}/testcases/greenhouse-real/`;
export const IFRAME_SIMPLE_URL = `http://${TESTCASE_SERVER_HOST}:${TESTCASE_SERVER_PORT}/testcases/iframe-simple/`;
export const IFRAME_CROSS_ORIGIN_URL = `http://${TESTCASE_SERVER_HOST}:${TESTCASE_SERVER_PORT}/testcases/iframe-cross-origin/`;
export const IFRAME_OAUTH_MOCK_URL = `http://${TESTCASE_SERVER_HOST}:${TESTCASE_SERVER_PORT}/testcases/iframe-oauth-mock/`;
// Cross-origin iframe uses localhost (different origin from 127.0.0.1)
export const IFRAME_CROSS_ORIGIN_CHILD_ORIGIN = `http://localhost:${TESTCASE_SERVER_PORT}`;
export const RESULT_PREFIX = "__EXTENSION_CONTRACT_RESULT__";

export const EXT_CONTRACT_APIS = process.env.EXT_CONTRACT_APIS === "1";

export const LAUNCH_SW_TIMEOUT_MS = 30_000;
export const LAUNCH_KERNEL_TIMEOUT_MS = 30_000;
export const LAUNCH_EDITOR_TIMEOUT_MS = 15_000;
export const CELL_TIMEOUT_MS = 8_000;

export const CHROME_FIXTURE_PREFIX = "__CHROME_FIXTURE__";

/** Default on: capture sidepanel/sw/fixture console for chrome E2E diagnostics. */
export const EXT_E2E_VERBOSE = process.env.EXT_E2E_VERBOSE !== "0";

export const EXT_E2E_ATTACH_ALWAYS = process.env.EXT_E2E_ATTACH_ALWAYS === "1";

/**
 * Optional extension-js log level via ?e2e_log= URL param.
 * Default "error" avoids info/debug log storms that overflow the stack on contract cells.
 * Playwright still captures browser console via EXT_E2E_VERBOSE.
 */
const E2E_LOG_LEVELS = ["trace", "debug", "info", "warn", "error"] as const;
export const EXT_E2E_LOG_LEVEL: (typeof E2E_LOG_LEVELS)[number] =
	E2E_LOG_LEVELS.includes(
		process.env.EXT_E2E_LOG_LEVEL as (typeof E2E_LOG_LEVELS)[number],
	)
		? (process.env.EXT_E2E_LOG_LEVEL as (typeof E2E_LOG_LEVELS)[number])
		: "error";

export const EXTENSION_MANIFEST = JSON.parse(
	readFileSync(EXTENSION_MANIFEST_PATH, "utf8"),
) as { permissions?: string[] };
export const GRANTED_PERMISSIONS = new Set(
	EXTENSION_MANIFEST.permissions ?? [],
);

export const CHROME_NAMESPACE_PERMISSION: Record<string, string | null> = {
	"chrome.action": null,
	"chrome.alarms": "alarms",
	"chrome.bookmarks": "bookmarks",
	"chrome.browsingData": "browsingData",
	"chrome.contextMenus": "contextMenus",
	"chrome.cookies": "cookies",
	"chrome.declarativeNetRequest": "declarativeNetRequest",
	"chrome.desktopCapture": "desktopCapture",
	"chrome.downloads": "downloads",
	"chrome.history": "history",
	"chrome.identity": "identity",
	"chrome.idle": "idle",
	"chrome.management": "management",
	"chrome.notifications": "notifications",
	"chrome.offscreen": "offscreen",
	"chrome.pageCapture": "pageCapture",
	"chrome.permissions": null,
	"chrome.runtime": null,
	"chrome.scripting": "scripting",
	"chrome.sessions": "sessions",
	"chrome.sidePanel": "sidePanel",
	"chrome.storage": "storage",
	"chrome.system.cpu": "system.cpu",
	"chrome.system.memory": "system.memory",
	"chrome.system.storage": "system.storage",
	"chrome.tabGroups": "tabGroups",
	"chrome.tabs": "tabs",
	"chrome.topSites": "topSites",
	"chrome.tts": "tts",
	"chrome.windows": "windows",
};

export const FIXTURE_HTML = `<!DOCTYPE html>
<html>
<head><title>extension-js contract fixture</title></head>
<body>
  <h1 id="title">Fixture Page</h1>
  <button data-ref-id="e1" id="btn">Click</button>
  <input data-ref-id="e2" id="input" value="" />
  <input type="checkbox" data-ref-id="e3" id="checkbox" />
  <select data-ref-id="e4" id="select"><option value="a">A</option><option value="b">B</option></select>
  <a data-ref-id="e5" href="/next">Next</a>
  <div id="appears" data-ref-id="e6">Ready</div>
  <div id="scroll-target" data-ref-id="e7" style="margin-top:2000px">Scroll target</div>
</body>
</html>`;

/** QuickJS worker does not pump browser timers for Promise/setTimeout globals. */
export const EXTENSION_TIMER_GAP_APIS = new Set([
	"global.setTimeout",
	"global.setInterval",
	"global.clearTimeout",
	"global.clearInterval",
]);

/** DOM/storage globals unavailable in extension QuickJS; use web.* instead. */
export const EXTENSION_GLOBAL_GAP_APIS = new Set([
	"global.localStorage",
	"global.sessionStorage",
	"global.navigator.clipboard.readText",
	"global.navigator.clipboard.writeText",
]);

/** Minimal API slice that proves dist runner + contract pipeline in harness. */
export const PIPELINE_PROBE_APIS = ["path.join", "web.fetch"];
