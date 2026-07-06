import type { TabPolicy } from "../shared/cross/types.js";
import { logger } from "../shared/main/logger.js";

//
// Demo / bare-call fallback for active-tab state.
//
// Per-session tab tracking lives in `session/tab-tracker.ts` (Plan B): each
// ExtensionSession owns its active-tab pointer + windowId-scoped chrome.tabs.*
// listeners. In the extension product path, handlers resolve the active tab via
// `ctx.resolveActiveTab` (the session's tracker). The functions here are the
// FALLBACK for direct `executeMainThreadCommand`/`dispatchTool` calls that
// bypass a session (tests, low-level API, web-js demo with no Chrome window).
// They keep a small, listener-less module-global pointer + lazy re-query — no
// chrome.tabs.* listeners (those belong to TabTracker, to avoid a second
// listener owner and a divergent second source of truth).
//

let activeTabId: number | null = null;

export function getActiveTabId(): number | null {
	return activeTabId;
}

export function setActiveTabId(tabId: number | null): void {
	activeTabId = tabId;
}

/** Resolve the active tab id for the bare-call fallback path (no session tracker). */
export async function resolveActiveTabId(): Promise<number | null> {
	const log = logger.child("tab-context");
	log.debug("resolveActiveTabId_start", { activeTabId });
	if (activeTabId !== null) {
		log.debug("resolveActiveTabId_result", { tabId: activeTabId });
		return activeTabId;
	}
	const chromeApi = window.chrome;
	if (!chromeApi?.runtime?.id) {
		log.warn("resolveActiveTabId_result", {
			tabId: null,
			reason: "no_extension",
		});
		return null;
	}
	try {
		const tabs = await chromeApi.tabs.query({ active: true });
		const first = tabs[0];
		if (first && typeof first.id === "number") {
			activeTabId = first.id;
			log.debug("resolveActiveTabId_result", { tabId: first.id });
			return first.id;
		}
	} catch {
		// ignore
	}
	log.warn("resolveActiveTabId_result", { tabId: null, reason: "not_found" });
	return null;
}

function toTabId(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "bigint") {
		const asNumber = Number(value);
		return Number.isSafeInteger(asNumber) ? asNumber : null;
	}
	return null;
}

/**
 * Resolve a tab id from params (bare-call fallback). Session-bound relays go
 * through `TabTracker.resolveTabId` (async, lazy re-query); this sync version
 * is only reached when no session tracker is available.
 */
export function resolveTabId(
	tabPolicy: TabPolicy,
	params: Record<string, unknown>,
): number {
	const explicit = params.tabId ?? params.tab_id;
	const resolved = toTabId(explicit);
	if (resolved !== null) {
		return resolved;
	}
	if (explicit !== undefined && explicit !== null) {
		throw new Error("tabId must be a finite number or safe integer bigint");
	}

	if (tabPolicy === "required") {
		throw new Error("tabId is required for this action");
	}

	if (activeTabId !== null) {
		return activeTabId;
	}

	throw new Error("No active tab available");
}