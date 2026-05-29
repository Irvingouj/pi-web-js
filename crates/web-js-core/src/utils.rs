use crate::types::CellError;
use rquickjs::{Ctx, Value};

/// Extract a line number from an error message.
/// Handles "at line N" and "line N" patterns.
pub(crate) fn extract_line_number(msg: &str) -> Option<u32> {
    let msg = msg.trim();

    // Try "at line N" or "at line N, col M"
    if let Some(idx) = msg.find("at line ") {
        let rest = &msg[idx + 8..];
        let num_str: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        return num_str.parse().ok();
    }

    // Try "line N" pattern
    if let Some(idx) = msg.find("line ") {
        let rest = &msg[idx + 5..];
        let num_str: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        return num_str.parse().ok();
    }

    None
}

/// Clean up error messages to be more user-friendly.
pub(crate) fn clean_error_message(msg: &str) -> String {
    msg.trim().to_string()
}

/// Convert a rquickjs `Value` to a `serde_json::Value` by round-tripping through JSON.stringify.
pub(crate) fn js_value_to_json<'js>(
    ctx: Ctx<'js>,
    value: &Value<'js>,
) -> Result<serde_json::Value, CellError> {
    let opt_str = ctx
        .json_stringify(value)
        .map_err(|e| CellError::Internal {
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

/// Convert a `serde_json::Value` to a rquickjs `Value` by round-tripping through JSON.parse.
pub(crate) fn json_to_js_value<'js>(
    ctx: Ctx<'js>,
    value: &serde_json::Value,
) -> Result<Value<'js>, CellError> {
    let json_str = serde_json::to_string(value).map_err(|e| CellError::Internal {
        message: format!("JSON serialize error: {}", e),
    })?;
    ctx.json_parse(json_str).map_err(|e| CellError::Internal {
        message: format!("JSON parse error: {}", e),
    })
}

/// Format a Value for display (used by print/emit).
pub(crate) fn format_js_value<'js>(value: &Value<'js>) -> String {
    if value.is_undefined() {
        "undefined".to_string()
    } else if value.is_null() {
        "null".to_string()
    } else if value.is_bool() {
        value.as_bool().map(|b| b.to_string()).unwrap_or_else(|| "[boolean]".to_string())
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

/// Extract an error message from a JS exception value.
pub(crate) fn exception_to_string<'js>(value: &Value<'js>) -> String {
    if let Some(obj) = value.as_object() {
        if let Ok(name) = obj.get::<_, rquickjs::String>("name") {
            if let Ok(s) = name.to_string() {
                if let Ok(msg) = obj.get::<_, rquickjs::String>("message") {
                    if let Ok(m) = msg.to_string() {
                        return format!("{}: {}", s, m);
                    }
                }
                return s;
            }
        }
        if let Ok(msg) = obj.get::<_, rquickjs::String>("message") {
            if let Ok(s) = msg.to_string() {
                return s;
            }
        }
    }
    format_js_value(value)
}

/// Convert a rquickjs error message into a structured `CellError`.
pub(crate) fn classify_js_error(msg: &str) -> CellError {
    let line = extract_line_number(msg);

    let is_compile = msg.contains("SyntaxError")
        || msg.contains("parse error")
        || msg.contains("unexpected token")
        || msg.contains("Expected");

    if is_compile {
        CellError::Compile {
            message: clean_error_message(msg),
            line,
        }
    } else {
        CellError::Runtime {
            message: clean_error_message(msg),
            line,
        }
    }
}
