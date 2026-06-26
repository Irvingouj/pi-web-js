/** Content-script tool specs — aggregated from page and tab namespaces. */
import { PAGE_TOOL_SPECS } from "./page-specs.js";
import { TAB_TOOL_SPECS } from "./tab-specs.js";

export type { ContentScriptToolSpec } from "./page-specs.js";
export { AWAIT_PROMISE_NOTE } from "./page-specs.js";

export const CONTENT_SCRIPT_TOOL_SPECS = [
	...PAGE_TOOL_SPECS,
	...TAB_TOOL_SPECS,
] as const;
