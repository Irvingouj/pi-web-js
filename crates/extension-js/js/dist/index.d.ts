import type { CellResult, WasmGlobalsSnapshot } from "./extension_js.js";
import { registerHostHandler, registerHostHandlers } from "./runner.js";
export type { CellResult as JsRunResult, WasmGlobalsSnapshot as JsGlobalsSnapshot, };
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
/**
 * ExtensionSession proxy that lives on the main thread.
 * The actual WASM ExtensionSession runs inside a Web Worker;
 * this proxy forwards calls via postMessage and awaits responses.
 */
export declare class ExtensionSession {
    private worker;
    private pendingCalls;
    private disposed;
    private onCleanupComplete;
    private abortController;
    private constructor();
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
    static init(): Promise<[ExtensionSession, Promise<void>]>;
    private startWorker;
    private handleWorkerMessage;
    private postAndWait;
    runCellAsync(code: string, stdin?: string): Promise<CellResult>;
    reset(): Promise<void>;
    inspectGlobals(): Promise<WasmGlobalsSnapshot>;
    setFuelLimit(limit: number): void;
    loadLibrary(source: string): Promise<CellResult>;
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
    stopWith(runner: Promise<void>): Promise<void>;
    private generateId;
}
