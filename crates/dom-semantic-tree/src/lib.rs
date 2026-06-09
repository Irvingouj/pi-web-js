pub mod collect;
pub mod format;
pub mod geometry;
pub mod markdown_visible;
pub mod model;
pub mod name;
pub mod refs;
pub mod role;
pub mod state;
pub mod visibility;

use wasm_bindgen::prelude::*;
use web_sys::Element;

use crate::format::SnapshotFormat;
use crate::model::{CollectOptions, TreeSnapshot};

/// Semantic version string.
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[wasm_bindgen]
pub fn collect_document(options: CollectOptions) -> TreeSnapshot {
    collect::collect_document(options)
}

#[wasm_bindgen]
pub fn collect_element(root: &Element, options: CollectOptions) -> TreeSnapshot {
    collect::collect_element(root, options)
}

#[wasm_bindgen]
pub fn format_snapshot_js(snapshot: TreeSnapshot, format: Option<SnapshotFormat>) -> String {
    crate::format::format_snapshot(&snapshot, format.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version() {
        assert_eq!(version(), env!("CARGO_PKG_VERSION"));
    }
}
