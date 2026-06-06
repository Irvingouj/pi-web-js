/// <reference types="chrome" />
// Re-exports from decomposed runner modules.

export {
	type Command,
	setRunnerAbortController,
	throwIfAborted,
} from "../../shared/tool-registry.js";

export {
	getActiveTabId,
	resolveActiveTabId,
	initExtensionListeners,
	removeExtensionListeners,
} from "../tab-context.js";

export {
	DEFAULT_MAX_NODES,
	DEFAULT_TIMEOUT_MS,
	DEFAULT_SCROLL_AMOUNT,
	DEFAULT_POLL_INTERVAL_MS,
} from "./lib/constants.js";

export type { DomFormatParams, DomSnapshotParams, FetchParams } from "./lib/types.js";
export { makeError } from "./lib/types.js";

export {
	registerHostHandler,
	registerHostHandlers,
	isValidMainThreadAction,
} from "./lib/host-registry.js";

export { asRecord, extractTabId, normalizeParams, unwrapResult } from "./lib/params.js";

export { executeMainThreadCommand } from "./command.js";
export { handleFetch } from "./fetch.js";
export { executeInTab, waitForTabLoad } from "./tab/execute.js";
export { sendMessageToTab } from "./tab/messaging.js";
export { getElementByRefId, extractRefId } from "./sidepanel/dom.js";
export {
	ensureDomSnapshot,
	handleDomSnapshot,
	handleDomFormat,
	buildSnapshotInTab,
} from "./dom/snapshot.js";
export { handleHostCallAction } from "./host.js";
export { registerChromePassthrough } from "./chrome/internals.js";
