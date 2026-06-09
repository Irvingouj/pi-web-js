/// <reference types="chrome" />
import type { AsyncResponse } from "../../../shared/tool-registry.js";
import { logger } from "../../../shared/logger.js";
import { throwIfAborted } from "../../../shared/tool-registry.js";
import { getActiveTabId } from "../../tab-context.js";
import { normalizeChromeError } from "../chrome/internals.js";
import { contentScriptMissingError } from "../../../shared/registry/normalize-agent-error.js";
import { collectInlineSnapshot } from "../../../shared/collect-inline-snapshot.js";
import {
	DEFAULT_POLL_INTERVAL_MS,
	INJECTION_DELAY_MS,
	RETRY_DELAY_MS,
} from "../lib/constants.js";

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

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
					code: "E_PERMISSION",
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

/** Run shared inline snapshot logic in a tab MAIN world (DRY vs content-script path). */
export async function executeSnapshotInTab(
	tabId: number | null,
	maxNodes: number,
): Promise<AsyncResponse> {
	return executeInTab(
		tabId,
		(maxNodesArg: unknown, fnSource: unknown) => {
			const run = (0, eval)(`(${String(fnSource)})`) as (
				maxNodes: number,
			) => unknown;
			const maxNodesNum =
				typeof maxNodesArg === "number" ? maxNodesArg : Number(maxNodesArg) || 500;
			return run(maxNodesNum);
		},
		[maxNodes, collectInlineSnapshot.toString()],
	);
}

export async function pingTabContentScript(
	tabId: number,
	timeoutMs: number = 3_000,
): Promise<AsyncResponse<{ ok: true }>> {
	throwIfAborted();
	const log = logger.child("runner");
	log.debug("pingTabContentScript_start", { tabId, timeout: timeoutMs });
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
	const deadline = Date.now() + timeoutMs;
	let lastRaceMsg = "";
	while (Date.now() < deadline) {
		throwIfAborted();
		const remaining = deadline - Date.now();
		if (remaining <= 0) break;
		try {
			const result = await Promise.race([
				chrome.tabs.sendMessage(tabId, { action: "ping" }),
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new Error("Timeout waiting for content-script ping")),
						remaining,
					),
				),
			]);
			log.debug("pingTabContentScript_success", { tabId, result });
			return { ok: true, value: { ok: true } };
		} catch (err: unknown) {
			const msg = (err instanceof Error ? err.message : String(err)) || "";
			lastRaceMsg = msg;
			log.debug("pingTabContentScript_retry", { tabId, error: msg });
			if (
				msg.includes("Could not establish connection") ||
				msg.includes("Receiving end does not exist")
			) {
				await sleep(
					Math.min(DEFAULT_POLL_INTERVAL_MS, deadline - Date.now()),
				);
				continue;
			}
			if (msg.includes("Timeout waiting for content-script ping")) {
				break;
			}
			return normalizeChromeError(err);
		}
	}
	log.debug("pingTabContentScript_error", { tabId, error: lastRaceMsg });
	let url = "";
	try {
		const tab = await chrome.tabs.get(tabId);
		url = tab.url ?? "";
	} catch {
		// ignore
	}
	if (
		lastRaceMsg.includes("Could not establish connection") ||
		lastRaceMsg.includes("Receiving end does not exist")
	) {
		return {
			ok: false,
			error: contentScriptMissingError(tabId, url),
		};
	}
	return {
		ok: false,
		error: contentScriptMissingError(tabId, url),
	};
}

export type WaitForTabLoadOptions = {
	/** Tab URL before navigation; used to detect blocked navigations, not for redirect matching. */
	preNavigationUrl?: string;
	/** When set, returns whether a loading event was observed before waitForTabLoad (e.g. listener registered pre-update). */
	getNavSawLoading?: () => boolean;
};

export async function waitForTabLoad(
	tabId: number | null,
	timeoutMs: number = 30_000,
	options?: WaitForTabLoadOptions,
): Promise<AsyncResponse<boolean>> {
	throwIfAborted();
	const log = logger.child("runner");
	const targetTab = typeof tabId === "number" ? tabId : null;
	const preNavigationUrl = options?.preNavigationUrl;
	const getNavSawLoading = options?.getNavSawLoading;
	log.debug("waitForTabLoad_start", {
		tabId: targetTab,
		timeout: timeoutMs,
		preNavigationUrl,
	});
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

	const shouldSettleOnComplete = (tab: {
		status?: string;
		url?: string;
	}, sawLoading: boolean): boolean => {
		if (tab.status !== "complete") return false;
		if (preNavigationUrl === undefined) return true;
		const urlChanged = tab.url !== preNavigationUrl;
		return sawLoading || urlChanged;
	};

	try {
		await new Promise<void>((resolve, reject) => {
			let settled = false;
			let sawLoading = getNavSawLoading?.() ?? false;
			const cleanup = () => {
				try {
					chrome.tabs.onUpdated.removeListener(listener);
				} catch {}
			};
			const settle = (fn: () => void) => {
				if (!settled) {
					settled = true;
					cleanup();
					fn();
				}
			};

			const mergeNavLoading = () => {
				if (getNavSawLoading?.()) {
					sawLoading = true;
				}
			};

			const trySettle = () => {
				mergeNavLoading();
				chrome.tabs
					.get(targetTab)
					.then((tab) => {
						if (shouldSettleOnComplete(tab, sawLoading)) {
							settle(resolve);
						}
					})
					.catch(() => {});
			};

			const listener = (
				updatedTabId: number,
				changeInfo: { status?: string },
			) => {
				if (updatedTabId !== targetTab) return;
				if (changeInfo.status === "loading") {
					sawLoading = true;
				}
				if (changeInfo.status === "complete") {
					trySettle();
				}
			};

			chrome.tabs.onUpdated.addListener(listener);

			chrome.tabs
				.get(targetTab)
				.then((tab) => {
					mergeNavLoading();
					if (tab.status === "loading") {
						sawLoading = true;
					}
					if (shouldSettleOnComplete(tab, sawLoading)) {
						settle(resolve);
					}
				})
				.catch((err) => {
					settle(() => reject(err));
				});

			setTimeout(() => {
				settle(() => reject(new Error("Timeout waiting for tab load")));
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
			let url = "";
			try {
				const tab = await chrome.tabs.get(targetTab);
				url = tab.url || "";
			} catch {}
			const displayUrl = url || preNavigationUrl || "unknown url";
			log.warn("waitForTabLoad_timeout", {
				tabId: targetTab,
				timeout: timeoutMs,
				url: displayUrl,
			});
			return {
				ok: false,
				error: {
					message: `Navigation timeout waiting for tab ${targetTab} (${displayUrl}) to load`,
					code: "E_NAVIGATION",
					category: "navigation",
				},
			};
		}
		return normalizeChromeError(err);
	}
}
