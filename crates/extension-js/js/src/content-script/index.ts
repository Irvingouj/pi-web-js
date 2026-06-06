// Content script entry — registers handlers and listens for extension messages.
import { registerContentScriptSpecs } from "./registry.js";
import {
	buildContentScriptSpecs,
	buildLegacyContentScriptSpecs,
} from "./schemas.js";
import { initContentScriptLogger } from "./logger.js";
import { installMessageListener } from "./message-router.js";

export {};

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
	...buildLegacyContentScriptSpecs(),
]);

installMessageListener();
