// Public extension-js main-thread API.

export type {
	CellResult as JsRunResult,
	WasmGlobalsSnapshot as JsGlobalsSnapshot,
} from "../../pkg/extension_js.js";
export type { LogLevel } from "../shared/main/logger.js";
export { LOG_LEVEL_NUMERIC, setLogLevel } from "../shared/main/logger.js";
export {
	registerHostHandler,
	registerHostHandlers,
} from "./runner/index.js";
export { ExtensionSession } from "./session/extension-session.js";

import type { ExtensionSession } from "./session/extension-session.js";

/** Register a MessagePort for routing registry calls to an auxiliary worker context. */
export function registerWorkerRelayPort(
	session: ExtensionSession,
	owner: string,
	port: MessagePort,
): void {
	session.registerWorkerRelayPort(owner, port);
}
