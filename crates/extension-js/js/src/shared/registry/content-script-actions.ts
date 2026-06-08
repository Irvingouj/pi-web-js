/**
 * Actions whose handler bodies run in the content script (DOM in the active tab).
 * Chrome/scripting wrappers and executeInTab-only APIs stay on main-thread.
 */
export const CONTENT_SCRIPT_ACTIONS = new Set<string>([
	"page_click",
	"page_fill",
	"page_type",
	"page_append",
	"page_press",
	"page_select",
	"page_check",
	"page_hover",
	"page_unhover",
	"page_scroll",
	"page_scroll_to",
	"page_dblclick",
	"page_back",
	"tab_click",
	"tab_fill",
	"tab_type",
	"tab_press",
	"tab_select",
	"tab_check",
	"tab_hover",
	"tab_unhover",
	"tab_scroll",
	"tab_scroll_to",
	"tab_dblclick",
	"tab_back",
]);

export function isContentScriptAction(action: string): boolean {
	return CONTENT_SCRIPT_ACTIONS.has(action);
}

/** Map registry action (page_click) to content-script handler key (click). */
export function toHandlerAction(action: string): string {
	if (action.startsWith("page_") || action.startsWith("tab_")) {
		const underscore = action.indexOf("_");
		if (underscore >= 0) {
			return action.slice(underscore + 1);
		}
	}
	return action;
}
