// Web Worker for extension-js
// Loads extension-js WASM and communicates with main thread.

import type { z } from "zod";
import type { FsActionMap } from "../shared/fs-types.js";
import type { LogLevel } from "../shared/logger.js";
import {
	logger,
	numericToLogLevel,
	registerWasmSetLogLevel,
	setLogLevel,
} from "../shared/logger.js";
import { formatValidationError } from "../shared/registry/dispatch.js";
import {
	getRoute,
	populateRoutesFromManifest,
} from "../shared/registry/routes.js";
import type { DispatchContext } from "../shared/registry/types.js";
import * as schemas from "../shared/schemas.js";
import {
	coerceWasmParams,
	manifestEntryToWasm,
	type SerializableJsCallManifestEntry,
} from "../shared/tool-registry.js";
import { clearAllBlobStores, clearRun } from "./binary-blob-store.js";
import init, {
	clearVfsWriteCache as clear_vfs_write_cache,
	ExtensionSession,
	registerJsCallBatch as register_js_call_batch,
	setLogLevel as setWasmLogLevel,
	takeCachedVfsWriteBase64 as take_cached_vfs_write_base64,
} from "./extension_js.js";
import { maybeStoreFetchResult } from "./fetch-store.js";
import { resolveSetFilesParams } from "./resolve-set-files.js";
import {
	cacheVfsWriteBase64,
	clearVfsWriteCache,
	takeCachedVfsWriteBase64,
} from "./vfs-write-cache.js";

const SET_FILES_ACTIONS = new Set(["page_set_files", "tab_set_files"]);
const FETCH_STORE_ACTIONS = new Set(["page_fetch", "tab_fetch"]);

let session: ExtensionSession | null = null;
let initialized = false;
const pendingRelays = new Map<
	string,
	{
		settle: (result: unknown) => void;
		timeoutId: ReturnType<typeof setTimeout>;
		abort?: () => void;
		owner: string;
		port: RelayPort;
	}
>();

type RelayPort = {
	postMessage(message: unknown): void;
	addEventListener: (
		type: "message",
		listener: (event: MessageEvent) => void,
	) => void;
	start?: () => void;
};

function safePortPost(port: RelayPort, message: unknown): boolean {
	try {
		port.postMessage(message);
		return true;
	} catch (error: unknown) {
		const messageText = error instanceof Error ? error.message : String(error);
		logger.error("port_post_failed", { error: messageText });
		return false;
	}
}

const MAX_PENDING_RELAYS = 1000;

function cancelRemoteRelay(
	relayId: string,
	owner: string,
	port: RelayPort,
): void {
	if (owner === "main-thread" || owner === "content-script") {
		safePortPost(port, { type: "relayCancel", id: relayId, owner });
	} else {
		safePortPost(port, { type: "registryCallCancel", id: relayId });
	}
}

export function settleAllPendingRelays(code: string, message: string): void {
	for (const [relayId, pending] of pendingRelays) {
		clearTimeout(pending.timeoutId);
		cancelRemoteRelay(relayId, pending.owner, pending.port);
		pending.settle({
			ok: false,
			error: { message, code },
		});
		pendingRelays.delete(relayId);
	}
}

// Worker-local registry for handlers that execute in the same worker as the VM
const workerHandlerRegistry = new Map<
	string,
	(params: unknown, context?: unknown) => Promise<unknown>
>();
const runAbortControllers = new Map<string, AbortController>();
let sessionQueue: Promise<void> = Promise.resolve();
let activeRunCell: { id: string; runId?: string } | null = null;

function enqueueSessionWork<T>(work: () => Promise<T>): Promise<T> {
	logger.trace("sessionQueue_enqueue");
	const job = sessionQueue.then(work);
	sessionQueue = job.then(
		() => undefined,
		() => undefined,
	);
	return job;
}

function reportActiveRunFailure(error: string): void {
	if (!activeRunCell) return;
	logger.error("runCell_worker_failure", {
		runId: activeRunCell.runId,
		callId: activeRunCell.id,
		error,
	});
	self.postMessage({
		type: "error",
		id: activeRunCell.id,
		error,
		runId: activeRunCell.runId,
	});
	activeRunCell = null;
}

self.addEventListener("error", (event) => {
	const message =
		event.message ||
		(event.error instanceof Error
			? event.error.message
			: "Worker uncaught error");
	logger.error("worker_uncaught_error", { error: message });
	reportActiveRunFailure(message);
});

self.addEventListener("unhandledrejection", (event) => {
	const reason = event.reason;
	const message =
		reason instanceof Error
			? reason.message
			: String(reason ?? "Unhandled rejection");
	logger.error("worker_unhandled_rejection", { error: message });
	reportActiveRunFailure(message);
});

export function registerWorkerHandler(
	action: string,
	handler: (params: unknown, context?: unknown) => Promise<unknown>,
): void {
	workerHandlerRegistry.set(action, handler);
}

export function registerWorkerHandlerValidated<P>(
	action: string,
	paramsSchema: z.ZodSchema<P>,
	handler: (params: P, context?: unknown) => Promise<unknown>,
): void {
	registerWorkerHandler(action, async (params, context) => {
		const parseResult = paramsSchema.safeParse(coerceWasmParams(params));
		if (!parseResult.success) {
			const message = formatValidationError(
				action,
				paramsSchema,
				parseResult.error.issues,
				params,
			);
			const err = new Error(message) as Error & { code: string };
			err.code = "E_INVALID_PARAMS";
			throw err;
		}
		return await handler(parseResult.data, context);
	});
}

function generateId(): string {
	const arr = new Uint8Array(16);
	crypto.getRandomValues(arr);
	return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function mapNumericLevel(level: number): LogLevel {
	return numericToLogLevel(level);
}

const workerPortRegistry = new Map<string, RelayPort>();
const portInFlightCalls = new Map<string, AbortController>();

export function registerWorkerPort(owner: string, port: RelayPort): void {
	if (workerPortRegistry.has(owner)) {
		throw new Error(`Worker port already registered for owner: ${owner}`);
	}
	if (typeof port.addEventListener !== "function") {
		throw new Error(
			`Worker port for owner "${owner}" cannot receive responses`,
		);
	}
	workerPortRegistry.set(owner, port);
	port.addEventListener("message", async (event: MessageEvent) => {
		const message = event.data as Record<string, unknown> | null;
		if (
			message !== null &&
			(message.type === "asyncRelayResult" ||
				message.type === "registryCallResult") &&
			typeof message.id === "string"
		) {
			resolveAsyncRelayResult(message.id, message.result);
			return;
		}
		if (
			message !== null &&
			message.type === "registryCallCancel" &&
			typeof message.id === "string"
		) {
			portInFlightCalls.get(message.id)?.abort();
			portInFlightCalls.delete(message.id);
			return;
		}
		if (
			message !== null &&
			message.type === "registryCall" &&
			typeof message.id === "string" &&
			typeof message.action === "string"
		) {
			const callId = message.id;
			const callAbort = new AbortController();
			portInFlightCalls.set(callId, callAbort);
			const handler = workerHandlerRegistry.get(message.action);
			let result: unknown;
			if (!handler) {
				result = {
					ok: false,
					error: {
						message: `Unknown worker action: ${message.action}`,
						code: "E_UNKNOWN",
					},
				};
			} else {
				try {
					const value = await handler(message.params, {
						action: message.action,
						callId: message.callId,
						runId: message.runId,
						signal: callAbort.signal,
					});
					result = callAbort.signal.aborted
						? {
								ok: false,
								error: { message: "Relay aborted", code: "E_ABORT" },
							}
						: { ok: true, value };
				} catch (error: unknown) {
					result = {
						ok: false,
						error: {
							message: error instanceof Error ? error.message : String(error),
							code: callAbort.signal.aborted ? "E_ABORT" : "E_WORKER_HANDLER",
						},
					};
				}
			}
			portInFlightCalls.delete(callId);
			if (
				!safePortPost(port, { type: "registryCallResult", id: callId, result })
			) {
				resolveAsyncRelayResult(callId, {
					ok: false,
					error: {
						message: "Failed to deliver worker handler response",
						code: "E_PORT",
					},
				});
			}
		}
	});
	port.start?.();
}

export function resolveAsyncRelayResult(id: string, result: unknown): boolean {
	logger.trace("resolveAsyncRelayResult", { id });
	const pending = pendingRelays.get(id);
	if (pending) {
		pending.settle(result);
		return true;
	}
	logger.warn("asyncRelayResult_no_pending_relay", { id });
	return false;
}

function resolvePort(owner: string): RelayPort | null {
	if (owner === "main-thread" || owner === "content-script") {
		return self;
	}
	const port = workerPortRegistry.get(owner);
	if (port) {
		return port;
	}
	return null;
}

export function safePostAsCall(options: {
	owner: string;
	action: string;
	timeoutMs?: number;
	resolveTimeoutMs?: (params: unknown) => number;
	tabPolicy?: string;
}): (
	params: unknown,
	context?: { callId?: number; runId?: string; signal?: AbortSignal },
) => Promise<unknown> {
	const { owner, action, tabPolicy, resolveTimeoutMs } = options;
	const baseTimeoutMs = options.timeoutMs ?? DEFAULT_RELAY_TIMEOUT_MS;
	return (params: unknown, context?) => {
		logger.trace("safePostAsCall_invoke", {
			owner,
			action,
			callId: context?.callId,
			runId: context?.runId,
		});
		const timeoutMs = resolveTimeoutMs?.(params) ?? baseTimeoutMs;
		return new Promise((resolve, reject) => {
			if (context?.signal?.aborted) {
				const abortError = new Error(`Relay aborted for action: ${action}`);
				(abortError as Error & { code: string }).code = "E_ABORT";
				reject(abortError);
				return;
			}
			const port = resolvePort(owner);
			if (!port) {
				reject(new Error(`No port available for action: ${action}`));
				return;
			}
			if (pendingRelays.size >= MAX_PENDING_RELAYS) {
				reject(
					new Error(
						`Too many pending calls (${MAX_PENDING_RELAYS} limit exceeded). ` +
							`Action: ${action}`,
					),
				);
				return;
			}
			const relayId = generateId();
			let settled = false;
			const settle = (fn: () => void) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeoutId);
				if (context?.signal) {
					context.signal.removeEventListener("abort", onAbort);
				}
				pendingRelays.delete(relayId);
				fn();
			};

			const cancelRemoteExecution = () => {
				cancelRemoteRelay(relayId, owner, port);
			};

			const onAbort = () => {
				cancelRemoteExecution();
				const abortError = new Error(`Relay aborted for action: ${action}`);
				(abortError as Error & { code: string }).code = "E_ABORT";
				settle(() => reject(abortError));
			};

			if (context?.signal) {
				context.signal.addEventListener("abort", onAbort);
			}

			const timeoutId = setTimeout(() => {
				cancelRemoteExecution();
				settle(() => reject(new Error(`Relay timeout for action: ${action}`)));
			}, timeoutMs);

			pendingRelays.set(relayId, {
				settle: (result: unknown) => settle(() => resolve(result)),
				timeoutId,
				abort: onAbort,
				owner,
				port,
			});
			const runId = context?.runId;
			const callId = context?.callId;
			if (
				!safePortPost(port, {
					type:
						owner === "main-thread" || owner === "content-script"
							? "asyncRelay"
							: "registryCall",
					id: relayId,
					owner,
					action,
					params,
					callId,
					tabPolicy,
					command: { action, params, runId, callId },
					runId,
				})
			) {
				settle(() =>
					reject(new Error(`Failed to post relay for action: ${action}`)),
				);
			}
		});
	};
}

const WORKER_CONTEXT_ID = "worker";
export const DEFAULT_RELAY_TIMEOUT_MS = 30_000;
const RELAY_TIMEOUT_MARGIN_MS = 5_000;
/** Must match CONTENT_SCRIPT_GRACE_MS in main/runner/lib/constants.ts */
const CONTENT_SCRIPT_GRACE_MS = 500;

const TIMEOUT_PARAM_FIELD_BY_ACTION: Record<string, "timeout" | "duration"> = {
	page_goto: "timeout",
	page_wait_for: "timeout",
	tab_wait_for_load: "timeout",
	fetch: "timeout",
	sleep: "duration",
	page_wait: "duration",
	sidepanel_wait: "duration",
};

/** Actions whose handlers may consume multiple timeout-sized phases. */
const COMPOUND_TIMEOUT_ACTIONS = new Set(["page_goto"]);

function extractParamTimeoutMs(
	params: unknown,
	field: "timeout" | "duration",
): number | null {
	if (params === null || typeof params !== "object" || Array.isArray(params)) {
		return null;
	}
	const value = (params as Record<string, unknown>)[field];
	if (typeof value === "bigint") return Number(value);
	if (typeof value === "number" && Number.isFinite(value)) return value;
	return null;
}

function relayBudgetForParamTimeout(
	action: string,
	paramTimeout: number,
): number {
	if (COMPOUND_TIMEOUT_ACTIONS.has(action)) {
		// page_goto: waitForTabLoad(timeout) + [waitForNetworkIdle(timeout)] + pingTabContentScript(timeout) + grace
		return paramTimeout * 3 + CONTENT_SCRIPT_GRACE_MS + RELAY_TIMEOUT_MARGIN_MS;
	}
	return paramTimeout + RELAY_TIMEOUT_MARGIN_MS;
}

const SET_FILES_RELAY_TIMEOUT_MS = 60_000;

export function resolveRelayTimeoutMs(action: string, params: unknown): number {
	if (SET_FILES_ACTIONS.has(action)) {
		return SET_FILES_RELAY_TIMEOUT_MS;
	}
	const field = TIMEOUT_PARAM_FIELD_BY_ACTION[action];
	if (!field) return DEFAULT_RELAY_TIMEOUT_MS;
	let paramTimeout = extractParamTimeoutMs(params, field);
	if (paramTimeout === null && COMPOUND_TIMEOUT_ACTIONS.has(action)) {
		paramTimeout = DEFAULT_RELAY_TIMEOUT_MS;
	}
	if (paramTimeout === null) return DEFAULT_RELAY_TIMEOUT_MS;
	return Math.max(
		DEFAULT_RELAY_TIMEOUT_MS,
		relayBudgetForParamTimeout(action, paramTimeout),
	);
}

async function maybeResolveSetFilesParams(
	action: string,
	params: unknown,
	runId?: string,
): Promise<
	| { ok: true; params: unknown }
	| { ok: false; error: { message: string; code: string; category?: string } }
> {
	if (!SET_FILES_ACTIONS.has(action)) {
		return { ok: true, params };
	}
	if (!session) {
		return {
			ok: false,
			error: { message: "Session not initialized", code: "E_INTERNAL" },
		};
	}
	const resolved = await resolveSetFilesParams(
		action,
		params,
		runId,
		async (path) => {
			const wasmCached = take_cached_vfs_write_base64(path);
			if (wasmCached !== undefined) {
				return wasmCached;
			}
			const cached = takeCachedVfsWriteBase64(path);
			if (cached !== undefined) {
				return cached;
			}
			const handler = workerHandlerRegistry.get("readBase64");
			if (!handler) {
				throw new Error("readBase64 handler not registered");
			}
			const result = (await handler({ path })) as { data: string };
			return result.data;
		},
	);
	if (!resolved.ok) {
		return resolved;
	}
	return { ok: true, params: resolved.value };
}

export function extensionDispatch(
	params: unknown,
	context?: DispatchContext,
): Promise<unknown> {
	params = coerceWasmParams(params);
	const action = context?.action;
	logger.trace("extensionDispatch", {
		action,
		callId: context?.callId,
		runId: context?.runId,
	});
	if (!action) {
		return Promise.resolve({
			ok: false,
			error: {
				message: "Missing action in dispatch context",
				code: "E_MISSING_ACTION",
			},
		});
	}

	const originalParams = params;
	return (async () => {
		const prepared = await maybeResolveSetFilesParams(
			action,
			params,
			context?.runId,
		);
		if (!prepared.ok) {
			return prepared;
		}
		params = prepared.params;

		if (workerHandlerRegistry.has(action)) {
			const handler = workerHandlerRegistry.get(action)!;
			const signal =
				context?.signal ??
				(context?.runId
					? runAbortControllers.get(context.runId)?.signal
					: undefined);
			return (async () => {
				try {
					const value = await handler(params, { ...context, signal });
					return { ok: true, value };
				} catch (error: unknown) {
					const message =
						error instanceof Error ? error.message : String(error);
					const code =
						typeof error === "object" &&
						error !== null &&
						"code" in error &&
						typeof error.code === "string"
							? error.code
							: "E_WORKER_HANDLER";
					return { ok: false, error: { message, code } };
				}
			})();
		}

		const route = getRoute(action);
		if (!route) {
			return Promise.resolve({
				ok: false,
				error: {
					message: `No route registered for action: ${action}`,
					code: "E_NO_ROUTE",
				},
			});
		}

		const remoteCall = safePostAsCall({
			owner: route.endpoint,
			action,
			resolveTimeoutMs: (relayParams) =>
				resolveRelayTimeoutMs(action, relayParams),
			tabPolicy: route.tabPolicy,
		});
		const result = await remoteCall(params, {
			...context,
			signal:
				context?.signal ??
				(context?.runId
					? runAbortControllers.get(context.runId)?.signal
					: undefined),
		});
		if (
			FETCH_STORE_ACTIONS.has(action) &&
			typeof result === "object" &&
			result !== null &&
			"ok" in result &&
			(result as { ok: boolean }).ok
		) {
			const okResult = result as { ok: true; value: unknown };
			return {
				ok: true,
				value: maybeStoreFetchResult(
					originalParams,
					okResult.value,
					context?.runId,
				),
			};
		}
		return result;
	})();
}

export function createExecutableCallback(
	entry: SerializableJsCallManifestEntry,
): (
	params: unknown,
	context?: { callId?: number; runId?: string; signal?: AbortSignal },
) => Promise<unknown> {
	if (entry.owner === WORKER_CONTEXT_ID) {
		// Same worker - look up handler from worker-local registry
		const handler = workerHandlerRegistry.get(entry.action);
		if (!handler) {
			throw new Error(
				`No worker-local handler registered for action: ${entry.action}`,
			);
		}
		return async (params, context) => {
			params = coerceWasmParams(params);
			const signal =
				context?.signal ??
				(context?.runId
					? runAbortControllers.get(context.runId)?.signal
					: undefined);
			try {
				const value = await handler(params, {
					...context,
					action: entry.action,
					signal,
				});
				return { ok: true, value };
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				const code =
					typeof error === "object" &&
					error !== null &&
					"code" in error &&
					typeof error.code === "string"
						? error.code
						: entry.errorCode;
				return { ok: false, error: { message, code } };
			}
		};
	} else {
		// Remote context (main thread, another worker, etc.)
		const remoteCall = safePostAsCall({
			owner: entry.owner,
			action: entry.action,
			resolveTimeoutMs: (relayParams) =>
				resolveRelayTimeoutMs(entry.action, relayParams),
		});
		return async (params, context) => {
			const originalParams = coerceWasmParams(params);
			const prepared = await maybeResolveSetFilesParams(
				entry.action,
				originalParams,
				context?.runId,
			);
			if (!prepared.ok) {
				return prepared;
			}
			try {
				const result = await remoteCall(prepared.params, {
					...context,
					signal:
						context?.signal ??
						(context?.runId
							? runAbortControllers.get(context.runId)?.signal
							: undefined),
				});
				if (
					typeof result === "object" &&
					result !== null &&
					"ok" in result &&
					(result as { ok: boolean }).ok &&
					FETCH_STORE_ACTIONS.has(entry.action)
				) {
					const okResult = result as { ok: true; value: unknown };
					return {
						ok: true,
						value: maybeStoreFetchResult(
							originalParams,
							okResult.value,
							context?.runId,
						),
					};
				}
				return result;
			} catch (error: unknown) {
				const message =
					error instanceof Error ? error.message : String(error);
				const code =
					typeof error === "object" &&
					error !== null &&
					"code" in error &&
					typeof (error as { code?: unknown }).code === "string"
						? (error as { code: string }).code
						: entry.errorCode || "E_RELAY";
				return { ok: false, error: { message, code } };
			}
		};
	}
}

function initFsRegistry(s: ExtensionSession) {
	registerWorkerHandlerValidated("exists", schemas.FsPathParamsSchema, (p) =>
		s.fsExists(p as FsActionMap["exists"]["params"]),
	);
	registerWorkerHandlerValidated("stat", schemas.FsPathParamsSchema, (p) =>
		s.fsStat(p as FsActionMap["stat"]["params"]),
	);
	registerWorkerHandlerValidated("read", schemas.FsPathParamsSchema, (p) =>
		s.fsRead(p as FsActionMap["read"]["params"]),
	);
	registerWorkerHandlerValidated("readText", schemas.FsPathParamsSchema, (p) =>
		s.fsReadText(p as FsActionMap["readText"]["params"]),
	);
	registerWorkerHandlerValidated(
		"readBase64",
		schemas.FsPathParamsSchema,
		(p) => s.fsReadBase64(p as FsActionMap["readBase64"]["params"]),
	);
	registerWorkerHandlerValidated("list", schemas.FsPathParamsSchema, (p) =>
		s.fsList(p as FsActionMap["list"]["params"]),
	);
	registerWorkerHandlerValidated("mkdir", schemas.FsPathParamsSchema, (p) =>
		s.fsMkdir(p as FsActionMap["mkdir"]["params"]),
	);
	registerWorkerHandlerValidated("delete", schemas.FsPathParamsSchema, (p) =>
		s.fsDelete(p as FsActionMap["delete"]["params"]),
	);
	registerWorkerHandlerValidated("copy", schemas.FsCopyParamsSchema, (p) =>
		s.fsCopy(p as FsActionMap["copy"]["params"]),
	);
	registerWorkerHandlerValidated("move", schemas.FsCopyParamsSchema, (p) =>
		s.fsMove(p as FsActionMap["move"]["params"]),
	);
	registerWorkerHandlerValidated("write", schemas.FsWriteParamsSchema, (p) =>
		s.fsWrite(p as FsActionMap["write"]["params"]),
	);
	registerWorkerHandlerValidated(
		"writeText",
		schemas.FsWriteParamsSchema,
		(p) => s.fsWriteText(p as FsActionMap["writeText"]["params"]),
	);
	registerWorkerHandlerValidated(
		"writeBase64",
		schemas.FsWriteParamsSchema,
		async (p) => {
			const params = p as FsActionMap["writeBase64"]["params"];
			cacheVfsWriteBase64(params.path, params.data);
			return s.fsWriteBase64(params);
		},
	);
	registerWorkerHandlerValidated("append", schemas.FsWriteParamsSchema, (p) =>
		s.fsAppend(p as FsActionMap["append"]["params"]),
	);
	registerWorkerHandlerValidated(
		"appendText",
		schemas.FsWriteParamsSchema,
		(p) => s.fsAppendText(p as FsActionMap["appendText"]["params"]),
	);
	registerWorkerHandlerValidated(
		"appendBase64",
		schemas.FsWriteParamsSchema,
		(p) => s.fsAppendBase64(p as FsActionMap["appendBase64"]["params"]),
	);
	registerWorkerHandlerValidated(
		"readRange",
		schemas.FsReadRangeParamsSchema,
		(p) => s.fsReadRange(p as FsActionMap["readRange"]["params"]),
	);
	registerWorkerHandlerValidated("update", schemas.FsUpdateParamsSchema, (p) =>
		s.fsUpdate(p as FsActionMap["update"]["params"]),
	);
	registerWorkerHandlerValidated("hash", schemas.FsHashParamsSchema, (p) =>
		s.fsHash(p as FsActionMap["hash"]["params"]),
	);
}

async function initWasm(
	manifest: SerializableJsCallManifestEntry[],
	extensionId?: string,
) {
	if (initialized) return;
	await init();
	session = new ExtensionSession();
	const DEFAULT_WASM_LOG_LEVEL = 0; // trace
	setWasmLogLevel(DEFAULT_WASM_LOG_LEVEL);
	registerWasmSetLogLevel(setWasmLogLevel);
	logger.trace("initWasm_start");
	initFsRegistry(session);

	populateRoutesFromManifest(manifest);

	const batch = manifest.map((entry) => ({
		entry: manifestEntryToWasm(entry),
		callback: createExecutableCallback(entry),
	}));
	try {
		register_js_call_batch(batch);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Registry registration failed: ${message}`);
	}

	// Freeze the Rust registry before injecting bindings
	const { freezeManifest } = await import("./extension_js.js");
	try {
		freezeManifest();
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Manifest freeze failed: ${message}`);
	}

	// Inject bindings after all manifest entries are registered
	session.injectRegistryBindings();
	if (extensionId) {
		const idLiteral = JSON.stringify(extensionId);
		await session.runCellAsync(
			`(function(){var r=globalThis.chrome&&globalThis.chrome.runtime;if(!r){r={};if(!globalThis.chrome)globalThis.chrome={};globalThis.chrome.runtime=r;}r.id=${idLiteral};})();`,
			"",
			"inject-runtime-id",
		);
	}
	initialized = true;
	logger.trace("initWasm_done");
}

export type WorkerMessage =
	| {
			type: "init";
			manifest: SerializableJsCallManifestEntry[];
			extensionId?: string;
	  }
	| { type: "runCell"; id: string; code: string; stdin: string; runId?: string }
	| { type: "reset"; id?: string }
	| { type: "stop"; id: string }
	| { type: "setFuelLimit"; id?: string; limit: number }
	| { type: "inspectGlobals"; id: string }
	| { type: "apiDocs"; id: string; format: string }
	| { type: "loadLibrary"; id: string; source: string }
	| { type: "fsCall"; id: string; action: string; params: unknown }
	| { type: "setLogLevel"; level: number }
	| { type: "asyncRelayResult"; id: string; result: unknown; callId?: number }
	| { type: "registerWorkerPort"; owner: string };

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
	const msg = e.data;
	logger.trace("onmessage", {
		type: msg.type,
		id: "id" in msg ? msg.id : undefined,
	});

	if (msg.type === "asyncRelayResult") {
		logger.trace("asyncRelayResult", { id: msg.id });
		resolveAsyncRelayResult(msg.id, msg.result);
		return;
	}

	if (msg.type === "registerWorkerPort") {
		const port = e.ports[0];
		if (!port) {
			logger.error("register_worker_port_missing", { owner: msg.owner });
			return;
		}
		registerWorkerPort(msg.owner, port);
		return;
	}

	if (msg.type === "init") {
		try {
			await initWasm(msg.manifest, msg.extensionId);
			self.postMessage({ type: "ready" });
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			logger.error("worker_init_failed", { error: message });
			self.postMessage({
				type: "error",
				error: `WASM init failed: ${message}`,
			});
		}
		return;
	}

	if (msg.type === "setLogLevel") {
		setWasmLogLevel(msg.level);
		setLogLevel(mapNumericLevel(msg.level));
		logger.trace("set_log_level", { level: msg.level });
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

	const activeSession = session;

	await enqueueSessionWork(async () => {
		switch (msg.type) {
			case "runCell": {
				const runId = msg.runId;
				const runAbortController = new AbortController();
				if (runId) runAbortControllers.set(runId, runAbortController);
				activeRunCell = { id: msg.id, runId };
				logger.trace("runCell_start", {
					runId,
					callId: msg.id,
					codeLen: msg.code.length,
				});
				try {
					const result = await activeSession.runCellAsync(
						msg.code,
						msg.stdin || "",
						runId || "",
					);
					logger.trace("runCell_done", {
						runId,
						callId: msg.id,
						status: result.status,
					});
					self.postMessage({
						type: "result",
						id: msg.id,
						data: result,
						runId,
					});
				} catch (err: unknown) {
					const message = err instanceof Error ? err.message : String(err);
					const name = err instanceof Error ? err.name : undefined;
					const stack = err instanceof Error ? err.stack : undefined;
					let line: number | undefined;
					if (stack) {
						const match = stack.match(/:(\d+):\d+\)?$/m);
						if (match) line = parseInt(match[1], 10);
					}
					logger.error("runCell_error", { runId, error: message, name, line });
					const errorPayload =
						err instanceof Error
							? {
									name,
									message,
									stack,
									...(line !== undefined ? { line } : {}),
								}
							: { message };
					self.postMessage({
						type: "error",
						id: msg.id,
						error: errorPayload,
						runId,
					});
				} finally {
					if (activeRunCell?.id === msg.id) {
						activeRunCell = null;
					}
					if (runId) {
						runAbortControllers.delete(runId);
						clearRun(runId);
					}
				}
				break;
			}
			case "reset": {
				activeSession.setAborted(true);
				for (const controller of runAbortControllers.values())
					controller.abort();
				runAbortControllers.clear();
				clearAllBlobStores();
				clearVfsWriteCache();
				clear_vfs_write_cache();
				settleAllPendingRelays("E_RESET", "Worker reset");
				try {
					activeSession.reset();
					self.postMessage({ type: "result", id: msg.id, data: { ok: true } });
				} catch (err: unknown) {
					const message = err instanceof Error ? err.message : String(err);
					self.postMessage({ type: "error", id: msg.id, error: message });
				}
				break;
			}
			case "stop": {
				activeSession.setAborted(true);
				for (const controller of runAbortControllers.values())
					controller.abort();
				runAbortControllers.clear();
				clearAllBlobStores();
				settleAllPendingRelays("E_STOPPED", "Worker stopped");
				self.postMessage({ type: "result", id: msg.id, data: { ok: true } });
				break;
			}
			case "setFuelLimit": {
				try {
					activeSession.set_fuel_limit(msg.limit);
					if (msg.id) {
						self.postMessage({
							type: "result",
							id: msg.id,
							data: { ok: true },
						});
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
					const snap = activeSession.inspect_globals();
					self.postMessage({ type: "result", id: msg.id, data: snap });
				} catch (err: unknown) {
					const message = err instanceof Error ? err.message : String(err);
					self.postMessage({ type: "error", id: msg.id, error: message });
				}
				break;
			}
			case "apiDocs": {
				try {
					const result = activeSession.apiDocs(msg.format);
					self.postMessage({ type: "result", id: msg.id, data: result });
				} catch (err: unknown) {
					const message = err instanceof Error ? err.message : String(err);
					self.postMessage({ type: "error", id: msg.id, error: message });
				}
				break;
			}
			case "loadLibrary": {
				try {
					const result = activeSession.load_library(msg.source);
					self.postMessage({ type: "result", id: msg.id, data: result });
				} catch (err: unknown) {
					const message = err instanceof Error ? err.message : String(err);
					self.postMessage({ type: "error", id: msg.id, error: message });
				}
				break;
			}
			case "fsCall": {
				const handler = workerHandlerRegistry.get(msg.action);
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
			default: {
				const _exhaustive: never = msg;
				logger.error("unhandled_worker_message", {
					type: (msg as WorkerMessage).type,
				});
				break;
			}
		}
	});
};
