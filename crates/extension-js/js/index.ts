// JS wrapper for @pi-oxide/extension-js
// Provides init() / stop_with() lifecycle API.
// ExtensionSession.init() spawns the Worker internally, starts the main-thread
// runner loop, and returns a proxy + runner promise.

import type {
	CellResult,
	WasmGlobalsSnapshot,
	FsPathParams,
	FsCopyParams,
	FsWriteParams,
	FsReadRangeParams,
	FsReadRangeDataParams,
	FsHashParams,
} from "./extension_js.js";
import { logger } from "./logger.js";
import type { FsActionMap, FsAction } from "./fs-types.js";
import type { Command } from "./runner.js";
import {
	executeMainThreadCommand,
	registerHostHandler,
	registerHostHandlers,
	removeExtensionListeners,
	setRunnerAbortController,
} from "./runner.js";

export { generateApiDocs } from "./extension_js.js";
export type { LogLevel } from "./logger.js";
export { setLogLevel } from "./logger.js";
export type {
	CellResult as JsRunResult,
	WasmGlobalsSnapshot as JsGlobalsSnapshot,
};
export { registerHostHandler, registerHostHandlers };

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
	| { type: "fsCall"; id: string; action: string; params: unknown };

type WorkerResponse =
	| { type: "asyncRelay"; id: string; command: unknown; runId?: string }
	| { type: "result"; id: string; data?: unknown; runId?: string }
	| { type: "error"; id?: string; error: string; runId?: string }
	| { type: "ready" };

/**
 * ExtensionSession proxy that lives on the main thread.
 * The actual WASM ExtensionSession runs inside a Web Worker;
 * this proxy forwards calls via postMessage and awaits responses.
 */
export class ExtensionSession {
	private worker: Worker | null = null;
	private pendingCalls = new Map<
		string,
		{ resolve: (v: unknown) => void; reject: (e: Error | unknown) => void }
	>();
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
		const session = new ExtensionSession();
		const [ready, runner] = session.startWorker();
		await ready;
		return [session, runner];
	}

	private startWorker(): [Promise<void>, Promise<void>] {
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

		const w = new Worker(new URL("./worker.ts", import.meta.url), {
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
			case "asyncRelay": {
				if (!msg.id || !msg.command) break;
				const action = (msg.command as Record<string, unknown>)?.action;
				logger.debug("asyncRelay", { action, id: msg.id, runId: msg.runId });
				const cmd = msg.command as Command;
				// Mutate the relayed command in-place to attach the correlation ID.
				// The command object originates from WASM and is discarded after this call.
				cmd.runId = msg.runId;
				executeMainThreadCommand(cmd)
					.then((result) => {
						logger.debug("asyncRelayResult", {
							action,
							id: msg.id,
							resultType: typeof result,
						});
						this.worker?.postMessage({
							type: "asyncRelayResult",
							id: msg.id,
							result,
						});
					})
					.catch((err: Error | unknown) => {
						const message = err instanceof Error ? err.message : String(err);
						logger.error("asyncRelay_error", {
							action,
							id: msg.id,
							error: message,
						});
						this.worker?.postMessage({
							type: "asyncRelayResult",
							id: msg.id,
							result: {
								ok: false,
								error: { message, code: "E_RUNNER" },
							},
						});
					});
				break;
			}
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
		const self = this;
		return {
			exists: (params: FsPathParams) => self.safePost("exists", params),
			stat: (params: FsPathParams) => self.safePost("stat", params),
			read: (params: FsPathParams) => self.safePost("read", params),
			readText: (params: FsPathParams) => self.safePost("readText", params),
			readBase64: (params: FsPathParams) => self.safePost("readBase64", params),
			list: (params: FsPathParams) => self.safePost("list", params),
			mkdir: (params: FsPathParams) => self.safePost("mkdir", params),
			delete: (params: FsPathParams) => self.safePost("delete", params),
			copy: (params: FsCopyParams) => self.safePost("copy", params),
			move: (params: FsCopyParams) => self.safePost("move", params),
			write: (params: FsWriteParams) => self.safePost("write", params),
			writeText: (params: FsWriteParams) => self.safePost("writeText", params),
			writeBase64: (params: FsWriteParams) => self.safePost("writeBase64", params),
			append: (params: FsWriteParams) => self.safePost("append", params),
			appendText: (params: FsWriteParams) => self.safePost("appendText", params),
			appendBase64: (params: FsWriteParams) => self.safePost("appendBase64", params),
			readRange: (params: FsReadRangeParams) => self.safePost("readRange", params),
			update: (params: FsReadRangeDataParams) => self.safePost("update", params),
			hash: (params: FsHashParams) => self.safePost("hash", params),
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

		// Send reset to the WASM session inside the Worker before terminating
		if (this.worker) {
			this.worker.postMessage({ type: "reset" });
		}

		// Remove Chrome listeners registered in runner.ts
		removeExtensionListeners();

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
