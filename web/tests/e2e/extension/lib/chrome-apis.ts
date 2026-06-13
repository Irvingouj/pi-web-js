import { API_CASES } from "./contract-metadata.ts";
import type { ApiCase } from "./types.ts";

/** All chrome.* namespaces covered by the extension contract (27 total). */
export const CHROME_NAMESPACES = [
	"chrome.action",
	"chrome.alarms",
	"chrome.bookmarks",
	"chrome.browsingData",
	"chrome.contextMenus",
	"chrome.cookies",
	"chrome.declarativeNetRequest",
	"chrome.desktopCapture",
	"chrome.downloads",
	"chrome.history",
	"chrome.identity",
	"chrome.idle",
	"chrome.management",
	"chrome.notifications",
	"chrome.offscreen",
	"chrome.pageCapture",
	"chrome.permissions",
	"chrome.runtime",
	"chrome.scripting",
	"chrome.sessions",
	"chrome.sidePanel",
	"chrome.storage",
	"chrome.system",
	"chrome.tabGroups",
	"chrome.tabs",
	"chrome.topSites",
	"chrome.tts",
	"chrome.windows",
] as const;

export type ChromeNamespace = (typeof CHROME_NAMESPACES)[number];

const CHROME_API_CASES = API_CASES.filter((c) => c.group === "chrome");

export function chromeApis(namespace: ChromeNamespace): ApiCase[] {
	return CHROME_API_CASES.filter((c) => c.api.startsWith(`${namespace}.`));
}

export function chromeNamespaceDestructive(
	namespace: ChromeNamespace,
): boolean {
	return chromeApis(namespace).some((c) => c.destructive);
}

/** chrome.bookmarks.search → chrome_bookmarks_search (runner action name). */
export function chromeRunnerAction(api: string): string {
	return api.replace(/\./g, "_");
}

export function namespaceNeedsFixtureTab(namespace: ChromeNamespace): boolean {
	return (
		namespace === "chrome.tabs" ||
		namespace === "chrome.scripting" ||
		namespace === "chrome.pageCapture"
	);
}

/** Namespaces whose contract cases need buildFixture(destructive: true) ids. */
export function namespaceNeedsDestructiveFixture(
	namespace: ChromeNamespace,
): boolean {
	return (
		namespace === "chrome.tabs" ||
		namespace === "chrome.windows" ||
		namespace === "chrome.sessions" ||
		namespace === "chrome.downloads"
	);
}

export const CHROME_API_COUNT = CHROME_API_CASES.length;
