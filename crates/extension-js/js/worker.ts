// Web Worker for extension-js
// Loads extension-js WASM, defines __extension_js_relay, and communicates with main thread.

import init, {
	ExtensionSession,
	setLogLevel as setWasmLogLevel,
} from "./extension_js.js";
import type { LogLevel } from "./logger.js";
import { logger, registerWasmSetLogLevel, setLogLevel } from "./logger.js";
import type { FsActionMap, FsAction } from "./fs-types.js";

let session: ExtensionSession | null = null;
let initialized = false;
const pendingRelays = new Map<string, (result: unknown) => void>();

// Invariant: the worker processes one cell run at a time. currentRunId is safe
// as a module-level variable because runCell messages are handled sequentially.
// If concurrent runs are ever supported, replace this with a Map keyed by call_id.
let currentRunId: string | undefined;

function generateId(): string {
	return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function mapNumericLevel(level: number): LogLevel {
	if (level <= 0) return "debug";
	if (level === 1) return "info";
	if (level === 2) return "warn";
	if (level === 3) return "error";
	return "none";
}

interface WorkerSelf extends WorkerGlobalScope {
	__extension_js_relay?: (cmd: unknown) => Promise<unknown>;
}

const workerSelf = self as WorkerSelf;

// Define the relay function that extension-js WASM expects globally
workerSelf.__extension_js_relay = (cmd: unknown) => {
	logger.debug("relay", {
		action: (cmd as Record<string, unknown>)?.action,
		runId: currentRunId,
	});
	return new Promise((resolve) => {
		const relayId = generateId();
		pendingRelays.set(relayId, resolve);
		self.postMessage({
			type: "asyncRelay",
			id: relayId,
			command: cmd,
			runId: currentRunId,
		});
	});
};

const fsRegistry = new Map<string, (params: unknown) => Promise<unknown>>();

function registerFs<K extends FsAction>(
	action: K,
	handler: (params: FsActionMap[K]["params"]) => Promise<FsActionMap[K]["result"]>,
) {
	fsRegistry.set(action, handler as (params: unknown) => Promise<unknown>);
}

function initFsRegistry(s: ExtensionSession) {
	registerFs("exists", (p) => s.fsExists(p));
	registerFs("stat", (p) => s.fsStat(p));
	registerFs("read", (p) => s.fsRead(p));
	registerFs("readText", (p) => s.fsReadText(p));
	registerFs("readBase64", (p) => s.fsReadBase64(p));
	registerFs("list", (p) => s.fsList(p));
	registerFs("mkdir", (p) => s.fsMkdir(p));
	registerFs("delete", (p) => s.fsDelete(p));
	registerFs("copy", (p) => s.fsCopy(p));
	registerFs("move", (p) => s.fsMove(p));
	registerFs("write", (p) => s.fsWrite(p));
	registerFs("writeText", (p) => s.fsWriteText(p));
	registerFs("writeBase64", (p) => s.fsWriteBase64(p));
	registerFs("append", (p) => s.fsAppend(p));
	registerFs("appendText", (p) => s.fsAppendText(p));
	registerFs("appendBase64", (p) => s.fsAppendBase64(p));
	registerFs("readRange", (p) => s.fsReadRange(p));
	registerFs("update", (p) => s.fsUpdate(p));
	registerFs("hash", (p) => s.fsHash(p));
}

async function initWasm() {
	if (initialized) return;
	await init();
	session = new ExtensionSession();
	setWasmLogLevel(3); // default "error"
	registerWasmSetLogLevel(setWasmLogLevel);
	initFsRegistry(session);
	initialized = true;
}

initWasm()
	.then(() => {
		self.postMessage({ type: "ready" });
	})
	.catch((err: unknown) => {
		const message = err instanceof Error ? err.message : String(err);
		self.postMessage({ type: "error", error: `WASM init failed: ${message}` });
	});

export type WorkerMessage =
	| { type: "runCell"; id: string; code: string; stdin: string; runId?: string }
	| { type: "reset"; id?: string }
	| { type: "stop"; id: string }
	| { type: "setFuelLimit"; id?: string; limit: number }
	| { type: "inspectGlobals"; id: string }
	| { type: "loadLibrary"; id: string; source: string }
	| { type: "fsCall"; id: string; action: string; params: unknown }
	| { type: "setLogLevel"; level: number }
	| { type: "asyncRelayResult"; id: string; result: unknown };

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
	const msg = e.data;

	if (msg.type === "setLogLevel") {
		setWasmLogLevel(msg.level);
		setLogLevel(mapNumericLevel(msg.level));
		logger.debug("set_log_level", { level: msg.level });
		return;
	}

	if (!initialized || !session) {
		self.postMessage({
			type: "error",
			id: msg.id,
			error: "WASM not initialized",
		});
		return;
	}

	switch (msg.type) {
		// Note: If a second runCell arrives while the first is still awaiting,
		// currentRunId will be overwritten. This is acceptable under the
		// single-cell-at-a-time invariant but would misattribute logs if violated.
		case "runCell": {
			currentRunId = msg.runId;
			try {
				const result = await session.runCellAsync(
					msg.code,
					msg.stdin || "",
					msg.runId || "", // propagate correlation ID to WASM so trace spans can be linked end-to-end
				);
				self.postMessage({
					type: "result",
					id: msg.id,
					data: result,
					runId: currentRunId,
				});
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				logger.error("runCell_error", { runId: currentRunId, error: message });
				self.postMessage({
					type: "error",
					id: msg.id,
					error: message,
					runId: currentRunId,
				});
			} finally {
				currentRunId = undefined;
			}
			break;
		}
		case "reset": {
			try {
				session.reset();
				self.postMessage({ type: "result", id: msg.id, data: { ok: true } });
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				self.postMessage({ type: "error", id: msg.id, error: message });
			}
			break;
		}
		case "stop": {
			// Reject all pending async relays so their Promises don't dangle
			for (const [relayId, reject] of pendingRelays) {
				reject({
					ok: false,
					error: { message: "Worker stopped", code: "E_STOPPED" },
				});
				pendingRelays.delete(relayId);
			}
			self.postMessage({ type: "result", id: msg.id, data: { ok: true } });
			break;
		}
		case "setFuelLimit": {
			try {
				session.set_fuel_limit(msg.limit);
				if (msg.id) {
					self.postMessage({ type: "result", id: msg.id, data: { ok: true } });
				}
			} catch (err: unknown) {
				if (msg.id) {
					const message = err instanceof Error ? err.message : String(err);
					self.postMessage({ type: "error", id: msg.id, error: message });
				}
			}
			break;
		}
		case "inspectGlobals": {
			try {
				const snap = session.inspect_globals();
				self.postMessage({ type: "result", id: msg.id, data: snap });
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				self.postMessage({ type: "error", id: msg.id, error: message });
			}
			break;
		}
		case "loadLibrary": {
			try {
				const result = session.load_library(msg.source);
				self.postMessage({ type: "result", id: msg.id, data: result });
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				self.postMessage({ type: "error", id: msg.id, error: message });
			}
			break;
		}
		case "fsCall": {
			const handler = fsRegistry.get(msg.action);
			if (!handler) {
				self.postMessage({
					type: "error",
					id: msg.id,
					error: `Unknown fs action: ${msg.action}`,
				});
				break;
			}
			try {
				const result = await handler(msg.params);
				self.postMessage({ type: "result", id: msg.id, data: result });
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				self.postMessage({ type: "error", id: msg.id, error: message });
			}
			break;
		}
		case "asyncRelayResult": {
			logger.debug("asyncRelayResult", {
				id: msg.id,
				resultType: typeof msg.result,
			});
			const resolve = pendingRelays.get(msg.id);
			if (resolve) {
				pendingRelays.delete(msg.id);
				resolve(msg.result);
			} else {
				logger.warn("asyncRelayResult_no_pending_relay", { id: msg.id });
			}
			break;
		}
	}
};
