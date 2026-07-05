use crate::error::js_exception::JsException;
use crate::types::CellError;
use rquickjs::Value;
use std::fmt;

pub(crate) fn format_name_message(name: Option<&str>, message: &str) -> String {
    match (name, message.is_empty()) {
        (Some(name), false) => format!("{}: {}", name, message),
        (Some(name), true) => name.to_string(),
        (None, false) => message.to_string(),
        (None, true) => "Error".to_string(),
    }
}

fn format_named_error(name: Option<&str>, message: &str, line: Option<u32>) -> String {
    let mut out = format_name_message(name, message);
    if let Some(line) = line {
        out.push_str(&format!(" (line {})", line));
    }
    out
}

/// Format parsed exception fields as `Name: message` for logs and classification.
pub(crate) fn format_js_exception(exc: &JsException) -> String {
    let mut out = if exc.action.is_some() || exc.code.is_some() {
        let action = exc.action.as_deref().unwrap_or("unknown");
        let code = exc.code.as_deref().unwrap_or("E_UNKNOWN");
        format!("[{}] ({}): {}", action, code, exc.message)
    } else {
        format_name_message(exc.name.as_deref(), &exc.message)
    };
    if let Some(hint) = &exc.hint {
        out.push_str("\n\nHint: ");
        out.push_str(hint);
    }
    if let Some(steps) = &exc.recovery {
        if !steps.is_empty() {
            out.push_str("\n\nRecovery:");
            for (idx, step) in steps.iter().enumerate() {
                out.push_str(&format!("\n  {}. {}", idx + 1, step));
            }
        }
    }
    out
}

/// User-facing error text for Rust `Display` and tests. The notebook UI mirrors this in `formatCellError`.
pub fn format_cell_error_text(err: &CellError) -> String {
    match err {
        CellError::Compile {
            name,
            message,
            line,
        } => format_named_error(name.as_deref(), message, *line),
        CellError::JsRuntime {
            name,
            message,
            line,
            stack,
        } => {
            let mut out = format_named_error(name.as_deref(), message, *line);
            if message.is_empty() {
                append_stack(&mut out, stack);
            }
            out
        }
        CellError::ApiError {
            code,
            message,
            public_name,
            line,
            param,
            hint,
            recovery,
            stack,
            ..
        } => {
            // `message` may already be the full_text from format_js_exception
            // (i.e. "[action] (code): ..."), or just the raw message. Detect an
            // existing bracket prefix to avoid double-wrapping.
            let already_wrapped = message.starts_with('[');
            let mut out = if already_wrapped {
                let mut s = message.to_string();
                // If a public_name is available and the existing bracket uses
                // the internal action, swap the bracket label to public_name.
                if let Some(close) = s.find(']') {
                    s = format!("[{}]{}", public_name, &s[close + 1..]);
                }
                s
            } else {
                format!("[{}] ({}): {}", public_name, code, message)
            };
            // Append structured param detail only for nested paths where the
            // message does not already include it. Root-branch messages
            // already contain "expected X, received Y" — skip to avoid duplication.
            if let Some(p) = param {
                let has_param_detail = message.contains(&format!("'{}'", p.path));
                let is_root = p.path == "root";
                if !has_param_detail && !is_root {
                    out.push_str(&format!(" at '{}'", p.path));
                    if let Some(exp) = &p.expected {
                        out.push_str(&format!(": expected {}", exp));
                    }
                    if let Some(rt) = &p.received_type {
                        out.push_str(&format!(", received {}", rt));
                    }
                    if let Some(preview) = &p.received_preview {
                        out.push_str(&format!(" ({})", preview));
                    }
                }
            }
            if let Some(line) = line {
                if !out.contains(&format!("(line {})", line)) {
                    out.push_str(&format!(" (line {})", line));
                }
            }
            append_stack(&mut out, stack);
            if let Some(h) = hint {
                out.push_str("\n\nHint: ");
                out.push_str(h);
            }
            if let Some(steps) = recovery {
                if !steps.is_empty() {
                    out.push_str("\n\nRecovery:");
                    for (idx, step) in steps.iter().enumerate() {
                        out.push_str(&format!("\n  {}. {}", idx + 1, step));
                    }
                }
            }
            out
        }
        CellError::FuelExhausted => "Execution stopped: time limit reached".to_string(),
        CellError::Internal { message } => format!("Internal error: {}", message),
    }
}

fn append_stack(out: &mut String, stack: &Option<String>) {
    if let Some(stack) = stack {
        let trimmed = stack.trim();
        if !trimmed.is_empty() {
            out.push_str("\nStack:\n");
            out.push_str(trimmed);
        }
    }
}

/// Format a JS exception value as `Name: message` for logs.
pub(crate) fn exception_to_string<'js>(value: &Value<'js>) -> String {
    format_js_exception(&crate::error::js_exception::parse_js_exception(value))
}

impl fmt::Display for CellError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", format_cell_error_text(self))
    }
}

#[cfg(test)]
mod tests {
    use super::format_cell_error_text;
    use super::format_js_exception;
    use crate::error::js_exception::JsException;
    use crate::types::CellError;

    #[test]
    fn format_js_exception_includes_hint_and_recovery() {
        let exc = JsException {
            name: Some("Error".into()),
            message: "Content script is not connected".into(),
            line: None,
            action: Some("page_fill".into()),
            code: Some("E_CONTENT_SCRIPT".into()),
            hint: Some("snapshot works; fill does not".into()),
            recovery: Some(vec![
                "await page.goto(url)".into(),
                "refresh the tab".into(),
            ]),
            details: None,
            category: None,
            stack: None,
            public_name: None,
            param_path: None,
            expected: None,
            received_type: None,
            received_preview: None,
        };
        let text = format_js_exception(&exc);
        assert!(text.contains("Hint: snapshot works"));
        assert!(text.contains("Recovery:"));
        assert!(text.contains("1. await page.goto(url)"));
    }

    #[test]
    fn format_compile_error() {
        let text = format_cell_error_text(&CellError::Compile {
            name: Some("SyntaxError".into()),
            message: "redeclaration of 'x'".into(),
            line: Some(3),
        });
        assert_eq!(text, "SyntaxError: redeclaration of 'x' (line 3)");
    }

    #[test]
    fn format_js_runtime_error() {
        let text = format_cell_error_text(&CellError::JsRuntime {
            name: Some("TypeError".into()),
            message: "x is not defined".into(),
            line: None,
            stack: None,
        });
        assert_eq!(text, "TypeError: x is not defined");
    }

    #[test]
    fn format_api_error() {
        let text = format_cell_error_text(&CellError::ApiError {
            code: "E_SCRIPTING".into(),
            message: "Cannot execute script".into(),
            action: "tab_snapshot".into(),
            public_name: "tab_snapshot".into(),
            line: None,
            param: None,
            category: None,
            hint: None,
            recovery: None,
            details: None,
            stack: None,
        });
        assert_eq!(text, "[tab_snapshot] (E_SCRIPTING): Cannot execute script");
    }

    #[test]
    fn format_api_error_with_line() {
        let text = format_cell_error_text(&CellError::ApiError {
            code: "E_SCRIPTING".into(),
            message: "Cannot execute script".into(),
            action: "tab_snapshot".into(),
            public_name: "tab_snapshot".into(),
            line: Some(12),
            param: None,
            category: None,
            hint: None,
            recovery: None,
            details: None,
            stack: None,
        });
        assert_eq!(
            text,
            "[tab_snapshot] (E_SCRIPTING): Cannot execute script (line 12)"
        );
    }

    #[test]
    fn format_js_runtime_error_empty_message_uses_stack() {
        let text = format_cell_error_text(&CellError::JsRuntime {
            name: Some("TypeError".into()),
            message: String::new(),
            line: None,
            stack: Some("    at foo (eval:1:5)\n    at bar (eval:2:10)".into()),
        });
        assert!(text.contains("TypeError"));
        assert!(text.contains("Stack:"));
        assert!(text.contains("at foo (eval:1:5)"));
    }

    #[test]
    fn format_fuel_exhausted() {
        assert_eq!(
            format_cell_error_text(&CellError::FuelExhausted),
            "Execution stopped: time limit reached"
        );
    }

    #[test]
    fn format_internal_error() {
        assert_eq!(
            format_cell_error_text(&CellError::Internal {
                message: "bad json".into()
            }),
            "Internal error: bad json"
        );
    }
}
