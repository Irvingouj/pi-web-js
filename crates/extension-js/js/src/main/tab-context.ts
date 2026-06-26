import type { TabPolicy } from "../shared/cross/types.js";
import { logger } from "../shared/main/logger.js";

let activeTabId: number | null = null;
let listenersAttached = false;

const onActivatedListener = ({ tabId }: { tabId: number }) => {
	activeTabId = tabId;
};

const onUpdatedListener = (tabId: number, changeInfo: { status?: string }) => {
	const chromeApi = window.chrome;
	if (!chromeApi?.runtime?.id) return;
	if (changeInfo.status === "complete") {
		activeTabId = tabId;
		chromeApi.tabs.sendMessage(tabId, { action: "ping" }).catch(() => {
			// Content script not present; injection happens via manifest matches.
		});
	}
};

export function getActiveTabId(): number | null {
	return activeTabId;
}

export function setActiveTabId(tabId: number | null): void {
	activeTabId = tabId;
}

export function initTabContext(chromeApi: typeof chrome): void {
	if (listenersAttached) return;
	if (!chromeApi?.runtime?.id) return;
	listenersAttached = true;

	chromeApi.tabs.onActivated.addListener(onActivatedListener);
	chromeApi.tabs.onUpdated.addListener(onUpdatedListener);

	void chromeApi.tabs
		.query({ active: true, lastFocusedWindow: true })
		.then((tabs) => {
			const first = tabs[0];
			if (first?.id !== undefined) {
				activeTabId = first.id;
			}
		})
		.catch(() => {
			// ignore query errors
		});
}

export function removeTabContextListeners(): void {
	const chromeApi = window.chrome;
	if (!chromeApi?.runtime?.id || !listenersAttached) return;
	chromeApi.tabs.onActivated.removeListener(onActivatedListener);
	chromeApi.tabs.onUpdated.removeListener(onUpdatedListener);
	listenersAttached = false;
}

/** @deprecated Use initTabContext — kept for runner API compatibility */
export function initExtensionListeners(): void {
	if (typeof chrome !== "undefined" && chrome.runtime?.id) {
		initTabContext(chrome);
	}
}

/** @deprecated Use removeTabContextListeners — kept for runner API compatibility */
export function removeExtensionListeners(): void {
	removeTabContextListeners();
}

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
