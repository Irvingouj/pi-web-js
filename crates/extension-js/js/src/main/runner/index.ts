/// <reference types="chrome" />
// Main-thread runner entry.

export {
	registerHostHandler,
	registerHostHandlers,
	isValidMainThreadAction,
	normalizeParams,
	getActiveTabId,
	initExtensionListeners,
	removeExtensionListeners,
	executeMainThreadCommand,
} from "./runtime.js";
export { type Command, setRunnerAbortController } from "../../shared/tool-registry.js";

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
