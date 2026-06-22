use dom_semantic_tree::format::SnapshotFormat;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use ts_rs::TS;

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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct SleepParams {
    pub duration: u64,
}

// ─── page.* ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PageClickParams {
    #[serde(rename = "refId", default)]
    pub ref_id: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub selector: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PageDblClickParams {
    #[serde(rename = "refId", default)]
    pub ref_id: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub selector: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PageFillParams {
    #[serde(rename = "refId", default)]
    pub ref_id: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    pub value: String,
    #[serde(default)]
    pub selector: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PageTypeParams {
    #[serde(rename = "refId", default)]
    pub ref_id: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    pub text: String,
    #[serde(default)]
    pub selector: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PagePressParams {
    #[serde(rename = "refId", default)]
    pub ref_id: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(untagged)]
pub enum MaybeMultiValue {
    Single(String),
    Multi(Vec<String>),
}

impl MaybeMultiValue {
    pub fn into_vec(self) -> Vec<String> {
        match self {
            MaybeMultiValue::Single(s) => vec![s],
            MaybeMultiValue::Multi(v) => v,
        }
    }

    pub fn first(&self) -> Option<&str> {
        match self {
            MaybeMultiValue::Single(s) => Some(s.as_str()),
            MaybeMultiValue::Multi(v) => v.first().map(String::as_str),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PageSelectParams {
    #[serde(rename = "refId", default)]
    pub ref_id: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    pub value: MaybeMultiValue,
    #[serde(default)]
    pub selector: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PageCheckParams {
    #[serde(rename = "refId", default)]
    pub ref_id: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default = "default_true")]
    pub checked: bool,
    #[serde(default)]
    pub selector: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PageHoverParams {
    #[serde(rename = "refId", default)]
    pub ref_id: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub selector: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PageScrollParams {
    #[serde(default = "default_scroll_direction")]
    pub direction: String,
    #[serde(default = "default_scroll_amount")]
    pub amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PageScrollToParams {
    #[serde(rename = "refId", default)]
    pub ref_id: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub x: Option<f64>,
    #[serde(default)]
    pub y: Option<f64>,
    #[serde(default)]
    pub selector: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PageGotoParams {
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PageFindParams {
    pub selector: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PageWaitForParams {
    pub selector: String,
    #[serde(default = "default_timeout")]
    pub timeout: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PageExtractParams {
    pub fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PageAppendParams {
    #[serde(rename = "refId", default)]
    pub ref_id: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    pub text: String,
    #[serde(default)]
    pub selector: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PageWaitParams {
    #[serde(default = "default_wait_ms", rename = "duration")]
    pub ms: u64,
}

// ─── Fetch positional args support ───────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct FetchOptions {
    #[serde(default = "default_get")]
    pub method: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    #[serde(default = "default_timeout")]
    pub timeout: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum FetchArgs {
    Flat(FetchParams),
    Positional {
        url: String,
        #[serde(default)]
        options: Option<FetchOptions>,
    },
}

// ─── storage.* ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct StorageGetParams {
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct StorageSetParams {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct StorageDeleteParams {
    pub key: String,
}

// ─── dom.* ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct DomSnapshotParams {
    #[serde(default = "default_false")]
    pub interactive_only: bool,
    #[serde(default = "default_max_nodes")]
    pub max_nodes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct DomFormatParams {
    #[ts(type = "TreeSnapshot")]
    pub snapshot: serde_json::Value,
    #[serde(default)]
    #[ts(type = "string")]
    pub format: SnapshotFormat,
}

// ─── web.tab.* ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TabClickParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
    #[serde(rename = "refId")]
    pub ref_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TabFillParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
    #[serde(rename = "refId")]
    pub ref_id: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TabEvaluateParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
    pub script: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TabBackParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TabWaitForLoadParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
    #[serde(default = "default_timeout", rename = "timeout")]
    pub timeout: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TabScrollToParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
    #[serde(default)]
    pub x: Option<f64>,
    #[serde(default)]
    pub y: Option<f64>,
    #[serde(rename = "refId", default)]
    pub ref_id: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TabTypeParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
    #[serde(rename = "refId")]
    pub ref_id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TabPressParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TabSelectParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
    #[serde(rename = "refId")]
    pub ref_id: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TabCheckParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
    #[serde(rename = "refId")]
    pub ref_id: String,
    #[serde(default = "default_true")]
    pub checked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TabHoverParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
    #[serde(rename = "refId")]
    pub ref_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TabUnhoverParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TabScrollParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
    #[serde(default = "default_scroll_direction")]
    pub direction: String,
    #[serde(default = "default_scroll_amount")]
    pub amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TabDblClickParams {
    #[serde(rename = "tabId")]
    pub tab_id: u64,
    #[serde(rename = "refId")]
    pub ref_id: String,
}

// ─── fs.* ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct FsWriteParams {
    pub path: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct FsPathParams {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct FsCopyParams {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct FsUpdateParams {
    pub path: String,
    pub offset: u64,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct FsHashParams {
    pub path: String,
    pub algo: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct FsReadRangeParams {
    pub path: String,
    pub offset: u64,
    pub len: usize,
}

#[cfg(test)]
mod tests {
    use std::fs;
    use ts_rs::TS;

    #[test]
    fn test_fetch_params_ts_name() {
        assert_eq!(super::FetchParams::name(&Default::default()), "FetchParams");
    }

    #[test]
    fn test_sleep_params_ts_name() {
        assert_eq!(super::SleepParams::name(&Default::default()), "SleepParams");
    }

    #[test]
    fn test_dom_format_params_ts_name() {
        assert_eq!(
            super::DomFormatParams::name(&Default::default()),
            "DomFormatParams"
        );
    }

    #[test]
    fn test_all_param_structs_in_web_union() {
        let _cfg = ts_rs::Config::default();
        let content = fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../web/src/types/generated.ts"
        ))
        .expect("web generated.ts should exist");

        let union_start = content
            .find("export type CommandParams =")
            .expect("CommandParams union should exist in web/generated.ts");
        let union_end = content[union_start..]
            .find(";")
            .expect("CommandParams union should end with ;");
        let union_body = &content[union_start..union_start + union_end];

        let expected = [
            super::FetchParams::name(&Default::default()),
            super::SleepParams::name(&Default::default()),
            super::PageClickParams::name(&Default::default()),
            super::PageDblClickParams::name(&Default::default()),
            super::PageFillParams::name(&Default::default()),
            super::PageTypeParams::name(&Default::default()),
            super::PagePressParams::name(&Default::default()),
            super::PageSelectParams::name(&Default::default()),
            super::PageCheckParams::name(&Default::default()),
            super::PageHoverParams::name(&Default::default()),
            super::PageScrollParams::name(&Default::default()),
            super::PageScrollToParams::name(&Default::default()),
            super::PageGotoParams::name(&Default::default()),
            super::PageFindParams::name(&Default::default()),
            super::PageWaitForParams::name(&Default::default()),
            super::PageExtractParams::name(&Default::default()),
            super::PageAppendParams::name(&Default::default()),
            super::PageWaitParams::name(&Default::default()),
            super::StorageGetParams::name(&Default::default()),
            super::StorageSetParams::name(&Default::default()),
            super::StorageDeleteParams::name(&Default::default()),
            super::DomSnapshotParams::name(&Default::default()),
            super::DomFormatParams::name(&Default::default()),
            super::TabClickParams::name(&Default::default()),
            super::TabFillParams::name(&Default::default()),
            super::TabEvaluateParams::name(&Default::default()),
            super::TabBackParams::name(&Default::default()),
            super::TabWaitForLoadParams::name(&Default::default()),
            super::TabScrollToParams::name(&Default::default()),
            super::TabTypeParams::name(&Default::default()),
            super::TabPressParams::name(&Default::default()),
            super::TabSelectParams::name(&Default::default()),
            super::TabCheckParams::name(&Default::default()),
            super::TabHoverParams::name(&Default::default()),
            super::TabUnhoverParams::name(&Default::default()),
            super::TabScrollParams::name(&Default::default()),
            super::TabDblClickParams::name(&Default::default()),
            super::FsWriteParams::name(&Default::default()),
            super::FsPathParams::name(&Default::default()),
            super::FsCopyParams::name(&Default::default()),
            super::FsUpdateParams::name(&Default::default()),
            super::FsHashParams::name(&Default::default()),
            super::FsReadRangeParams::name(&Default::default()),
        ];

        for name in &expected {
            assert!(
                union_body.contains(name),
                "CommandParams union in web/generated.ts should contain {}",
                name
            );
        }
    }

    #[test]
    fn test_web_async_command_params_typed() {
        let content = fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../web/src/types/generated.ts"
        ))
        .expect("web generated.ts should exist");
        assert!(
            content.contains("params: CommandParams"),
            "AsyncCommand.params should be typed as CommandParams in web/generated.ts"
        );
    }

    #[test]
    fn test_web_run_result_commands_typed() {
        let content = fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../web/src/types/generated.ts"
        ))
        .expect("web generated.ts should exist");
        assert!(
            content.contains("commands: CommandParams[]"),
            "RunResult.commands should be typed as CommandParams[] in web/generated.ts"
        );
    }

    #[test]
    fn test_extension_async_command_params_typed() {
        let content = fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../crates/extension-js/js/src/shared/generated.ts"
        ))
        .expect("extension generated.ts should exist");
        assert!(
            content.contains("params: CommandParams"),
            "Extension AsyncCommand.params should be typed as CommandParams"
        );
    }

    #[test]
    fn test_extension_run_result_commands_typed() {
        let content = fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../crates/extension-js/js/src/shared/generated.ts"
        ))
        .expect("extension generated.ts should exist");
        assert!(
            content.contains("commands: CommandParams[]"),
            "Extension RunResult.commands should be typed as CommandParams[]"
        );
    }

    #[test]
    fn test_extension_generated_ts_has_command_params_union() {
        let content = fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../crates/extension-js/js/src/shared/generated.ts"
        ))
        .expect("extension generated.ts should exist");
        assert!(
            content.contains("export type CommandParams ="),
            "Extension generated.ts should define CommandParams union"
        );
    }
}
