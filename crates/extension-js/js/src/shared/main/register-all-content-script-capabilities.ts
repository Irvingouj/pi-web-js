/**
 * Register every content-script capability on the main-thread pipeline once.
 * Source: CONTENT_SCRIPT_CAPABILITIES (single table, surfaces expand).
 */
import { CONTENT_SCRIPT_CAPABILITIES } from "../cross/content-script-capabilities.js";
import { register } from "./register-capability.js";

let registered = false;

export function registerAllContentScriptCapabilities(): void {
	if (registered) return;
	registered = true;
	for (const cap of CONTENT_SCRIPT_CAPABILITIES) {
		// Main path: manifest + action set only (no handler bodies).
		const { handler: _h, ...meta } = cap;
		register(meta);
	}
}

/** Test helper: allow re-registration after clearJsRegistry. */
export function resetContentScriptCapabilityRegistrationForTest(): void {
	registered = false;
}
