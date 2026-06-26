// Extension session proxy on the main thread.
import "../runner/index.js";
import type {
	CellResult,
	FsCopyParams,
	FsHashParams,
	FsPathParams,
	FsReadRangeDataParams,
	FsReadRangeParams,
	FsWriteParams,
	WasmGlobalsSnapshot,
} from "../../../pkg/extension_js.js";
import type { InlineSnapshotResult } from "../../shared/cross/collect-inline-snapshot.js";
import type { FsAction, FsActionMap } from "../../shared/cross/fs-types.js";
import type { LogLevel } from "../../shared/main/logger.js";
import {
	LOG_LEVEL_NUMERIC,
	logger,
	setLogLevel as setMainLogLevel,
} from "../../shared/main/logger.js";
import { unwrapContentScriptMessage } from "../../shared/main/content-script-response.js";
import type { Command } from "../../shared/cross/manifest.js";
import { normalizeAgentError } from "../../shared/cross/normalize-agent-error.js";
import type { TabPolicy } from "../../shared/cross/types.js";
import type { SnapshotFilter } from "../../shared/cross/snapshot-filter.js";
import type { SerializableJsCallManifestEntry } from "../../shared/main/tool-registry.js";
import { CS_FAST_PING_MS } from "../runner/lib/constants.js";
import {
	executeMainThreadCommand,
	isValidMainThreadAction,
	pingTabContentScript,
	preflightDomTab,
	setRunnerAbortController,
} from "../runner/runtime.js";
import {
	executeMultiFrameSnapshot,
	isSnapshotAction,
} from "../runner/snapshot-merge.js";
import {
	initTabContext,
	removeTabContextListeners,
	resolveTabId,
} from "../tab-context.js";

type WorkerRequest =
	| { type: "runCell"; id: string; code: string; stdin: string; runId?: string }
	| { type: "reset"; id?: string }
	| { type: "stop"; id: string }
	| { type: "setFuelLimit"; id?: string; limit: number }
	| { type: "inspectGlobals"; id: string }
	| { type: "apiDocs"; id: string; format: string }
	| { type: "loadLibrary"; id: string; source: string }
	| { type: "setLogLevel"; level: number }
	| { type: "asyncRelayResult"; id: string; result: unknown; callId?: number }
	| { type: "registerWorkerPort"; owner: string }
	| { type: "fsCall"; id: string; action: string; params: unknown };

type WorkerResponse =
	| {
			type: "asyncRelay";
			id: string;
			owner?: string;
			command: unknown;
			runId?: string;
			tabPolicy?: TabPolicy;
	  }
	| { type: "relayCancel"; id: string; owner?: string }
	| { type: "result"; id: string; data?: unknown; runId?: string }
	| {
			type: "error";
			id?: string;
			error:
				| string
				| { name?: string; message: string; stack?: string; line?: number };
			runId?: string;
	  }
	| { type: "ready" };

const COMPOSITE_REFID = /^f(\d+)_(e\d+)$/;

type FrameTarget = { frameId: number; localRefId: string } | null;

function resolveFrameTarget(params: Record<string, unknown>): FrameTarget {
	const rawRefId = typeof params.refId === "string" ? params.refId : undefined;
	if (!rawRefId) return null;
	const m = rawRefId.match(COMPOSITE_REFID);
	if (!m) return null;
	return { frameId: Number.parseInt(m[1], 10), localRefId: m[2] };
}
export class ExtensionSession {
	private worker: Worker | null = null;
	private pendingCalls = new Map<
		string,
		{ resolve: (v: unknown) => void; reject: (e: Error | unknown) => void }
	>();
	private inFlightRelays = new Map<string, AbortController>();
	private disposed = false;
	private onCleanupComplete: (() => void) | null = null;
	private abortController: AbortController | null = null;
	private runQueue: Promise<void> = Promise.resolve();

	private constructor() {}

	/**
	 * Initialize the extension-js runtime.
	 * Automatically detects extension context, spawns the Worker,
	 * starts the main-thread runner loop, and returns [session, runner].
	 *
	 * The spawned Worker uses `new Worker(..., { type: "module" })`. Your bundler
	 * must support emitting module Workers as separate chunks.
	 *
	 * AbortController is module-global: only one active session per extension
	 * page is fully safe. Concurrent sessions race on the same abort signal.
	 */
	static async init(): Promise<[ExtensionSession, Promise<void>]> {
		logger.trace("init_start");
		setRunnerAbortController(new AbortController());
		if (typeof chrome !== "undefined" && chrome.runtime?.id) {
			initTabContext(chrome);
			const { initCapabilities } = await import(
				"../runner/tools/chrome/capability.js"
			);
			await initCapabilities();
		}

		// 2. Freeze registry
		const { freezeJsRegistry } = await import("../../shared/main/tool-registry.js");
		freezeJsRegistry();

		// 3. Get manifest
		const { getSerializableJsManifest } = await import(
			"../../shared/main/tool-registry.js"
		);
		const manifest = getSerializableJsManifest();

		// 4. Create session and start worker with manifest
		const session = new ExtensionSession();
		const [ready, runner] = session.startWorker(manifest);
		await ready;
		logger.trace("init_ready");
		return [session, runner];
	}

	private startWorker(
		manifest: SerializableJsCallManifestEntry[],
	): [Promise<void>, Promise<void>] {
		let readyResolve: () => void;
		let readyReject: (e: Error) => void;
		const readyPromise = new Promise<void>((resolve, reject) => {
			readyResolve = resolve;
			readyReject = reject;
		});

		let cleanupDone: () => void = () => {};
		const runnerPromise = new Promise<void>((resolve) => {
			cleanupDone = resolve;
		});
		this.onCleanupComplete = cleanupDone;

		const w = new Worker(new URL("../../worker/worker.ts", import.meta.url), {
			type: "module",
		});
		this.worker = w;

		w.onerror = (e: ErrorEvent) => {
			readyReject(new Error(e.message));
		};

		w.onmessageerror = (e: MessageEvent) => {
			readyReject(new Error(`Worker message deserialization error: ${e.data}`));
		};

		w.onmessage = async (e: MessageEvent<WorkerResponse>) => {
			const msg = e.data;
			switch (msg.type) {
				case "ready": {
					// Bind the permanent message handler
					w.onmessage = this.handleWorkerMessage.bind(this);
					readyResolve();
					break;
				}
				case "error": {
					const errMsg =
						typeof msg.error === "string"
							? msg.error
							: msg.error?.message || "Worker init error";
					readyReject(new Error(errMsg));
					break;
				}
			}
		};

		// Send init message with manifest so the worker can register JS APIs
		const extensionId =
			typeof chrome !== "undefined" && chrome.runtime?.id
				? chrome.runtime.id
				: undefined;
		w.postMessage({ type: "init", manifest, extensionId });
		logger.trace("startWorker_posted_init", {
			extensionId: extensionId ?? null,
		});

		return [readyPromise, runnerPromise];
	}

	private handleWorkerMessage(e: MessageEvent<WorkerResponse>) {
		const msg = e.data;
		logger.trace("worker_message", {
			type: msg.type,
			id: "id" in msg ? msg.id : undefined,
		});
		switch (msg.type) {
			case "result": {
				const callId = msg.id;
				if (!callId) break;
				const pending = this.pendingCalls.get(callId);
				if (pending) {
					this.pendingCalls.delete(callId);
					logger.trace("result", { callId, runId: msg.runId });
					pending.resolve(msg.data);
				} else {
					logger.trace("result_no_pending", { callId, runId: msg.runId });
				}
				break;
			}
			case "error": {
				const callId = msg.id;
				const errorPayload = msg.error;
				const errorText =
					typeof errorPayload === "string"
						? errorPayload
						: errorPayload?.message || "Worker error";
				logger.trace("error", { callId, error: errorText, runId: msg.runId });
				const enrichedError = (() => {
					if (typeof errorPayload === "object" && errorPayload !== null) {
						const e = new Error(errorPayload.message || "Worker error");
						e.name = errorPayload.name || "Error";
						if (errorPayload.stack) e.stack = errorPayload.stack;
						if (errorPayload.line)
							(e as Error & { line?: number }).line = errorPayload.line;
						return e;
					}
					return new Error(errorText);
				})();
				if (callId) {
					const pending = this.pendingCalls.get(callId);
					if (pending) {
						this.pendingCalls.delete(callId);
						pending.reject(enrichedError);
						break;
					}
				}
				// Global worker errors without a matching call
				logger.error("worker_error", { error: errorText });
				break;
			}
			case "ready": {
				// "ready" is handled during initialization in startWorker; after that it is a no-op.
				break;
			}
			case "relayCancel": {
				if (!msg.id) break;
				logger.trace("relayCancel", { id: msg.id });
				this.inFlightRelays.get(msg.id)?.abort();
				break;
			}
			case "asyncRelay": {
				if (!msg.id || !msg.command) break;
				const cmdObj = msg.command;
				if (
					typeof cmdObj !== "object" ||
					cmdObj === null ||
					!("action" in cmdObj)
				) {
					logger.warn("asyncRelay_invalid_command", { id: msg.id });
					this.worker?.postMessage({
						type: "asyncRelayResult",
						id: msg.id,
						result: {
							ok: false,
							error: {
								message: "Invalid relay command",
								code: "E_INVALID_COMMAND",
							},
						},
					});
					break;
				}
				const action = String((cmdObj as Record<string, unknown>).action);
				const owner = msg.owner ?? "main-thread";
				const tabPolicy = msg.tabPolicy ?? "active";
				const relayId = msg.id;
				const relayAbort = new AbortController();
				this.inFlightRelays.set(relayId, relayAbort);
				logger.trace("asyncRelay", {
					action,
					owner,
					id: relayId,
					runId: msg.runId,
					tabPolicy,
				});
				const cmd = cmdObj as Command;
				// Mutate the relayed command in-place to attach the correlation ID.
				// The command object originates from WASM and is discarded after this call.
				cmd.runId = msg.runId;
				this.executeContextCommand(
					owner,
					cmd,
					tabPolicy,
					relayId,
					relayAbort.signal,
				)
					.then((result) => {
						if (relayAbort.signal.aborted) {
							const completed =
								typeof result === "object" &&
								result !== null &&
								"ok" in result &&
								(result as { ok: boolean }).ok === true;
							if (!completed) {
								return;
							}
						}
						logger.trace("asyncRelayResult", {
							action,
							id: relayId,
							resultType: typeof result,
						});
						try {
							this.worker?.postMessage({
								type: "asyncRelayResult",
								id: relayId,
								result,
								callId: cmd.call_id,
							});
						} catch (postErr: unknown) {
							const message =
								postErr instanceof Error ? postErr.message : String(postErr);
							logger.error("asyncRelayResult_post_failed", {
								action,
								id: relayId,
								error: message,
							});
						}
					})
					.catch((err: Error | unknown) => {
						if (relayAbort.signal.aborted) {
							return;
						}
						const message = err instanceof Error ? err.message : String(err);
						logger.error("asyncRelay_error", {
							action,
							id: relayId,
							error: message,
						});
						try {
							this.worker?.postMessage({
								type: "asyncRelayResult",
								id: relayId,
								result: {
									ok: false,
									error: { message, code: "E_RUNNER" },
								},
								callId: cmd.call_id,
							});
						} catch (postErr: unknown) {
							const postMessage =
								postErr instanceof Error ? postErr.message : String(postErr);
							logger.error("asyncRelayResult_post_failed", {
								action,
								id: relayId,
								error: postMessage,
							});
						}
					})
					.finally(() => {
						this.inFlightRelays.delete(relayId);
					});
				break;
			}
			default: {
				const _exhaustive: never = msg;
				logger.error("unhandled_worker_response", {
					type: (msg as WorkerResponse).type,
				});
				break;
			}
		}
	}

	private executeContextCommand(
		owner: string,
		cmd: Command,
		tabPolicy: TabPolicy = "active",
		relayId?: string,
		signal?: AbortSignal,
	): Promise<unknown> {
		logger.trace("executeContextCommand", {
			owner,
			action: cmd.action,
			relayId,
			tabPolicy,
			callId: cmd.call_id,
			runId: cmd.runId,
		});
		if (signal?.aborted) {
			return Promise.resolve({
				ok: false,
				error: { message: "Relay aborted", code: "E_ABORT" },
			});
		}
		if (owner === "main-thread") {
			if (!isValidMainThreadAction(cmd.action)) {
				return Promise.resolve({
					ok: false,
					error: {
						message: `Unknown action: ${cmd.action}`,
						code: "E_UNKNOWN",
					},
				});
			}
			return this.withMainThreadTimeout(
				executeMainThreadCommand(cmd, signal),
				cmd.action,
			);
		}
		if (owner === "content-script") {
			return this.executeContentScriptCommand(cmd, tabPolicy, relayId, signal);
		}
		return Promise.resolve({
			ok: false,
			error: {
				message: `Unknown execution context: ${owner}`,
				code: "E_UNKNOWN_CONTEXT",
			},
		});
	}
	/**
	 * Race a main-thread command against a hard timeout. If the handler hangs
	 * (e.g. waitForTabLoad on a page that never reaches `complete`, or a content
	 * script that never reconnects), this converts the hang into a structured
	 * E_TIMEOUT error that the relay posts back to the worker — instead of
	 * leaving the cell's join_all awaiting forever.
	 */
	private withMainThreadTimeout<T>(
		promise: Promise<T>,
		action: string,
		timeoutMs = 120_000,
	): Promise<T | { ok: false; error: { message: string; code: string } }> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<{
			ok: false;
			error: { message: string; code: string };
		}>((resolve) => {
			timer = setTimeout(
				() =>
					resolve({
						ok: false,
						error: {
							message: `Main-thread action "${action}" timed out after ${timeoutMs}ms`,
							code: "E_TIMEOUT",
						},
					}),
				timeoutMs,
			);
		});
		return Promise.race([promise, timeout]).finally(() => {
			if (timer) clearTimeout(timer);
		});
	}

	registerWorkerRelayPort(owner: string, port: MessagePort): void {
		if (!this.worker || this.disposed) {
			throw new Error(
				"ExtensionSession is not initialized or has been stopped",
			);
		}
		this.worker.postMessage({ type: "registerWorkerPort", owner }, [port]);
	}

	private async executeContentScriptCommand(
		cmd: Command,
		tabPolicy: TabPolicy,
		relayId?: string,
		signal?: AbortSignal,
	): Promise<unknown> {
		if (signal?.aborted) {
			return {
				ok: false,
				error: { message: "Relay aborted", code: "E_ABORT" },
			};
		}
		const chromeApi = window.chrome;
		if (!chromeApi?.runtime?.id) {
			return {
				ok: false,
				error: {
					message: "Not in extension context",
					code: "E_NO_EXTENSION",
					category: "permission",
				},
			};
		}

		const params =
			typeof cmd.params === "object" && cmd.params !== null
				? (cmd.params as Record<string, unknown>)
				: {};

		let tabId: number;
		try {
			tabId = resolveTabId(tabPolicy, params);
		} catch (err: unknown) {
			return {
				ok: false,
				error: {
					message: err instanceof Error ? err.message : String(err),
					code: "E_NO_TAB",
					category: "resource",
				},
			};
		}

		let tabUrl = "";
		try {
			const tab = await chromeApi.tabs.get(tabId);
			tabUrl = tab.url ?? "";
		} catch {
			/* ignore */
		}

		const urlPreflight = await preflightDomTab(tabId);
		if (urlPreflight && !urlPreflight.ok) return urlPreflight;

		const pingResult = await pingTabContentScript(tabId, CS_FAST_PING_MS);
		if (!pingResult.ok) return pingResult;

		// --- Iframe: multi-frame snapshot fanout ---
		if (isSnapshotAction(cmd.action)) {
			return executeMultiFrameSnapshot(cmd, tabId, relayId);
		}

		// --- Resolve target frame from composite refId ---
		const target = resolveFrameTarget(params);
		const dispatchedCmd = target
			? { ...cmd, params: { ...params, refId: target.localRefId } }
			: cmd;

		return this.sendToFrame(
			chromeApi,
			dispatchedCmd,
			tabId,
			target?.frameId ?? 0,
			relayId,
			signal,
			tabUrl,
		);
	}

	/** Send a registryCall to a specific frame and unwrap the response. */
	private async sendToFrame(
		chromeApi: typeof chrome,
		cmd: Command,
		tabId: number,
		frameId: number,
		relayId: string | undefined,
		signal: AbortSignal | undefined,
		tabUrl: string,
	): Promise<unknown> {
		let cancelled = false;
		const cleanup = () => {
			signal?.removeEventListener("abort", onAbort);
		};
		const onAbort = () => {
			cancelled = true;
			if (!relayId) return;
			void chromeApi.tabs
				.sendMessage(tabId, { type: "registryCallCancel", id: relayId })
				.catch(() => {});
		};
		signal?.addEventListener("abort", onAbort, { once: true });

		try {
			const result = await chromeApi.tabs.sendMessage(
				tabId,
				{
					type: "registryCall",
					id: relayId,
					action: cmd.action,
					params: cmd.params,
					callId: cmd.call_id,
					runId: cmd.runId,
				},
				{ frameId },
			);
			const parsed = unwrapContentScriptMessage(result);
			if (cancelled && parsed.ok) return parsed;
			if (cancelled)
				return {
					ok: false,
					error: { message: "Relay aborted", code: "E_ABORT" },
				};
			return parsed;
		} catch (err: unknown) {
			if (cancelled || signal?.aborted) {
				return {
					ok: false,
					error: { message: "Relay aborted", code: "E_ABORT" },
				};
			}
			return {
				ok: false,
				error: normalizeAgentError(err, {
					tabId,
					url: tabUrl,
					action: cmd.action,
				}),
			};
		} finally {
			cleanup();
		}
	}

	private postAndWait<T>(msg: WorkerRequest & { id: string }): Promise<T> {
		logger.trace("postAndWait", {
			type: msg.type,
			id: msg.id,
			runId: "runId" in msg ? msg.runId : undefined,
		});
		const worker = this.worker;
		if (!worker || this.disposed) {
			return Promise.reject(
				new Error("ExtensionSession is not initialized or has been stopped"),
			);
		}
		return new Promise<T>((resolve, reject) => {
			this.pendingCalls.set(msg.id, {
				resolve: resolve as (v: unknown) => void,
				reject,
			});
			worker.postMessage(msg);
		});
	}

	async runCellAsync(
		code: string,
		stdin?: string,
		traceId?: string,
	): Promise<CellResult> {
		const id = this.generateId();
		const runId = traceId || this.generateId();
		const run = this.runQueue.then(async () => {
			logger.trace("runCell_start", {
				runId,
				callId: id,
				codeLen: code.length,
			});
			try {
				const result = await this.postAndWait<CellResult>({
					type: "runCell",
					id,
					code,
					stdin: stdin || "",
					runId,
				});
				logger.trace("runCell_done", {
					runId,
					callId: id,
					status: result.status,
				});
				return result;
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				logger.error("runCell_failed", { runId, callId: id, error: message });
				throw err;
			}
		});
		this.runQueue = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	setLogLevel(level: LogLevel): void {
		logger.trace("setLogLevel", { level });
		setMainLogLevel(level);
		if (!this.worker || this.disposed) return;
		this.worker.postMessage({
			type: "setLogLevel",
			level: LOG_LEVEL_NUMERIC[level],
		});
	}

	reset(): Promise<void> {
		const id = this.generateId();
		return this.postAndWait({ type: "reset", id });
	}

	inspectGlobals(): Promise<WasmGlobalsSnapshot> {
		const id = this.generateId();
		return this.postAndWait({ type: "inspectGlobals", id });
	}

	apiDocs(format: "json" | "markdown" = "json"): Promise<unknown[] | string> {
		const id = this.generateId();
		return this.postAndWait<string>({ type: "apiDocs", id, format }).then(
			(result) => {
				if (format === "json") {
					return JSON.parse(result) as unknown[];
				}
				return result;
			},
		);
	}

	setFuelLimit(limit: number): void {
		if (!this.worker || this.disposed) return;
		this.worker.postMessage({ type: "setFuelLimit", limit });
	}

	loadLibrary(source: string): Promise<CellResult> {
		const id = this.generateId();
		return this.postAndWait({ type: "loadLibrary", id, source });
	}

	private async safePost<K extends FsAction>(
		action: K,
		params: FsActionMap[K]["params"],
	): Promise<FsActionMap[K]["result"]> {
		const id = this.generateId();
		return this.postAndWait({
			type: "fsCall",
			id,
			action,
			params,
		} as WorkerRequest & { id: string });
	}

	get fs() {
		return {
			exists: (params: FsPathParams) => this.safePost("exists", params),
			stat: (params: FsPathParams) => this.safePost("stat", params),
			read: (params: FsPathParams) => this.safePost("read", params),
			readText: (params: FsPathParams) => this.safePost("readText", params),
			readBase64: (params: FsPathParams) => this.safePost("readBase64", params),
			list: (params: FsPathParams) => this.safePost("list", params),
			mkdir: (params: FsPathParams) => this.safePost("mkdir", params),
			delete: (params: FsPathParams) => this.safePost("delete", params),
			copy: (params: FsCopyParams) => this.safePost("copy", params),
			move: (params: FsCopyParams) => this.safePost("move", params),
			write: (params: FsWriteParams) => this.safePost("write", params),
			writeText: (params: FsWriteParams) => this.safePost("writeText", params),
			writeBase64: (params: FsWriteParams) =>
				this.safePost("writeBase64", params),
			append: (params: FsWriteParams) => this.safePost("append", params),
			appendText: (params: FsWriteParams) =>
				this.safePost("appendText", params),
			appendBase64: (params: FsWriteParams) =>
				this.safePost("appendBase64", params),
			readRange: (params: FsReadRangeParams) =>
				this.safePost("readRange", params),
			update: (params: FsReadRangeDataParams) =>
				this.safePost("update", params),
			hash: (params: FsHashParams) => this.safePost("hash", params),
		};
	}

	get snapshot() {
		return {
			query: async (
				filter?: SnapshotFilter,
				options?: { maxNodes?: number; tabId?: number },
			): Promise<InlineSnapshotResult> => {
				const result = await this.executeContentScriptCommand(
					{
						action: "page_snapshot_query",
						params: { filter: filter ?? {}, max_nodes: options?.maxNodes },
					},
					options?.tabId ? "required" : "active",
				);
				if (
					typeof result === "object" &&
					result !== null &&
					"ok" in result &&
					!(result as { ok: boolean }).ok
				) {
					const err = (
						result as { error?: { message?: string; code?: string } }
					).error;
					throw new Error(err?.message ?? "snapshot_query failed");
				}
				return result as InlineSnapshotResult;
			},
		};
	}

	/**
	 * Clean up the session, terminate the Worker, and release resources.
	 * Accepts the runner Promise returned by init() so it can be awaited
	 * for graceful shutdown.
	 *
	 * Sends a reset message to the Worker, then waits only 50 ms before
	 * forcefully calling worker.terminate(). If WASM cleanup takes longer,
	 * the Worker is killed mid-operation. Pending async calls are rejected
	 * with "ExtensionSession stopped".
	 */
	async stopWith(runner: Promise<void>): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;

		// Signal abort to interrupt in-flight runner operations
		this.abortController = new AbortController();
		setRunnerAbortController(this.abortController);
		this.abortController.abort();

		for (const [, relayAbort] of this.inFlightRelays) {
			relayAbort.abort();
		}
		this.inFlightRelays.clear();

		// Tell the worker to abort runs and settle every pending relay before termination.
		if (this.worker) {
			this.worker.postMessage({ type: "stop", id: this.generateId() });
		}

		removeTabContextListeners();

		// Terminate worker after a brief grace period for reset to process
		await new Promise((resolve) => setTimeout(resolve, 50));
		if (this.worker) {
			this.worker.terminate();
			this.worker = null;
		}

		// Resolve any pending calls with errors
		for (const [, pending] of this.pendingCalls) {
			pending.reject(new Error("ExtensionSession stopped"));
		}
		this.pendingCalls.clear();

		// Signal that cleanup is complete so the runner naturally resolves
		if (this.onCleanupComplete) {
			this.onCleanupComplete();
			this.onCleanupComplete = null;
		}

		// Wait for the runner to settle (catches rejection if any)
		try {
			await runner;
		} catch (e) {
			logger.warn("runner_rejected_during_stop", { error: e });
		}
	}

	private generateId(): string {
		return Math.random().toString(36).slice(2) + Date.now().toString(36);
	}
}
