/**
 * Actions whose handler bodies run in the content script (DOM in the active tab).
 * Chrome passthrough APIs (e.g. chrome.scripting.*) stay on main-thread.
 * Populated dynamically by defineContentScriptTool registrations.
 */
const contentScriptActions = new Set<string>();

export function addContentScriptAction(action: string): void {
	contentScriptActions.add(action);
}

export function isContentScriptAction(action: string): boolean {
	return contentScriptActions.has(action);
}

export function getContentScriptActions(): string[] {
	return Array.from(contentScriptActions);
}

/** Test-only helper: clear the dynamic content-script action set. */
export function clearContentScriptActions(): void {
	contentScriptActions.clear();
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
