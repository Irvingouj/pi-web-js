import { type TreeSnapshot, type CollectOptions, type SnapshotFormat } from "./dom_semantic_tree.js";
export declare function init(): Promise<void>;
export declare function collectDocument(options: CollectOptions): TreeSnapshot;
export declare function collectElement(root: Element, options: CollectOptions): TreeSnapshot;
export declare function formatSnapshot(snapshot: TreeSnapshot, format?: SnapshotFormat): string;
export type { TreeSnapshot, CollectOptions, SnapshotFormat };
