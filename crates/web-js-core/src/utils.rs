use crate::types::CellError;
use rquickjs::{Ctx, Value};

/// Extract a line number from an error message or stack trace.
/// Handles "at line N", "line N", and "filename:line:col" patterns.
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

    // Try stack trace formats like "eval_script:1:1" or "<anonymous>:10:5"
    for line in msg.lines().rev() {
        if let Some(last_colon) = line.rfind(':') {
            let after_last = &line[last_colon + 1..];
            if after_last.parse::<u32>().is_ok() {
                // Look for "filename:line:col" pattern (second colon before last)
                if let Some(prev_colon) = line[..last_colon].rfind(':') {
                    let between = &line[prev_colon + 1..last_colon];
                    if let Ok(num) = between.parse::<u32>() {
                        return Some(num);
                    }
                }
            }
        }
    }

    // QuickJS stack traces sometimes contain "(line N)"
    for line in msg.lines() {
        if let Some(idx) = line.find("(line ") {
            let rest = &line[idx + 6..];
            let num_str: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(num) = num_str.parse() {
                return Some(num);
            }
        }
    }

    None
}

/// Clean up error messages to be more user-friendly.
pub(crate) fn clean_error_message(msg: &str) -> String {
    let trimmed = msg.trim();
    // If the message is just an error name with no details, add a hint
    if trimmed == "SyntaxError"
        || trimmed == "ReferenceError"
        || trimmed == "TypeError"
        || trimmed == "RangeError"
    {
        format!("{}: <no details available>", trimmed)
    } else {
        trimmed.to_string()
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

/// Extract an error message from a JS exception value.
/// Tries name+message, then toString(), then fallback to value display.
/// Filters out null bytes and control chars that appear in WASM backtraces.
pub(crate) fn exception_to_string<'js>(value: &Value<'js>) -> String {
    let Some(obj) = value.as_object() else {
        return format_js_value(value);
    };

    let name = obj
        .get::<_, rquickjs::String>("name")
        .ok()
        .and_then(|s| s.to_string().ok())
        .map(|s| s.replace('\0', "").trim().to_string())
        .filter(|s| !s.is_empty());

    let message = obj
        .get::<_, rquickjs::String>("message")
        .ok()
        .and_then(|s| s.to_string().ok())
        .map(|s| s.replace('\0', "").trim().to_string())
        .filter(|s| !s.is_empty());

    match (name, message) {
        (Some(n), Some(m)) => format!("{}: {}", n, m),
        (Some(n), None) => {
            // Try toString() as a last resort before falling back to bare name
            if let Ok(to_string) = obj.get::<_, rquickjs::Function>("toString") {
                if let Ok(val) = to_string.call::<_, rquickjs::String>(()) {
                    if let Ok(s) = val.to_string() {
                        let s = s.replace('\0', "").trim().to_string();
                        if !s.is_empty() && s != "[object Object]" && s != n {
                            return s;
                        }
                    }
                }
            }
            format!("{}: <no message>", n)
        }
        (None, Some(m)) => m,
        (None, None) => format_js_value(value),
    }
}

/// Convert a rquickjs error message into a structured `CellError`.
pub(crate) fn classify_js_error(msg: &str) -> CellError {
    let line = extract_line_number(msg);

    // Extract the error name from the prefix before the first colon
    let name = msg.split(':').next().unwrap_or(msg).trim();

    let is_compile = name == "SyntaxError"
        || msg.starts_with("parse error")
        || msg.contains("unexpected token")
        || msg.starts_with("Expected");

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
