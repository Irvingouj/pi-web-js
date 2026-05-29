use dom_semantic_tree::format::SnapshotFormat;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Default helpers ─────────────────────────────────────────────

fn default_get() -> String {
    "GET".to_string()
}

fn default_timeout() -> u64 {
    30_000
}

fn default_wait_ms() -> u64 {
    1000
}

fn default_scroll_direction() -> String {
    "down".to_string()
}

fn default_scroll_amount() -> f64 {
    300.0
}

fn default_true() -> bool {
    true
}

fn default_false() -> bool {
    false
}

fn default_max_nodes() -> u64 {
    500
}

// ─── Normalization helpers ─────────────────────────────────────
/// Convert an array of positional args into a named object so serde
/// can deserialize it into a typed struct.
pub fn normalize_array_params(value: serde_json::Value, fields: &[&str]) -> serde_json::Value {
    match value {
        serde_json::Value::Array(arr) => {
            let mut map = serde_json::Map::new();
            for (i, field) in fields.iter().enumerate() {
                if let Some(v) = arr.get(i) {
                    map.insert(field.to_string(), v.clone());
                }
            }
            serde_json::Value::Object(map)
        }
        other => other,
    }
}

// ─── web.* ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchParams {
    pub url: String,
    #[serde(default = "default_get")]
    pub method: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    #[serde(default = "default_timeout")]
    pub timeout: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SleepParams {
    pub duration: u64,
}

// ─── page.* ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageClickParams {
    #[serde(rename = "refId")]
    pub ref_id: String,
    #[serde(default)]
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageDblClickParams {
    #[serde(rename = "refId")]
    pub ref_id: String,
    #[serde(default)]
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageFillParams {
    #[serde(rename = "refId")]
    pub ref_id: String,
    #[serde(default)]
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageTypeParams {
    #[serde(rename = "refId")]
    pub ref_id: String,
    #[serde(default)]
    pub label: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PagePressParams {
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageSelectParams {
    #[serde(rename = "refId")]
    pub ref_id: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageCheckParams {
    #[serde(rename = "refId")]
    pub ref_id: String,
    #[serde(default = "default_true")]
    pub checked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageHoverParams {
    #[serde(rename = "refId")]
    pub ref_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageScrollParams {
    #[serde(default = "default_scroll_direction")]
    pub direction: String,
    #[serde(default = "default_scroll_amount")]
    pub amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageScrollToParams {
    #[serde(rename = "refId")]
    pub ref_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageGotoParams {
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageFindParams {
    pub selector: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageWaitForParams {
    pub selector: String,
    #[serde(default = "default_timeout")]
    pub timeout: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageExtractParams {
    pub fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageAppendParams {
    #[serde(rename = "refId")]
    pub ref_id: String,
    #[serde(default)]
    pub label: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageWaitParams {
    #[serde(default = "default_wait_ms", rename = "duration")]
    pub ms: u64,
}

// ─── storage.* ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageGetParams {
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageSetParams {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageDeleteParams {
    pub key: String,
}

// ─── dom.* ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomSnapshotParams {
    #[serde(default = "default_false")]
    pub interactive_only: bool,
    #[serde(default = "default_max_nodes")]
    pub max_nodes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomFormatParams {
    pub snapshot: serde_json::Value,
    #[serde(default)]
    pub format: SnapshotFormat,
}

// ─── web.tab.* ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabClickParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
    #[serde(rename = "refId")]
    pub ref_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabFillParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
    #[serde(rename = "refId")]
    pub ref_id: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabEvaluateParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
    pub script: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabBackParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabWaitForLoadParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
    #[serde(default = "default_timeout", rename = "timeout")]
    pub timeout: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabScrollToParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(rename = "refId")]
    pub ref_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabTypeParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
    #[serde(rename = "refId")]
    pub ref_id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabPressParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabSelectParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
    #[serde(rename = "refId")]
    pub ref_id: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabCheckParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
    #[serde(rename = "refId")]
    pub ref_id: String,
    #[serde(default = "default_true")]
    pub checked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabHoverParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
    #[serde(rename = "refId")]
    pub ref_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabUnhoverParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabScrollParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
    #[serde(default = "default_scroll_direction")]
    pub direction: String,
    #[serde(default = "default_scroll_amount")]
    pub amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabDblClickParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
    #[serde(rename = "refId")]
    pub ref_id: String,
}

// ─── fs.* ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FsWriteParams {
    pub path: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FsPathParams {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FsCopyParams {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FsUpdateParams {
    pub path: String,
    pub offset: u64,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FsHashParams {
    pub path: String,
    pub algo: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FsReadRangeParams {
    pub path: String,
    pub offset: u64,
    pub len: usize,
}
