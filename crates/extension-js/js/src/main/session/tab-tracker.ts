/// <reference types="chrome" />
//
// Per-session tab tracker (Plan B).
//
// Owns the active-tab pointer AND all chrome.tabs.* listeners for ONE
// ExtensionSession. chrome.tabs.* events are profile-broadcast (Chromium
// `EventRouter::BroadcastEvent`): every sidepanel document receives every
// tab event for every window. So this tracker filters every listener by the
// session's `windowId` — only events involving OUR window mutate our pointer.
//
// This is the PRIMARY source of active-tab state in the extension product
// path (each session gets its own window-scoped pointer). tab-context.ts
// keeps a listener-less module-global as a FALLBACK for bare dispatchTool /
// executeMainThreadCommand calls that bypass a session (tests, web-js demo);
// the two never diverge in product use because handlers prefer ctx.resolveActiveTab.
// It correctly handles tabs dragged between windows:
//   - drag OUT (onDetached oldWindowId===ours, tab===active) → drop pointer
//   - drag IN  (onAttached newWindowId===ours)              → no auto-grab
//     (don't interrupt the agent; it re-resolves lazily on next page.*)
//
// Lifecycle: `init()` registers listeners + resolves the initial active tab
// (awaited, so the first page.* never races a null pointer). `dispose()`
// removes listeners.

import type { TabPolicy } from "../../shared/cross/types.js";
import { logger } from "../../shared/main/logger.js";

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

export class TabTracker {
	private activeTabId: number | null = null;
	private listenersAttached = false;

	constructor(
		private readonly chromeApi: typeof chrome | undefined,
		/** The window this tracker scopes to. null = unknown → events ignored,
		 * activeTab resolved lazily (web-js demo / pre-capture). */
		private windowId: number | null,
	) {}

	/** Register listeners and resolve the initial active tab. Await before the
	 * session reports ready so the first page.* doesn't race a null pointer. */
	async init(): Promise<void> {
		const chromeApi = this.chromeApi;
		if (!chromeApi?.runtime?.id) return;
		if (this.listenersAttached) return;
		this.listenersAttached = true;

		chromeApi.tabs.onActivated.addListener(this.onActivated);
		chromeApi.tabs.onUpdated.addListener(this.onUpdated);
		chromeApi.tabs.onRemoved?.addListener(this.onRemoved);
		chromeApi.tabs.onAttached?.addListener(this.onAttached);
		chromeApi.tabs.onDetached?.addListener(this.onDetached);

		try {
			const tabs = await chromeApi.tabs.query({
				active: true,
				lastFocusedWindow: true,
			});
			const first = tabs[0];
			if (first && typeof first.id === "number") {
				// Only adopt it if it's actually in our window (when known).
				if (this.windowId === null || first.windowId === this.windowId) {
					this.activeTabId = first.id;
				}
			}
		} catch (err) {
			logger.warn("tab_tracker_init_query_failed", {
				code: "E_TAB_QUERY",
				error: err instanceof Error ? err.message : String(err),
				windowId: this.windowId,
			});
		}
	}

	/** Remove all listeners. Safe to call multiple times. */
	dispose(): void {
		const chromeApi = this.chromeApi;
		if (!chromeApi?.runtime?.id || !this.listenersAttached) return;
		chromeApi.tabs.onActivated.removeListener(this.onActivated);
		chromeApi.tabs.onUpdated.removeListener(this.onUpdated);
		chromeApi.tabs.onRemoved?.removeListener(this.onRemoved);
		chromeApi.tabs.onAttached?.removeListener(this.onAttached);
		chromeApi.tabs.onDetached?.removeListener(this.onDetached);
		this.listenersAttached = false;
	}

	getActiveTabId(): number | null {
		return this.activeTabId;
	}

	setActiveTabId(tabId: number | null): void {
		this.activeTabId = tabId;
	}

	/** Rebind tab ownership to a different Chrome window (e.g. after merge). */
	rebindWindow(newWindowId: number): void {
		this.windowId = newWindowId;
		// Cached tab may belong to the removed window — force lazy re-query.
		this.activeTabId = null;
	}

	/** Resolve the active tab id, querying Chrome lazily when the cached
	 * pointer is null. Returns null when no tab is available. */
	async resolveActiveTabId(): Promise<number | null> {
		if (this.activeTabId !== null) return this.activeTabId;
		const chromeApi = this.chromeApi;
		if (!chromeApi?.runtime?.id) return null;
		try {
			// Query the active tab in OUR window when known; else any active tab.
			const query =
				this.windowId !== null
					? { active: true, windowId: this.windowId }
					: { active: true };
			const tabs = await chromeApi.tabs.query(query);
			const first = tabs[0];
			if (first && typeof first.id === "number") {
				this.activeTabId = first.id;
				return first.id;
			}
		} catch (err) {
			logger.warn("tab_tracker_resolve_query_failed", {
				code: "E_TAB_QUERY",
				error: err instanceof Error ? err.message : String(err),
				windowId: this.windowId,
			});
		}
		return null;
	}

	/**
	 * Resolve a tab id for a relay: explicit param wins, else active tab.
	 * Async so the active-tab fallback can lazily re-query Chrome when the
	 * cached pointer is null (e.g. after a drag-out with no onActivated yet) —
	 * consistent with resolveActiveTabId, so every page.* tool recovers the
	 * same way instead of some throwing E_NO_TAB while others re-resolve.
	 */
	async resolveTabId(
		tabPolicy: TabPolicy,
		params: Record<string, unknown>,
	): Promise<number> {
		const explicit = params.tabId ?? params.tab_id;
		const resolved = toTabId(explicit);
		if (resolved !== null) return resolved;
		if (explicit !== undefined && explicit !== null) {
			throw new Error("tabId must be a finite number or safe integer bigint");
		}
		if (tabPolicy === "required") {
			throw new Error("tabId is required for this action");
		}
		if (this.activeTabId !== null) return this.activeTabId;
		// Cached pointer empty — lazily re-query before giving up.
		const lazy = await this.resolveActiveTabId();
		if (lazy !== null) return lazy;
		throw new Error("No active tab available");
	}

	// ─── listeners (bound via arrow-function fields) ────────────────
	// Each filters by windowId: profile-broadcast events for OTHER windows
	// must not mutate THIS session's pointer.

	private onActivated = (info: { tabId: number; windowId: number }) => {
		if (this.windowId !== null && info.windowId !== this.windowId) return;
		this.activeTabId = info.tabId;
	};

	private onUpdated = (
		tabId: number,
		changeInfo: { status?: string },
		tab: { windowId?: number },
	) => {
		const chromeApi = this.chromeApi;
		if (!chromeApi?.runtime?.id) return;
		if (this.windowId !== null && tab.windowId !== this.windowId) return;
		if (changeInfo.status === "complete") {
			this.activeTabId = tabId;
			chromeApi.tabs.sendMessage(tabId, { action: "ping" }).catch(() => {
				// Content script not present; injection happens via manifest matches.
			});
		}
	};

	private onRemoved = (tabId: number, info: { windowId: number }) => {
		if (this.windowId !== null && info.windowId !== this.windowId) return;
		if (this.activeTabId === tabId) this.activeTabId = null;
	};

	/** Tab attached to a window. We do NOT auto-grab on drag-in (would
	 * interrupt the agent); only onActivated re-points. */
	private onAttached = (
		_tabId: number,
		_info: { newWindowId: number; newPosition: number },
	) => {
		// Intentionally a no-op for our pointer. Drag-in is handled by the
		// subsequent onActivated that fires in our window, if any.
	};

	/** Tab detached from a window. If OUR active tab just left, drop the
	 * pointer so the next page.* re-resolves instead of hitting a gone tab. */
	private onDetached = (
		tabId: number,
		info: { oldWindowId: number; oldPosition: number },
	) => {
		if (this.windowId === null) return;
		if (info.oldWindowId !== this.windowId) return;
		if (this.activeTabId === tabId) {
			logger.debug("tab_drag_out", { tabId, windowId: this.windowId });
			this.activeTabId = null;
		}
	};
}
