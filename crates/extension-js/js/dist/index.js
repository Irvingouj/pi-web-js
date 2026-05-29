"use strict";
// JS wrapper for @pi-oxide/extension-js
// Provides init() / stop_with() lifecycle API.
// ExtensionSession.init() spawns the Worker internally, starts the main-thread
// runner loop, and returns a proxy + runner promise.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExtensionSession = exports.generateApiDocs = exports.registerHostHandlers = exports.registerHostHandler = void 0;
const logger_js_1 = require("./logger.js");
const runner_js_1 = require("./runner.js");
Object.defineProperty(exports, "registerHostHandler", { enumerable: true, get: function () { return runner_js_1.registerHostHandler; } });
Object.defineProperty(exports, "registerHostHandlers", { enumerable: true, get: function () { return runner_js_1.registerHostHandlers; } });
var extension_js_js_1 = require("./extension_js.js");
Object.defineProperty(exports, "generateApiDocs", { enumerable: true, get: function () { return extension_js_js_1.generateApiDocs; } });
/**
 * ExtensionSession proxy that lives on the main thread.
 * The actual WASM ExtensionSession runs inside a Web Worker;
 * this proxy forwards calls via postMessage and awaits responses.
 */
class ExtensionSession {
    worker = null;
    pendingCalls = new Map();
    disposed = false;
    onCleanupComplete = null;
    abortController = null;
    constructor() { }
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
    static async init() {
        const session = new ExtensionSession();
        const [ready, runner] = session.startWorker();
        await ready;
        return [session, runner];
    }
    startWorker() {
        let readyResolve;
        let readyReject;
        const readyPromise = new Promise((resolve, reject) => {
            readyResolve = resolve;
            readyReject = reject;
        });
        let cleanupDone = () => { };
        const runnerPromise = new Promise((resolve) => {
            cleanupDone = resolve;
        });
        this.onCleanupComplete = cleanupDone;
        const w = new Worker(new URL("./worker.ts", import.meta.url), {
            type: "module",
        });
        this.worker = w;
        w.onerror = (e) => {
            readyReject(new Error(e.message));
        };
        w.onmessageerror = (e) => {
            readyReject(new Error(`Worker message deserialization error: ${e.data}`));
        };
        w.onmessage = async (e) => {
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
    handleWorkerMessage(e) {
        const msg = e.data;
        switch (msg.type) {
            case "result": {
                const callId = msg.id;
                if (!callId)
                    break;
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
                logger_js_1.logger.error("[extension-js worker]", msg.error);
                break;
            }
            case "asyncRelay": {
                if (!msg.id || !msg.command)
                    break;
                const action = msg.command?.action;
                logger_js_1.logger.debug("[ExtensionSession] asyncRelay action:", action, "id:", msg.id);
                (0, runner_js_1.executeMainThreadCommand)(msg.command)
                    .then((result) => {
                    logger_js_1.logger.debug("[ExtensionSession] asyncRelayResult action:", action, "resultType:", typeof result);
                    this.worker?.postMessage({
                        type: "asyncRelayResult",
                        id: msg.id,
                        result,
                    });
                })
                    .catch((err) => {
                    const message = err instanceof Error ? err.message : String(err);
                    logger_js_1.logger.error("[ExtensionSession] asyncRelay error action:", action, "msg:", message);
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
    postAndWait(msg) {
        const worker = this.worker;
        if (!worker || this.disposed) {
            return Promise.reject(new Error("ExtensionSession is not initialized or has been stopped"));
        }
        return new Promise((resolve, reject) => {
            this.pendingCalls.set(msg.id, {
                resolve: resolve,
                reject,
            });
            worker.postMessage(msg);
        });
    }
    async runCellAsync(code, stdin) {
        const id = this.generateId();
        return this.postAndWait({ type: "runCell", id, code, stdin: stdin || "" });
    }
    reset() {
        const id = this.generateId();
        return this.postAndWait({ type: "reset", id });
    }
    inspectGlobals() {
        const id = this.generateId();
        return this.postAndWait({ type: "inspectGlobals", id });
    }
    setFuelLimit(limit) {
        if (!this.worker || this.disposed)
            return;
        this.worker.postMessage({ type: "setFuelLimit", limit });
    }
    loadLibrary(source) {
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
    async stopWith(runner) {
        if (this.disposed)
            return;
        this.disposed = true;
        // Signal abort to interrupt in-flight runner operations
        this.abortController = new AbortController();
        (0, runner_js_1.setRunnerAbortController)(this.abortController);
        this.abortController.abort();
        // Send reset to the WASM session inside the Worker before terminating
        if (this.worker) {
            this.worker.postMessage({ type: "reset" });
        }
        // Remove Chrome listeners registered in runner.ts
        (0, runner_js_1.removeExtensionListeners)();
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
        }
        catch (e) {
            logger_js_1.logger.warn("ExtensionSession runner rejected during stop:", e);
        }
    }
    generateId() {
        return Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
}
exports.ExtensionSession = ExtensionSession;
