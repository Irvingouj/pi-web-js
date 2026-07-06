/// <reference types="chrome" />
//
// Per-window tab ownership gate for native-parity tools.
//
// AGENTS.md lets parity tools (chrome.tabs.sendMessage,
// chrome.scripting.executeScript, …) transport opaque NativeArgs end-to-end
// without reshaping. We still enforce the product rule that a session may only
// touch tabs in its own Chrome window: BEFORE invoking Chrome, we read the
// tabId(s) out of the (untouched) args and reject cross-window access with
// E_TAB_NOT_OWNED. The args array is never mutated.

import { makeError } from "../lib/types.js";

/**
 * Native-parity actions whose first argument (or `target`) carries tab ids
 * that we ownership-check. Read-only tab metadata APIs (chrome_tabs_get,
 * chrome_tabs_query) are DELIBERATELY excluded: cross-window READS are
 * allowed (page.tabs()/tab.list() need to enumerate), only cross-window
 * WRITES/messages are gated. Keep this list in sync with the parity
 * registrations in tools/chrome/ — see the companion test that locks the
 * membership.
 */
const TAB_RECEIVING_ACTIONS = new Set<string>([
	"chrome_tabs_sendMessage",
	"chrome_tabs_update",
	"chrome_tabs_remove",
	"chrome_tabs_reload",
	"chrome_scripting_executeScript",
	"chrome_scripting_insertCSS",
	"chrome_scripting_removeCSS",
]);

/** True iff this parity action accepts a tab id we should ownership-check. */
export function isTabReceivingAction(action: string): boolean {
	return TAB_RECEIVING_ACTIONS.has(action);
}

/**
 * Read-only extraction of tab ids from a parity action's NativeArgs.
 * Returns `[]` when no tab id can be found (e.g. the call targets a frameId
 * only, or the shape is unrecognized) — callers treat "no ids" as "no check".
 *
 * Shapes covered (per Chrome's API):
 *   - sendMessage/update/reload: [tabId:number, …]            → args[0] number
 *   - remove:                    [tabId:number] | [tabIds:number[]]
 *   - executeScript/insertCSS/removeCSS: [{target:{tabId|tabIds}}, …]
 *   - legacy top-level:          [{tabId:number}, …]
 */
export function extractTabIds(
	action: string,
	args: readonly unknown[],
): number[] {
	if (args.length === 0) return [];
	const first = args[0];

	// tabs.* — first arg is a number (tabId) or number[] (tabIds for remove).
	if (action.startsWith("chrome_tabs_")) {
		if (typeof first === "number") return [first];
		if (Array.isArray(first)) {
			return first.filter((n): n is number => typeof n === "number");
		}
		return [];
	}

	// scripting.* — first arg is an injection spec with target.{tabId|tabIds}.
	if (action.startsWith("chrome_scripting_")) {
		if (typeof first !== "object" || first === null) return [];
		const spec = first as Record<string, unknown>;
		// target.tabId / target.tabIds (MV3 standard)
		const target = spec.target;
		if (typeof target === "object" && target !== null) {
			const t = target as Record<string, unknown>;
			if (typeof t.tabId === "number") return [t.tabId];
			if (Array.isArray(t.tabIds)) {
				return t.tabIds.filter((n): n is number => typeof n === "number");
			}
		}
		// legacy top-level tabId
		if (typeof spec.tabId === "number") return [spec.tabId];
		return [];
	}

	return [];
}

/**
 * Reject if any of the action's target tabs lives outside `windowId`.
 * No-op when `windowId` is null/undefined (unknown owning window — web-js demo
 * or session not yet bound) — preserves backwards compatibility.
 *
 * Throws an structured agent error (caught by dispatchTool and surfaced as a
 * CellResult error), so it never reaches the underlying Chrome call.
 */
export async function assertTabOwnership(
	action: string,
	args: readonly unknown[],
	windowId: number | null | undefined,
	chromeApi: typeof chrome,
): Promise<void> {
	if (windowId === null || windowId === undefined) return;
	if (!isTabReceivingAction(action)) return;

	const tabIds = extractTabIds(action, args);
	if (tabIds.length === 0) return;

	if (!chromeApi?.tabs?.get) return; // nothing we can verify; let Chrome reject

	for (const tabId of tabIds) {
		let tab: { windowId?: number };
		try {
			tab = await chromeApi.tabs.get(tabId);
		} catch {
			// This tab is gone/inaccessible — but don't abort the whole batch:
			// continue checking the remaining ids so a cross-window id later in
			// the list is still caught. The real Chrome call surfaces the gone
			// tab's error for whichever id fails.
			continue;
		}
		if (typeof tab.windowId === "number" && tab.windowId !== windowId) {
			throw makeError(
				`Tab ${tabId} is not accessible from this session`,
				"E_TAB_NOT_OWNED",
				"permission",
			);
		}
	}
}
