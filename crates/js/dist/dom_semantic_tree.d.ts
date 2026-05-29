/* tslint:disable */
/* eslint-disable */
export interface CollectOptions {
    includeHidden?: boolean;
    includeNonInteractive?: boolean;
    includeGeometry?: boolean;
    includePath?: boolean;
    maxTextLength?: number;
    maxNodes?: number;
    interactiveOnly?: boolean;
    format?: string;
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


export function collect_document(options: CollectOptions): TreeSnapshot;

export function collect_element(root: Element, options: CollectOptions): TreeSnapshot;

export function format_snapshot_js(snapshot: TreeSnapshot, format?: string | null): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly collect_document: (a: any) => any;
    readonly collect_element: (a: any, b: any) => any;
    readonly format_snapshot_js: (a: any, b: number, c: number) => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
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
