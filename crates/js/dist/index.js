// JS wrapper for @pi-oxide/dom-semantic-tree
// Self-contained WASM package for DOM snapshot extraction.
import wasmInit, { collect_document, collect_element, format_snapshot_js, } from "./dom_semantic_tree.js";
export async function init() {
    await wasmInit();
}
export function collectDocument(options) {
    return collect_document(options);
}
export function collectElement(root, options) {
    return collect_element(root, options);
}
export function formatSnapshot(snapshot, format) {
    return format_snapshot_js(snapshot, format);
}
