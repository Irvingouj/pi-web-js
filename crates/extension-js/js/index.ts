// JS wrapper for @pi-oxide/extension-js
// Provides init() / stop_with() lifecycle API.
// ExtensionSession.init() spawns the Worker internally, starts the main-thread
// runner loop, and returns a proxy + runner promise.

import type { CellResult, WasmGlobalsSnapshot } from "./extension_js.js";
import { logger } from "./logger.js";
import type { Command } from "./runner.js";
import {
  executeMainThreadCommand,
  registerHostHandler,
  registerHostHandlers,
  removeExtensionListeners,
  setRunnerAbortController,
} from "./runner.js";

export type {
  CellResult as JsRunResult,
  WasmGlobalsSnapshot as JsGlobalsSnapshot,
};
export { registerHostHandler, registerHostHandlers };
export { generateApiDocs } from "./extension_js.js";

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

interface WorkerMessage {
  type: string;
  id?: string;
  code?: string;
  stdin?: string;
  source?: string;
  command?: unknown;
  data?: unknown;
  result?: unknown;
  error?: string;
  limit?: number;
}

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

    w.onmessage = async (e: MessageEvent<WorkerMessage>) => {
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

  private handleWorkerMessage(e: MessageEvent<WorkerMessage>) {
    const msg = e.data;
    switch (msg.type) {
      case "result": {
        const callId = msg.id;
        if (!callId) break;
        const pending = this.pendingCalls.get(callId);
        if (pending) {
          this.pendingCalls.delete(callId);
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
        logger.error("[extension-js worker]", msg.error);
        break;
      }
      case "asyncRelay": {
        if (!msg.id || !msg.command) break;
        const action = (msg.command as Record<string, unknown>)?.action;
        logger.debug(
          "[ExtensionSession] asyncRelay action:",
          action,
          "id:",
          msg.id,
        );
        executeMainThreadCommand(msg.command as Command)
          .then((result) => {
            logger.debug(
              "[ExtensionSession] asyncRelayResult action:",
              action,
              "resultType:",
              typeof result,
            );
            this.worker?.postMessage({
              type: "asyncRelayResult",
              id: msg.id,
              result,
            });
          })
          .catch((err: Error | unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(
              "[ExtensionSession] asyncRelay error action:",
              action,
              "msg:",
              message,
            );
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

  private postAndWait<T>(
    msg: Omit<WorkerMessage, "id"> & { id: string },
  ): Promise<T> {
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
    return this.postAndWait({ type: "runCell", id, code, stdin: stdin || "" });
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
      logger.warn("ExtensionSession runner rejected during stop:", e);
    }
  }

  private generateId(): string {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}
