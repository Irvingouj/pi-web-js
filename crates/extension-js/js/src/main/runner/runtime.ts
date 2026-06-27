/// <reference types="chrome" />
// Re-exports from decomposed runner modules.

export {
	type Command,
	setRunnerAbortController,
	throwIfAborted,
} from "../../shared/main/tool-registry.js";

export {
	getActiveTabId,
	initExtensionListeners,
	removeExtensionListeners,
	resolveActiveTabId,
} from "../tab-context.js";
export { registerChromePassthrough } from "./chrome/internals.js";
export {
	invokeNative,
	isNativeParityAction,
	type NativeArgs,
	requireArgumentArray,
	resolveChromeMethod,
} from "./chrome/native.js";
export { executeMainThreadCommand } from "./command.js";
export {
	buildSnapshotInTab,
	ensureDomSnapshot,
	handleDomFormat,
	handleDomSnapshot,
} from "./dom/snapshot.js";
export { handleFetch } from "./fetch.js";
export { handleHostCallAction } from "./host.js";
export {
	CONTENT_SCRIPT_GRACE_MS,
	CS_FAST_PING_MS,
	DEFAULT_MAX_NODES,
	DEFAULT_POLL_INTERVAL_MS,
	DEFAULT_SCROLL_AMOUNT,
	DEFAULT_TIMEOUT_MS,
	NAVIGATION_SETTLE_MS,
	NETWORK_IDLE_QUIET_MS,
} from "./lib/constants.js";
export {
	isValidMainThreadAction,
	registerHostHandler,
	registerHostHandlers,
} from "./lib/host-registry.js";
export {
	asRecord,
	extractTabId,
	normalizeParams,
	unwrapResult,
} from "./lib/params.js";
export type {
	DomFormatParams,
	DomSnapshotParams,
	FetchParams,
} from "./lib/types.js";
export { makeError, throwAgentError } from "./lib/types.js";
export { extractRefId, getElementByRefId } from "./sidepanel/dom.js";
export {
	navigateTab,
	pingTabContentScript,
	preflightDomTab,
	waitForTabLoad,
} from "./tab/execute.js";
