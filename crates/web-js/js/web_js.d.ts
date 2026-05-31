/* tslint:disable */
/* eslint-disable */
/**
 * A single global variable observed by `inspect_globals`.
 */
export interface WasmGlobalVariable {
    name: string;
    type: string;
    value: string | null;
    keys: string[] | null;
}

/**
 * An async command yielded from JS, waiting for external resolution.
 */
export interface WasmAsyncCommand {
    call_id: number;
    action: string;
    params: unknown;
}

/**
 * Consumer-facing result of running a single cell.
 * Either success with an optional result string, or an error.
 */
export type CellResult = { status: "ok"; stdout: string[]; stderr: string[]; result: string | null; execution_count: number } | { status: "err"; stdout: string[]; stderr: string[]; error: WasmCellError; execution_count: number };

/**
 * Error details inside an async response.
 */
export interface WasmAsyncError {
    message: string;
    code: string;
}

/**
 * Response passed to `resume_cell` to resolve an async yield.
 */
export interface WasmAsyncResponse {
    ok: boolean;
    value: unknown;
    error: WasmAsyncError | null;
}

/**
 * Result of running a single cell, including async-loop state.
 * Either still pending (waiting for async resolution) or done.
 */
export type WasmRunResult = { status: "pending"; stdout: string[]; stderr: string[]; commands: unknown[]; fuel_exhausted: boolean; execution_count: number; pending_commands: WasmAsyncCommand[] } | { status: "ok"; stdout: string[]; stderr: string[]; result: string | null; execution_count: number } | { status: "err"; stdout: string[]; stderr: string[]; error: WasmCellError; execution_count: number };

/**
 * Snapshot of all JS globals.
 */
export interface WasmGlobalsSnapshot {
    variables: WasmGlobalVariable[];
    execution_count: number;
}

/**
 * Status of a cell execution.
 */
export type WasmCellStatus = "done" | "async_pending";

/**
 * Structured error from running a cell.
 */
export type WasmCellError = { kind: "compile"; message: string; line: number | null } | { kind: "runtime"; message: string; line: number | null } | { kind: "fuel_exhausted" } | { kind: "internal"; message: string };

export interface CollectOptions {
    includeHidden?: boolean;
    includeNonInteractive?: boolean;
    includeGeometry?: boolean;
    includePath?: boolean;
    maxTextLength?: number;
    maxNodes?: number;
    interactiveOnly?: boolean;
    format?: SnapshotFormat;
}

export interface OutlineNode {
    role: string;
    name: string;
    ref_id: string;
}

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export interface SemanticNode {
    refId: string;
    role: string;
    name?: string;
    description?: string;
    tag: string;
    id?: string;
    classes?: string[];
    value?: string;
    placeholder?: string;
    href?: string;
    states: States;
    inputType?: string;
    rect?: Rect;
    inViewport: boolean;
    visible: boolean;
    path?: string;
}

export interface States {
    disabled?: boolean;
    checked?: boolean;
    selected?: boolean;
    expanded?: boolean;
    pressed?: boolean;
    required?: boolean;
    readonly?: boolean;
    invalid?: boolean;
    hidden?: boolean;
    focusable?: boolean;
    interactive?: boolean;
    current?: boolean;
}

export interface TreeSnapshot {
    version: string;
    url: string | null;
    title: string | null;
    viewport: Viewport | null;
    nodes: SemanticNode[];
    outline?: OutlineNode[];
}

export interface Viewport {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
}

export type SnapshotFormat = "compact-text" | "json" | "json-pretty";


/**
 * WebSession wraps BaseSession for the web environment.
 * WASM runs on the main thread; browser side-effects are executed
 * directly via web_sys.
 */
export class WebSession {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Check if a global variable exists (not undefined).
     */
    has_global(name: string): boolean;
    /**
     * Inspect all global variables in the current JS state.
     */
    inspect_globals(): WasmGlobalsSnapshot;
    /**
     * Load a JS library by executing its source code.
     */
    load_library(source: string): CellResult;
    /**
     * Create a new web session.
     */
    constructor();
    /**
     * Reset the session, clearing all JS state.
     */
    reset(): void;
    /**
     * Run a cell, automatically resolving all async calls
     * directly via web_sys without yielding to JS.
     */
    runCellAsync(code: string, stdin: string): Promise<CellResult>;
    /**
     * Set the fuel limit for execution.
     */
    set_fuel_limit(limit: number): void;
    /**
     * Clean up the session and release resources.
     * Sets the abort flag so any in-flight run_cell_async loop
     * will exit cooperatively after the current async operation.
     */
    stopWith(): void;
}

export function collect_document(options: CollectOptions): TreeSnapshot;

export function collect_element(root: Element, options: CollectOptions): TreeSnapshot;

export function format_snapshot_js(snapshot: TreeSnapshot, format?: SnapshotFormat | null): string;

/**
 * Generate API documentation for the JS runtime.
 */
export function generateApiDocs(format: string): string;

export function main(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly generateApiDocs: (a: number, b: number) => [number, number];
    readonly main: () => void;
    readonly __wbg_websession_free: (a: number, b: number) => void;
    readonly websession_has_global: (a: number, b: number, c: number) => number;
    readonly websession_inspect_globals: (a: number) => any;
    readonly websession_load_library: (a: number, b: number, c: number) => any;
    readonly websession_new: () => number;
    readonly websession_reset: (a: number) => void;
    readonly websession_runCellAsync: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly websession_set_fuel_limit: (a: number, b: number) => void;
    readonly websession_stopWith: (a: number) => void;
    readonly collect_document: (a: any) => any;
    readonly collect_element: (a: any, b: any) => any;
    readonly format_snapshot_js: (a: any, b: number) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h71ec8c89f008b7b2: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__ha49b4777309bc5ce: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__ha903147e832d744b: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__hf3e9fd1570f0f5dc: (a: number, b: number) => number;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
