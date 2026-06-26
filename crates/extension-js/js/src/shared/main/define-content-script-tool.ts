import { addContentScriptAction } from "../cross/content-script-actions.js";
import type { ContentScriptToolSpec } from "../cross/content-script-tools.js";
import { registerContentScriptJsCall } from "./tool-registry.js";

/** Register a content-script tool on the main thread.
 *  - Adds a manifest entry via registerContentScriptJsCall
 *  - Adds the action to the dynamic content-script action set
 *  Does NOT call registerContentScriptSpec (content script registers its own specs). */
export function defineContentScriptTool<P, R>(
	spec: ContentScriptToolSpec<P, R>,
): void {
	// handlerKey is content-script dispatch metadata, not manifest metadata.
	const { handlerKey: _handlerKey, ...rest } = spec;
	registerContentScriptJsCall(rest);
	addContentScriptAction(spec.action);
}
