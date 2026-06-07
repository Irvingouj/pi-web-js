use crate::types::CellError;
use rquickjs::{Ctx, Value};

/// True when user cell code declares top-level `let`/`const` bindings.
pub(crate) fn cell_needs_isolation_wrap(code: &str) -> bool {
    code.lines().any(|line| {
        let trimmed = line.trim_start();
        trimmed.starts_with("let ")
            || trimmed.starts_with("const ")
            || trimmed.starts_with("let\t")
            || trimmed.starts_with("const\t")
    })
}

/// Wrap user cell code so top-level `let`/`const` can be re-run without global redeclaration errors.
pub(crate) fn wrap_user_cell_code(code: &str) -> String {
    format!("(async function __webJsCell() {{\n{}\n}})()", code)
}

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
/// Never rewrites real QuickJS error names into generic placeholders —
/// that destroys the original message that QuickJS already provided.
pub(crate) fn clean_error_message(msg: &str) -> String {
    let trimmed = msg.trim();
    // Only rewrite clearly corrupted / artifact messages, never real error names.
    // These artifacts appear when QuickJS async resume corrupts the exception object
    // (e.g., null/undefined property access or internal state loss during async resume).
    if trimmed == "TypeError: )"
        || trimmed == "TypeError: <no message>"
        || trimmed.ends_with(": )")
    {
        format!(
            "{} (likely null/undefined property access or corrupted async resume — enable debug logs with setLogLevel('debug'))",
            trimmed
        )
    } else {
        trimmed.to_string()
    }
}

/// Attach recent cell output to a runtime error for easier diagnosis.
pub(crate) fn format_runtime_error_with_context(
    msg: &str,
    stdout: &[String],
    stderr: &[String],
) -> String {
    let mut parts = vec![clean_error_message(msg)];
    if !stdout.is_empty() {
        parts.push(format!(
            "\nCell output before error:\n{}",
            stdout.join("\n")
        ));
    }
    if !stderr.is_empty() {
        parts.push(format!("\nStderr:\n{}", stderr.join("\n")));
    }
    parts.join("")
}

/// Resolve or reject a pending async call without embedding payloads in eval().
pub(crate) fn resume_async_pending<'js>(
    ctx: &Ctx<'js>,
    call_id: u32,
    response: &crate::types::AsyncResponse,
) -> rquickjs::Result<()> {
    use rquickjs::{Error, Function, Object, String as JsString, Value};

    let pending: Object = ctx.globals().get("__webJsPending")?;
    let key = call_id.to_string();
    let entry: Object = pending.get(key.as_str()).map_err(|_| {
        Error::new_from_js_message(
            "resume",
            "pending",
            format!("no pending async entry for call_id {}", call_id),
        )
    })?;

    let action = entry
        .get::<_, JsString>("action")
        .ok()
        .and_then(|s| s.to_string().ok())
        .unwrap_or_else(|| "unknown".to_string());

    let resolve: Function = entry.get("resolve")?;
    let reject: Function = entry.get("reject")?;

    let resume_result = if response.ok {
        let value_json = serde_json::to_string(
            response.value.as_ref().unwrap_or(&serde_json::Value::Null),
        )
        .map_err(|e| {
            rquickjs::Error::new_from_js_message("json", "stringify", e.to_string())
        })?;
        let js_value = ctx.json_parse(value_json)?;
        tracing::debug!(call_id, action = %action, "async_pending_resolved");
        resolve.call::<_, ()>((js_value,))
    } else {
        let (code, message) = response
            .error
            .as_ref()
            .map(|e| (e.code.as_str(), e.message.as_str()))
            .unwrap_or(("E_UNKNOWN", "unknown async error"));
        let text = format!("[{}] ({}) {}", action, code, message);
        tracing::error!(call_id, action = %action, code = %code, message = %message, "async_pending_rejected");
        let msg_json = serde_json::to_string(&text).map_err(|e| {
            rquickjs::Error::new_from_js_message("json", "stringify", e.to_string())
        })?;
        let error_obj = ctx.eval::<Value, _>(format!("new Error({})", msg_json))?;
        reject.call::<_, ()>((error_obj,))
    };

    resume_result?;

    ctx.eval::<(), _>(format!(
        "Reflect.deleteProperty(__webJsPending, '{}');",
        call_id
    ))?;

    Ok(())
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

    let stack = obj
        .get::<_, rquickjs::String>("stack")
        .ok()
        .and_then(|s| s.to_string().ok())
        .map(|s| s.replace('\0', "").trim().to_string())
        .filter(|s| !s.is_empty());

    let action = obj
        .get::<_, rquickjs::String>("action")
        .ok()
        .and_then(|s| s.to_string().ok())
        .map(|s| s.replace('\0', "").trim().to_string())
        .filter(|s| !s.is_empty());

    let code = obj
        .get::<_, rquickjs::String>("code")
        .ok()
        .and_then(|s| s.to_string().ok())
        .map(|s| s.replace('\0', "").trim().to_string())
        .filter(|s| !s.is_empty());

    let prefix = match (action.as_deref(), code.as_deref()) {
        (Some(a), Some(c)) => format!("[{}] ({}) ", a, c),
        (Some(a), None) => format!("[{}] ", a),
        (None, Some(c)) => format!("({}) ", c),
        (None, None) => String::new(),
    };

    match (name, message) {
        (Some(n), Some(m)) => {
            let mut out = format!("{}{}: {}", prefix, n, m);
            if let Some(stack) = stack {
                if let Some(first_line) = stack.lines().next() {
                    if !first_line.is_empty() && !m.contains(first_line) {
                        out.push_str(&format!(" ({})", first_line.trim()));
                    }
                }
            }
            out
        }
        (Some(n), None) => {
            // Try toString() first, then String(error), then stack line, then bare name
            if let Ok(to_string) = obj.get::<_, rquickjs::Function>("toString") {
                if let Ok(val) = to_string.call::<_, rquickjs::String>(()) {
                    if let Ok(s) = val.to_string() {
                        let s = s.replace('\0', "").trim().to_string();
                        if !s.is_empty() && s != "[object Object]" && s != n {
                            return format!("{}{}", prefix, s);
                        }
                    }
                }
            }
            // Try String(error) via a helper function to get the default string representation
            let ctx = value.ctx().clone();
            if let Ok(stringify_fn) = ctx.eval::<rquickjs::Function, _>(
                "(function(v) { try { return String(v); } catch(e) { return ''; } })"
            ) {
                if let Ok(val) = stringify_fn.call::<_, rquickjs::String>((value.clone(),)) {
                    if let Ok(s) = val.to_string() {
                        let s = s.replace('\0', "").trim().to_string();
                        if !s.is_empty() && s != "[object Object]" && s != n {
                            return format!("{}{}", prefix, s);
                        }
                    }
                }
            }
            if let Some(stack) = stack {
                if let Some(first_line) = stack.lines().next() {
                    return format!("{}{}: {}", prefix, n, first_line.trim());
                }
            }
            // Preserve the original error name rather than inventing a placeholder
            format!("{}{}", prefix, n)
        }
        (None, Some(m)) => format!("{}{}", prefix, m),
        (None, None) => format!("{}{}", prefix, format_js_value(value)),
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
