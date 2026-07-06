/// <reference types="chrome" />
import type { z } from "zod";
import type { CallContext } from "../../../shared/cross/manifest.js";
import { contentScriptMissingError } from "../../../shared/cross/normalize-agent-error.js";
import * as schemas from "../../../shared/cross/schemas.js";
import { unwrapContentScriptMessage } from "../../../shared/main/content-script-response.js";
import { logger } from "../../../shared/main/logger.js";
import {
	type AsyncResponse,
	dispatchTool,
	throwIfAborted,
} from "../../../shared/main/tool-registry.js";
import { normalizeChromeError } from "../chrome/internals.js";
import {
	CONTENT_SCRIPT_GRACE_MS,
	DEFAULT_POLL_INTERVAL_MS,
	DEFAULT_TIMEOUT_MS,
	NETWORK_IDLE_QUIET_MS,
} from "../lib/constants.js";
import { NetworkTracker } from "../lib/network-tracker.js";
import { unwrapResult } from "../lib/params.js";
import { makeError } from "../lib/types.js";

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Tab script execution ──────────────────────────────────────
//
// Signal-threading convention: `preflightDomTab`, `pingTabContentScript`,
// and `handleFetch` take `signal` as a trailing positional arg (single-shot
// checks, few params). `waitForTabLoad` and `navigateTab` take it via their
// options bag (they already carry rich configuration). Both read the SAME
// per-session AbortController threaded down from ExtensionSession.

/** Fail fast when a tab URL cannot host content-script DOM APIs (non-http(s)). */
export async function preflightDomTab(
	tabId: number,
	signal?: AbortSignal,
): Promise<AsyncResponse | null> {
	throwIfAborted(signal);
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
					message: `Cannot use DOM APIs on ${label}. page.* and web.tab.* DOM operations require an http(s) page tab — use tabs.find(t => t.url?.startsWith("http")) instead of tabs[0].`,
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

export async function pingTabContentScript(
	tabId: number,
	timeoutMs: number = 3_000,
	signal?: AbortSignal,
): Promise<AsyncResponse<{ ok: true }>> {
	throwIfAborted(signal);
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
		throwIfAborted(signal);
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
			const parsed = unwrapContentScriptMessage(result);
			if (!parsed.ok) {
				log.debug("pingTabContentScript_rejected", {
					tabId,
					error: parsed.error,
				});
				return parsed;
			}
			log.debug("pingTabContentScript_success", { tabId, result });
			return { ok: true, value: { ok: true } };
		} catch (err: unknown) {
			const msg = (err instanceof Error ? err.message : String(err)) || "";
			lastRaceMsg = msg;
			log.debug("pingTabContentScript_retry", { tabId, error: msg });
			if (
				msg.includes("Could not establish connection") ||
				msg.includes("Receiving end does not exist") ||
				msg.includes("message port closed before a response was received")
			) {
				await sleep(Math.min(DEFAULT_POLL_INTERVAL_MS, deadline - Date.now()));
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
	/** trace-id for logging correlation with the originating run_js cell. */
	runId?: string;
	/**
	 * Grace window (ms) for heavy SPAs whose `load` event never fires. Once the
	 * tab has provably navigated (URL moved away from preNavigationUrl) but
	 * `complete` hasn't arrived, settle as loaded after this delay instead of
	 * waiting out the full timeout. Default 5000. Ignored when preNavigationUrl
	 * is unknown (can't prove navigation).
	 */
	loadGraceMs?: number;
	/** Per-session abort signal, threaded from the originating ExtensionSession. */
	signal?: AbortSignal;
};

export async function waitForTabLoad(
	tabId: number | null,
	timeoutMs: number = 30_000,
	options?: WaitForTabLoadOptions,
): Promise<AsyncResponse<boolean>> {
	throwIfAborted(options?.signal);
	const log = logger.child("runner");
	const targetTab = typeof tabId === "number" ? tabId : null;
	const preNavigationUrl = options?.preNavigationUrl;
	const getNavSawLoading = options?.getNavSawLoading;
	log.debug("waitForTabLoad_start", {
		tabId: targetTab,
		timeout: timeoutMs,
		preNavigationUrl,
		runId: options?.runId,
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

	const shouldSettleOnComplete = (
		tab: {
			status?: string;
			url?: string;
		},
		sawLoading: boolean,
	): boolean => {
		if (tab.status !== "complete") return false;
		if (preNavigationUrl === undefined) return true;
		const urlChanged = tab.url !== preNavigationUrl;
		return sawLoading || urlChanged;
	};

	const hasNavigatedAway = (tabUrl: string | undefined): boolean =>
		preNavigationUrl !== undefined &&
		typeof tabUrl === "string" &&
		tabUrl.length > 0 &&
		tabUrl !== preNavigationUrl;

	const graceMs = options?.loadGraceMs ?? 5_000;

	try {
		await new Promise<void>((resolve, reject) => {
			let settled = false;
			let sawLoading = getNavSawLoading?.() ?? false;
			let graceTimer: ReturnType<typeof setTimeout> | null = null;
			const cleanup = () => {
				try {
					chrome.tabs.onUpdated.removeListener(listener);
				} catch {}
				if (graceTimer) clearTimeout(graceTimer);
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

			const armGraceIfNavigated = (tabUrl: string | undefined) => {
				if (graceTimer || settled) return;
				if (!hasNavigatedAway(tabUrl)) return;
				graceTimer = setTimeout(() => {
					log.debug("waitForTabLoad_grace_settle", {
						tabId: targetTab,
						url: tabUrl,
						graceMs,
						runId: options?.runId,
					});
					settle(resolve);
				}, graceMs);
			};

			const trySettle = () => {
				mergeNavLoading();
				chrome.tabs
					.get(targetTab)
					.then((tab) => {
						if (shouldSettleOnComplete(tab, sawLoading)) {
							settle(resolve);
						} else {
							armGraceIfNavigated(tab.url);
						}
					})
					.catch(() => {});
			};

			const listener = (
				updatedTabId: number,
				changeInfo: { status?: string; url?: string },
			) => {
				if (updatedTabId !== targetTab) return;
				if (changeInfo.status === "loading") {
					sawLoading = true;
					log.debug("waitForTabLoad_status", {
						tabId: targetTab,
						status: "loading",
						runId: options?.runId,
					});
				}
				if (changeInfo.url) {
					log.debug("waitForTabLoad_status", {
						tabId: targetTab,
						url: changeInfo.url,
						runId: options?.runId,
					});
					armGraceIfNavigated(changeInfo.url);
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
					log.debug("waitForTabLoad_initial_status", {
						tabId: targetTab,
						status: tab.status,
						url: tab.url,
						runId: options?.runId,
					});
					if (shouldSettleOnComplete(tab, sawLoading)) {
						settle(resolve);
					} else {
						armGraceIfNavigated(tab.url);
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
			runId: options?.runId,
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
				runId: options?.runId,
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

export interface NavigateTabOptions {
	tabId: number;
	url: string;
	preNavigationUrl: string | undefined;
	waitUntil?: "load" | "networkidle";
	timeoutMs?: number;
	traceId?: string;
	logPrefix: string;
	/** Per-session abort signal, threaded from the originating ExtensionSession. */
	signal?: AbortSignal;
	/** Call context for inner dispatchTool calls (ownership gate). */
	ctx?: CallContext;
}

/**
 * Shared navigation core used by both page.goto (active-tab) and
 * web.tab.goto (tab-scoped). Handles tabs.update, waitForTabLoad,
 * post-nav URL guards, networkidle, content-script ping, and final tab get.
 */
export async function navigateTab(
	options: NavigateTabOptions,
): Promise<z.infer<typeof schemas.ChromeTabSchema>> {
	const {
		tabId,
		url,
		preNavigationUrl,
		waitUntil,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		traceId = "?",
		logPrefix,
		ctx,
	} = options;

	const innerCtx: CallContext = ctx ?? { action: "chrome_tabs_update" };

	const chromeApi = window.chrome;
	let navSawLoading = false;
	const navListener = (
		updatedTabId: number,
		changeInfo: { status?: string },
	) => {
		if (updatedTabId !== tabId) return;
		if (changeInfo.status === "loading") {
			navSawLoading = true;
		}
	};
	chromeApi?.tabs?.onUpdated?.addListener(navListener);
	try {
		const updateResult = await dispatchTool(
			"chrome_tabs_update",
			[tabId, { url }],
			innerCtx,
		);
		if (!updateResult.ok) {
			return unwrapResult(updateResult);
		}
		const loadResult = await waitForTabLoad(tabId, timeoutMs, {
			preNavigationUrl,
			getNavSawLoading: () => navSawLoading,
			runId: traceId,
			signal: options.signal,
		});
		if (!loadResult.ok) {
			return unwrapResult(loadResult);
		}
		logger.debug(`${logPrefix}_tab_load_complete`, { traceId, tabId });
	} finally {
		chromeApi?.tabs?.onUpdated?.removeListener(navListener);
	}

	const tabCheck = await dispatchTool("chrome_tabs_get", [tabId], innerCtx);
	if (tabCheck.ok && tabCheck.value) {
		const parsed = schemas.ChromeTabSchema.safeParse(tabCheck.value);
		if (parsed.success) {
			const currentUrl = parsed.data.url ?? "";
			if (
				currentUrl &&
				!currentUrl.startsWith("http:") &&
				!currentUrl.startsWith("https:")
			) {
				throw makeError(
					`Navigation blocked: cannot script ${currentUrl}`,
					"E_NAVIGATION",
					"navigation",
				);
			}
			if (
				preNavigationUrl &&
				parsed.data.status === "complete" &&
				currentUrl === preNavigationUrl &&
				currentUrl !== url
			) {
				throw makeError(
					`Navigation did not start for ${url}`,
					"E_NAVIGATION",
					"navigation",
				);
			}
		}
	}

	if (waitUntil === "networkidle") {
		const tracker = new NetworkTracker(tabId);
		try {
			logger.debug(`${logPrefix}_network_idle_start`, { traceId, tabId });
			tracker.start();
			const networkTimeout = Math.max(NETWORK_IDLE_QUIET_MS * 2, timeoutMs);
			await tracker.waitForIdle(networkTimeout, traceId);
		} catch (idleErr) {
			logger.debug(`${logPrefix}_network_idle_timeout`, {
				traceId,
				tabId,
				error: idleErr instanceof Error ? idleErr.message : String(idleErr),
			});
			throw makeError(
				idleErr instanceof Error ? idleErr.message : String(idleErr),
				"E_NAVIGATION",
				"navigation",
			);
		} finally {
			tracker.dispose();
			logger.debug(`${logPrefix}_network_idle_done`, { traceId, tabId });
		}
	}

	const pingResult = await pingTabContentScript(
		tabId,
		timeoutMs,
		options.signal,
	);
	if (!pingResult.ok) {
		return unwrapResult(pingResult);
	}
	await new Promise((resolve) => setTimeout(resolve, CONTENT_SCRIPT_GRACE_MS));
	const freshTab = await dispatchTool("chrome_tabs_get", [tabId], innerCtx);
	const parsed = schemas.ChromeTabSchema.safeParse(unwrapResult(freshTab));
	if (!parsed.success) {
		throw makeError(
			`Navigation completed but the resulting tab failed schema validation: ${parsed.error.message}`,
			"E_UNKNOWN",
			"navigation",
		);
	}
	return parsed.data;
}
