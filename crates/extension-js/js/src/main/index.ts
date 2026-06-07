// Public extension-js main-thread API.

export type { LogLevel } from "../shared/logger.js";
export { setLogLevel } from "../shared/logger.js";
export type {
	CellResult as JsRunResult,
	WasmGlobalsSnapshot as JsGlobalsSnapshot,
} from "../../pkg/extension_js.js";
export {
	registerHostHandler,
	registerHostHandlers,
} from "./runner/index.js";
export { ExtensionSession } from "./session/extension-session.js";

import { ExtensionSession } from "./session/extension-session.js";

/** Register a MessagePort for routing registry calls to an auxiliary worker context. */
export function registerWorkerRelayPort(
	session: ExtensionSession,
	owner: string,
	port: MessagePort,
): void {
	session.registerWorkerRelayPort(owner, port);
}
