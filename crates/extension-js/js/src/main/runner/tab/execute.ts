/// <reference types="chrome" />
import type { AsyncResponse } from "../../../shared/tool-registry.js";
import { logger } from "../../../shared/logger.js";
import { throwIfAborted } from "../../../shared/tool-registry.js";
import { getActiveTabId } from "../../tab-context.js";
import { normalizeChromeError } from "../chrome/internals.js";
import { INJECTION_DELAY_MS, RETRY_DELAY_MS } from "../lib/constants.js";

// ─── Tab script execution ──────────────────────────────────────

/** Fail fast with a readable message when a tab URL cannot be scripted/snapshotted. */
export async function preflightScriptableTab(
	tabId: number,
): Promise<AsyncResponse | null> {
	throwIfAborted();
	const chrome = window.chrome;
	if (!chrome?.tabs?.get) return null;
	try {
		const tab = await chrome.tabs.get(tabId);
		const url = tab.url ?? "";
		const title = tab.title ?? "";
		const label = `tab ${tabId} "${title}" (${url || "unknown url"})`;
		if (!url.startsWith("http:") && !url.startsWith("https:")) {
			return {
				ok: false,
				error: {
					message: `Cannot snapshot ${label}. Snapshots require an http(s) page tab — use tabs.find(t => t.url?.startsWith("http")) instead of tabs[0].`,
					code: "E_PERMISSION_DENIED",
					category: "permission",
				},
			};
		}
		return null;
	} catch (err: unknown) {
		return normalizeChromeError(err);
	}
}

export async function executeInTab(
	tabId: number | null,
	func: (...args: unknown[]) => unknown,
	args: unknown[],
): Promise<AsyncResponse> {
	throwIfAborted();
	const log = logger.child("runner");
	log.debug("executeInTab_start", {
		tabId,
		scriptType: func.name || "anonymous",
	});
	const chrome = window.chrome;
	if (!chrome?.runtime?.id) {
		log.debug("executeInTab_result", {
			tabId,
			result: "error",
			reason: "no_extension",
		});
		return {
			ok: false,
			error: {
				message: "Not in extension context",
				code: "E_NO_EXTENSION",
				category: "permission",
			},
		};
	}
	const targetTab = typeof tabId === "number" ? tabId : getActiveTabId();
	if (targetTab === null) {
		log.debug("executeInTab_result", {
			tabId,
			result: "error",
			reason: "no_tab",
		});
		return {
			ok: false,
			error: {
				message: "No active tab available",
				code: "E_NO_TAB",
				category: "resource",
			},
		};
	}
	try {
		const results = await chrome.scripting.executeScript({
			target: { tabId: targetTab },
			func,
			args,
			world: "MAIN",
		});
		if (chrome.runtime.lastError) {
			const message =
				chrome.runtime.lastError.message || "Chrome scripting failed";
			log.error("executeInTab_lastError", {
				tabId: targetTab,
				error: message,
			});
			return {
				ok: false,
				error: {
					message: `Cannot execute script in tab ${targetTab}: ${message}`,
					code: "E_SCRIPTING",
					category: "extension",
				},
			};
		}
		if (!results?.[0]) {
			log.debug("executeInTab_result", {
				tabId: targetTab,
				result: "error",
				reason: "no_result",
			});
			return {
				ok: false,
				error: {
					message: `No result from script execution in tab ${targetTab}`,
					code: "E_SCRIPTING",
					category: "extension",
				},
			};
		}
		log.debug("executeInTab_result", { tabId: targetTab, result: "ok" });
		return { ok: true, value: results[0].result };
	} catch (err: unknown) {
		log.debug("executeInTab_result", {
			tabId: targetTab,
			result: "error",
			error: err instanceof Error ? err.message : String(err),
		});
		return normalizeChromeError(err);
	}
}

export async function waitForTabLoad(
	tabId: number | null,
	timeoutMs: number = 30_000,
): Promise<AsyncResponse<boolean>> {
	throwIfAborted();
	const log = logger.child("runner");
	const targetTab = typeof tabId === "number" ? tabId : null;
	log.debug("waitForTabLoad_start", { tabId: targetTab, timeout: timeoutMs });
	const chrome = window.chrome;
	if (!chrome?.runtime?.id) {
		return {
			ok: false,
			error: {
				message: "Not in extension context",
				code: "E_NO_EXTENSION",
				category: "permission",
			},
		};
	}
	if (targetTab === null) {
		return {
			ok: false,
			error: {
				message: "tab_wait_for_load requires a valid tabId",
				code: "E_MISSING_PARAM",
			},
		};
	}
	try {
		const tab = await chrome.tabs.get(targetTab);
		if (tab.status === "complete") {
			log.debug("waitForTabLoad_loaded", {
				tabId: targetTab,
				status: "already_complete",
			});
			return { ok: true, value: true };
		}
		await new Promise<void>((resolve, reject) => {
			const listener = (
				updatedTabId: number,
				changeInfo: { status?: string },
			) => {
				if (updatedTabId === targetTab && changeInfo.status === "complete") {
					chrome.tabs.onUpdated.removeListener(listener);
					resolve();
				}
			};
			chrome.tabs.onUpdated.addListener(listener);
			setTimeout(() => {
				chrome.tabs.onUpdated.removeListener(listener);
				reject(new Error("Timeout waiting for tab load"));
			}, timeoutMs);
		});
		log.debug("waitForTabLoad_loaded", {
			tabId: targetTab,
			status: "complete",
		});
		return { ok: true, value: true };
	} catch (err: unknown) {
		if (
			err instanceof Error &&
			err.message === "Timeout waiting for tab load"
		) {
			log.warn("waitForTabLoad_timeout", {
				tabId: targetTab,
				timeout: timeoutMs,
			});
		}
		return normalizeChromeError(err);
	}
}
