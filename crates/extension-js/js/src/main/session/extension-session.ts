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
import type { FsAction, FsActionMap } from "../../shared/fs-types.js";
import { logger } from "../../shared/logger.js";
import type { Command } from "../../shared/registry/manifest.js";
import {
	executeMainThreadCommand,
	isValidMainThreadAction,
	setRunnerAbortController,
} from "../runner/runtime.js";
import { unwrapContentScriptMessage } from "../../shared/registry/content-script-response.js";
import {
	initTabContext,
	removeTabContextListeners,
	resolveTabId,
} from "../tab-context.js";
import type { TabPolicy } from "../../shared/registry/types.js";
import type { SerializableJsCallManifestEntry } from "../../shared/tool-registry.js";

export interface JsApiDoc {
	namespace: string;
	name: string;
	action: string | null;
	description: string;
	params: {
		name: string;
		js_type: string;
		required: boolean;
		description: string;
	}[];
	returns: {
		js_type: string;
		description: string;
	};
	source: string;
}

type WorkerRequest =
	| { type: "runCell"; id: string; code: string; stdin: string; runId?: string }
	| { type: "reset"; id?: string }
	| { type: "stop"; id: string }
	| { type: "setFuelLimit"; id?: string; limit: number }
	| { type: "inspectGlobals"; id: string }
	| { type: "loadLibrary"; id: string; source: string }
	| { type: "setLogLevel"; level: number }
	| { type: "asyncRelayResult"; id: string; result: unknown }
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
	| { type: "error"; id?: string; error: string; runId?: string }
	| { type: "ready" };

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
		setRunnerAbortController(new AbortController());
		if (typeof chrome !== "undefined" && chrome.runtime?.id) {
			initTabContext(chrome);
		}

		// 2. Freeze registry
		const { freezeJsRegistry } = await import("../../shared/tool-registry.js");
		freezeJsRegistry();

		// 3. Get manifest
		const { getSerializableJsManifest } = await import("../../shared/tool-registry.js");
		const manifest = getSerializableJsManifest();

		// 4. Create session and start worker with manifest
		const session = new ExtensionSession();
		const [ready, runner] = session.startWorker(manifest);
		await ready;
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
					readyReject(new Error(msg.error || "Worker init error"));
					break;
				}
			}
		};

		// Send init message with manifest so the worker can register JS APIs
		w.postMessage({ type: "init", manifest });

		return [readyPromise, runnerPromise];
	}

	private handleWorkerMessage(e: MessageEvent<WorkerResponse>) {
		const msg = e.data;
		switch (msg.type) {
			case "result": {
				const callId = msg.id;
				if (!callId) break;
				const pending = this.pendingCalls.get(callId);
				if (pending) {
					this.pendingCalls.delete(callId);
					// Intentionally omit msg.data from logs to avoid leaking large or sensitive cell outputs.
					logger.debug("result", { callId, runId: msg.runId });
					pending.resolve(msg.data);
				}
				break;
			}
			case "error": {
				const callId = msg.id;
				if (callId) {
					const pending = this.pendingCalls.get(callId);
					if (pending) {
						this.pendingCalls.delete(callId);
						pending.reject(new Error(msg.error || "Worker error"));
						break;
					}
				}
				// Global worker errors without a matching call
				logger.error("worker_error", { error: msg.error });
				break;
			}
		case "ready": {
			// "ready" is handled during initialization in startWorker; after that it is a no-op.
			break;
		}
		case "relayCancel": {
			if (!msg.id) break;
			this.inFlightRelays.get(msg.id)?.abort();
			break;
		}
		case "asyncRelay": {
			if (!msg.id || !msg.command) break;
			const cmdObj = msg.command;
			if (typeof cmdObj !== "object" || cmdObj === null || !("action" in cmdObj)) {
				logger.warn("asyncRelay_invalid_command", { id: msg.id });
				this.worker?.postMessage({
					type: "asyncRelayResult",
					id: msg.id,
					result: { ok: false, error: { message: "Invalid relay command", code: "E_INVALID_COMMAND" } },
				});
				break;
			}
			const action = String((cmdObj as Record<string, unknown>).action);
			const owner = msg.owner ?? "main-thread";
			const tabPolicy = msg.tabPolicy ?? "active";
			const relayId = msg.id;
			const relayAbort = new AbortController();
			this.inFlightRelays.set(relayId, relayAbort);
			logger.debug("asyncRelay", { action, owner, id: relayId, runId: msg.runId, tabPolicy });
			const cmd = cmdObj as Command;
			// Mutate the relayed command in-place to attach the correlation ID.
			// The command object originates from WASM and is discarded after this call.
			cmd.runId = msg.runId;
			this.executeContextCommand(owner, cmd, tabPolicy, relayId, relayAbort.signal)
				.then((result) => {
					if (relayAbort.signal.aborted) {
						return;
					}
					logger.debug("asyncRelayResult", {
						action,
						id: relayId,
						resultType: typeof result,
					});
					try {
						this.worker?.postMessage({
							type: "asyncRelayResult",
							id: relayId,
							result,
						});
					} catch (postErr: unknown) {
						const message = postErr instanceof Error ? postErr.message : String(postErr);
						logger.error("asyncRelayResult_post_failed", { action, id: relayId, error: message });
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
						});
					} catch (postErr: unknown) {
						const postMessage = postErr instanceof Error ? postErr.message : String(postErr);
						logger.error("asyncRelayResult_post_failed", { action, id: relayId, error: postMessage });
					}
				})
				.finally(() => {
					this.inFlightRelays.delete(relayId);
				});
			break;
		}
		default: {
			const _exhaustive: never = msg;
			logger.error("unhandled_worker_response", { type: (msg as WorkerResponse).type });
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
					error: { message: `Unknown action: ${cmd.action}`, code: "E_UNKNOWN" },
				});
			}
			return executeMainThreadCommand(cmd, signal);
		}
		if (owner === "content-script") {
			return this.executeContentScriptCommand(cmd, tabPolicy, relayId, signal);
		}
		return Promise.resolve({
			ok: false,
			error: { message: `Unknown execution context: ${owner}`, code: "E_UNKNOWN_CONTEXT" },
		});
	}

	registerWorkerRelayPort(owner: string, port: MessagePort): void {
		if (!this.worker || this.disposed) {
			throw new Error("ExtensionSession is not initialized or has been stopped");
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
			const message = err instanceof Error ? err.message : String(err);
			return {
				ok: false,
				error: { message, code: "E_NO_TAB", category: "resource" },
			};
		}

		let cancelled = false;
		const onAbort = () => {
			cancelled = true;
			if (!relayId) return;
			void chromeApi.tabs
				.sendMessage(tabId, { type: "registryCallCancel", id: relayId })
				.catch(() => {});
		};
		signal?.addEventListener("abort", onAbort, { once: true });

		try {
			const result = await chromeApi.tabs.sendMessage(tabId, {
				type: "registryCall",
				id: relayId,
				action: cmd.action,
				params: cmd.params,
				callId: cmd.call_id,
				runId: cmd.runId,
			});
			if (cancelled) {
				return {
					ok: false,
					error: { message: "Relay aborted", code: "E_ABORT" },
				};
			}
			return unwrapContentScriptMessage(result);
		} catch (err: unknown) {
			if (cancelled || signal?.aborted) {
				return {
					ok: false,
					error: { message: "Relay aborted", code: "E_ABORT" },
				};
			}
			const message = err instanceof Error ? err.message : String(err);
			return {
				ok: false,
				error: { message, code: "E_CONTENT_SCRIPT", category: "resource" },
			};
		} finally {
			signal?.removeEventListener("abort", onAbort);
		}
	}

	private postAndWait<T>(msg: WorkerRequest & { id: string }): Promise<T> {
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

	async runCellAsync(code: string, stdin?: string): Promise<CellResult> {
		const id = this.generateId();
		const runId = this.generateId();
		return this.postAndWait({
			type: "runCell",
			id,
			code,
			stdin: stdin || "",
			runId,
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
