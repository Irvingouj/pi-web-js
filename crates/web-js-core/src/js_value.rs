use crate::types::CellError;
use rquickjs::{Ctx, Value};

/// Format a Value for display (used by print/emit).
pub(crate) fn format_js_value<'js>(value: &Value<'js>) -> String {
    if value.is_undefined() {
        "undefined".to_string()
    } else if value.is_null() {
        "null".to_string()
    } else if value.is_bool() {
        value
            .as_bool()
            .map(|b| b.to_string())
            .unwrap_or_else(|| "[boolean]".to_string())
    } else if value.is_number() {
        value
            .as_number()
            .map(|n| n.to_string())
            .unwrap_or_else(|| "[number]".to_string())
    } else if value.is_string() {
        value
            .as_string()
            .and_then(|s| s.to_string().ok())
            .unwrap_or_else(|| "[string]".to_string())
    } else {
        let ctx = value.ctx().clone();
        ctx.json_stringify(value)
            .ok()
            .flatten()
            .and_then(|s| s.to_string().ok())
            .unwrap_or_else(|| "[object]".to_string())
    }
}

/// Convert a rquickjs `Value` to a `serde_json::Value` by round-tripping through JSON.stringify.
pub(crate) fn js_value_to_json<'js>(
    ctx: Ctx<'js>,
    value: &Value<'js>,
) -> Result<serde_json::Value, CellError> {
    let opt_str = ctx.json_stringify(value).map_err(|e| CellError::Internal {
        message: format!("JSON stringify error: {}", e),
    })?;
    match opt_str {
        Some(s) => {
            let rust_str = s.to_string().map_err(|e| CellError::Internal {
                message: format!("String conversion error: {}", e),
            })?;
            serde_json::from_str(&rust_str).map_err(|e| CellError::Internal {
                message: format!("JSON parse error: {}", e),
            })
        }
        None => Ok(serde_json::Value::Null),
    }
}
