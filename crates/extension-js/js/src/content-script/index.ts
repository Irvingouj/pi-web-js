// Content script entry — registers handlers and listens for extension messages.

import { initContentScriptLogger } from "./logger.js";
import { installMessageListener } from "./message-router.js";
import { registerContentScriptSpecs } from "./registry.js";
import {
	buildContentScriptSpecs,
	buildInfraContentScriptSpecs,
} from "./schemas.js";

declare global {
	interface Window {
		__jsNotebookContentScriptInjected?: boolean;
	}
}

initContentScriptLogger();

if (window.__jsNotebookContentScriptInjected) {
	throw new Error("Content script already injected");
}
window.__jsNotebookContentScriptInjected = true;

registerContentScriptSpecs([
	...buildContentScriptSpecs(),
	...buildInfraContentScriptSpecs(),
]);

installMessageListener();
