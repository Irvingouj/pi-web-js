use crate::format::SnapshotFormat;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(rename_all = "camelCase")]
pub struct TreeSnapshot {
    pub version: String,
    pub url: Option<String>,
    pub title: Option<String>,
    pub viewport: Option<Viewport>,
    pub nodes: Vec<SemanticNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outline: Option<Vec<OutlineNode>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct Viewport {
    pub width: f64,
    pub height: f64,
    pub scroll_x: f64,
    pub scroll_y: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct SemanticNode {
    pub ref_id: String,
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub tag: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub classes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub href: Option<String>,
    #[serde(skip_serializing_if = "States::is_empty")]
    pub states: States,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rect: Option<Rect>,
    pub in_viewport: bool,
    pub visible: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct States {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expanded: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pressed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub readonly: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invalid: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focusable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interactive: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<bool>,
}

impl States {
    pub fn is_empty(&self) -> bool {
        self.disabled.is_none()
            && self.checked.is_none()
            && self.selected.is_none()
            && self.expanded.is_none()
            && self.pressed.is_none()
            && self.required.is_none()
            && self.readonly.is_none()
            && self.invalid.is_none()
            && self.hidden.is_none()
            && self.focusable.is_none()
            && self.interactive.is_none()
            && self.current.is_none()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Tsify)]
pub struct OutlineNode {
    pub role: String,
    pub name: String,
    pub ref_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Tsify)]
#[tsify(from_wasm_abi)]
#[serde(rename_all = "camelCase")]
pub struct CollectOptions {
    #[serde(default = "default_false")]
    pub include_hidden: bool,
    #[serde(default = "default_false")]
    pub include_non_interactive: bool,
    #[serde(default = "default_true")]
    pub include_geometry: bool,
    #[serde(default = "default_true")]
    pub include_path: bool,
    #[serde(default = "default_max_text_length")]
    pub max_text_length: usize,
    #[serde(default = "default_max_nodes")]
    pub max_nodes: usize,
    #[serde(default = "default_true")]
    pub interactive_only: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<SnapshotFormat>,
}

impl Default for CollectOptions {
    fn default() -> Self {
        Self {
            include_hidden: false,
            include_non_interactive: false,
            include_geometry: true,
            include_path: true,
            max_text_length: 120,
            max_nodes: 1000,
            interactive_only: true,
            format: None,
        }
    }
}

fn default_false() -> bool {
    false
}
fn default_true() -> bool {
    true
}
fn default_max_text_length() -> usize {
    120
}
fn default_max_nodes() -> usize {
    1000
}
