/// <reference types="chrome" />
// Main-thread runner entry.

export {
	type Command,
	setRunnerAbortController,
} from "../../shared/tool-registry.js";
export {
	executeMainThreadCommand,
	getActiveTabId,
	initExtensionListeners,
	isValidMainThreadAction,
	normalizeParams,
	registerHostHandler,
	registerHostHandlers,
	removeExtensionListeners,
} from "./runtime.js";

import "./tools/storage.js";
import "./tools/chrome-storage.js";
import "./tools/clipboard.js";
import "./tools/network.js";
import "./tools/page.js";
import "./tools/sidepanel.js";
import "./tools/dom.js";
import "./tools/tab.js";
import "./tools/chrome/index.js";
import "./tools/aliases.js";
import "./tools/host-call.js";
