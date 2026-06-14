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
        CellError::Runtime {
            name,
            message,
            line,
            action,
            code,
            stack,
        } => {
            if action.is_some() || code.is_some() {
                let action = action.as_deref().unwrap_or("unknown");
                let code = code.as_deref().unwrap_or("E_UNKNOWN");
                let mut out = format!("[{}] ({}): {}", action, code, message);
                if let Some(line) = line {
                    out.push_str(&format!(" (line {})", line));
                }
                append_stack(&mut out, stack);
                out
            } else {
                let mut out = format_named_error(name.as_deref(), message, *line);
                if message.is_empty() {
                    append_stack(&mut out, stack);
                }
                out
            }
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
            stack: None,
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
    fn format_runtime_error() {
        let text = format_cell_error_text(&CellError::Runtime {
            name: Some("TypeError".into()),
            message: "x is not defined".into(),
            line: None,
            action: None,
            code: None,
            stack: None,
        });
        assert_eq!(text, "TypeError: x is not defined");
    }

    #[test]
    fn format_api_error() {
        let text = format_cell_error_text(&CellError::Runtime {
            name: Some("Error".into()),
            message: "Cannot execute script".into(),
            line: None,
            action: Some("tab_snapshot".into()),
            code: Some("E_SCRIPTING".into()),
            stack: None,
        });
        assert_eq!(text, "[tab_snapshot] (E_SCRIPTING): Cannot execute script");
    }

    #[test]
    fn format_api_error_with_line() {
        let text = format_cell_error_text(&CellError::Runtime {
            name: None,
            message: "Cannot execute script".into(),
            line: Some(12),
            action: Some("tab_snapshot".into()),
            code: Some("E_SCRIPTING".into()),
            stack: None,
        });
        assert_eq!(
            text,
            "[tab_snapshot] (E_SCRIPTING): Cannot execute script (line 12)"
        );
    }

    #[test]
    fn format_runtime_error_empty_message_uses_stack() {
        let text = format_cell_error_text(&CellError::Runtime {
            name: Some("TypeError".into()),
            message: String::new(),
            line: None,
            action: None,
            code: None,
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
