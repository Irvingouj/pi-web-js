use crate::error::format::format_js_exception;
use crate::error::js_exception::{extract_line_number, parse_js_exception, split_name_message, JsException};
use crate::types::CellError;
use rquickjs::{Ctx, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

fn is_parse_diagnostic_message(message: &str) -> bool {
    message.contains("redeclaration")
        || message.contains("already been declared")
        || message.contains("unexpected token")
        || message.contains("variable name expected")
        || message.contains("expecting")
        || message.starts_with("parse error")
}

fn is_compile_error(exc: &JsException, full_text: &str) -> bool {
    if exc.name.as_deref() == Some("SyntaxError") && is_parse_diagnostic_message(&exc.message) {
        return true;
    }
    is_parse_diagnostic_message(&exc.message)
        || full_text.starts_with("parse error")
        || full_text.starts_with("Expected")
}

pub(crate) fn is_fuel_exhausted_text(text: &str) -> bool {
    let trimmed = text.trim();
    trimmed == "interrupted"
        || trimmed.ends_with(": interrupted")
        || trimmed.contains("interrupted by host")
}

pub(crate) fn fuel_depleted(fuel_counter: &Arc<AtomicU64>) -> bool {
    fuel_counter.load(Ordering::Relaxed) == 0
}

/// Run pending microtasks until the queue is empty or fuel is exhausted.
pub(crate) fn drain_pending_jobs<'js>(
    ctx: &Ctx<'js>,
    fuel_counter: &Arc<AtomicU64>,
) -> Option<CellError> {
    const MAX_PENDING_JOB_DRAIN: u32 = 4096;
    let mut drained = 0u32;
    while ctx.execute_pending_job() {
        drained += 1;
        tracing::trace!(drained, "drain_pending_job");
        if drained >= MAX_PENDING_JOB_DRAIN {
            return Some(CellError::Internal {
                message: "QuickJS pending job queue exceeded safe drain limit".into(),
            });
        }
        if fuel_depleted(fuel_counter) {
            return Some(CellError::FuelExhausted);
        }
    }
    if fuel_depleted(fuel_counter) {
        Some(CellError::FuelExhausted)
    } else {
        None
    }
}

pub(crate) fn fuel_exhausted_flag_for(error: &CellError, fuel_counter: &Arc<AtomicU64>) -> bool {
    matches!(error, CellError::FuelExhausted) || fuel_depleted(fuel_counter)
}

/// Build a `CellError` from a parsed JavaScript exception.
pub(crate) fn cell_error_from_js_exception(exc: JsException) -> CellError {
    let full_text = format_js_exception(&exc);
    if is_fuel_exhausted_text(&full_text) || is_fuel_exhausted_text(&exc.message) {
        return CellError::FuelExhausted;
    }

    let line = exc.line.or_else(|| extract_line_number(&full_text));
    if is_compile_error(&exc, &full_text) {
        CellError::Compile {
            name: exc.name,
            message: exc.message,
            line,
        }
    } else {
        let message = if exc.action.is_some()
            || exc.code.is_some()
            || exc.hint.is_some()
            || exc.recovery.as_ref().is_some_and(|r| !r.is_empty())
        {
            full_text
        } else {
            exc.message
        };
        CellError::Runtime {
            name: exc.name,
            message,
            line,
            action: exc.action,
            code: exc.code,
            stack: exc.stack,
        }
    }
}

/// Build a `CellError` from a JavaScript exception value.
pub(crate) fn cell_error_from_exception<'js>(value: &Value<'js>) -> CellError {
    cell_error_from_js_exception(parse_js_exception(value))
}

/// Build a `CellError` from a plain error string (non-exception rquickjs errors).
pub(crate) fn cell_error_from_text(msg: &str) -> CellError {
    if is_fuel_exhausted_text(msg) {
        return CellError::FuelExhausted;
    }

    let (name, message) = split_name_message(msg);

    cell_error_from_js_exception(JsException {
        name,
        message,
        line: extract_line_number(msg),
        action: None,
        code: None,
        hint: None,
        recovery: None,
        stack: None,
    })
}

/// Convert a caught rquickjs error into a structured `CellError`.
pub(crate) fn cell_error_from_rquickjs_error<'js>(
    ctx: &Ctx<'js>,
    error: rquickjs::Error,
) -> CellError {
    if let rquickjs::Error::Exception = error {
        let exc = ctx.catch();
        cell_error_from_exception(&exc)
    } else {
        cell_error_from_text(&error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::js_exception::JsException;
    use crate::format_cell_error_text;

    fn js_exc(name: Option<&str>, message: &str) -> JsException {
        JsException {
            name: name.map(String::from),
            message: message.to_string(),
            line: None,
            action: None,
            code: None,
            hint: None,
            recovery: None,
            stack: None,
        }
    }

    // ── is_fuel_exhausted_text ──────────────────────────────────────

    #[test]
    fn fuel_text_interrupted() {
        assert!(is_fuel_exhausted_text("interrupted"));
    }

    #[test]
    fn fuel_text_prefixed_interrupted() {
        assert!(is_fuel_exhausted_text("Error: interrupted"));
    }

    #[test]
    fn fuel_text_interrupted_by_host() {
        assert!(is_fuel_exhausted_text("something interrupted by host"));
    }

    #[test]
    fn fuel_text_normal_error() {
        assert!(!is_fuel_exhausted_text("normal error"));
    }

    // ── cell_error_from_js_exception ─────────────────────────────────

    #[test]
    fn js_exc_plain_type_error() {
        let exc = js_exc(Some("TypeError"), "x is not a function");
        let err = cell_error_from_js_exception(exc);
        match err {
            CellError::Runtime { name, message, .. } => {
                assert_eq!(name.as_deref(), Some("TypeError"));
                assert_eq!(message, "x is not a function");
            }
            other => panic!("expected Runtime, got {other:?}"),
        }
    }

    #[test]
    fn js_exc_with_action_and_code() {
        let exc = JsException {
            name: Some("Error".into()),
            message: "Cannot execute script".into(),
            line: None,
            action: Some("tab_snapshot".into()),
            code: Some("E_SCRIPTING".into()),
            hint: None,
            recovery: None,
            stack: None,
        };
        let err = cell_error_from_js_exception(exc);
        match err {
            CellError::Runtime { message, action, code, .. } => {
                assert_eq!(message, "[tab_snapshot] (E_SCRIPTING): Cannot execute script");
                assert_eq!(action.as_deref(), Some("tab_snapshot"));
                assert_eq!(code.as_deref(), Some("E_SCRIPTING"));
            }
            other => panic!("expected Runtime, got {other:?}"),
        }
    }

    #[test]
    fn js_exc_fuel_exhausted() {
        let exc = js_exc(Some("Error"), "interrupted");
        assert!(matches!(cell_error_from_js_exception(exc), CellError::FuelExhausted));
    }

    #[test]
    fn js_exc_syntax_error_with_parse_diagnostic() {
        let exc = js_exc(Some("SyntaxError"), "unexpected token )");
        let err = cell_error_from_js_exception(exc);
        match err {
            CellError::Compile { name, message, .. } => {
                assert_eq!(name.as_deref(), Some("SyntaxError"));
                assert_eq!(message, "unexpected token )");
            }
            other => panic!("expected Compile, got {other:?}"),
        }
    }

    #[test]
    fn js_exc_bare_type_error_empty_message() {
        let exc = JsException {
            name: Some("TypeError".into()),
            message: String::new(),
            line: None,
            action: None,
            code: None,
            hint: None,
            recovery: None,
            stack: None,
        };
        let err = cell_error_from_js_exception(exc);
        match err {
            CellError::Runtime { ref name, ref message, .. } => {
                assert_eq!(name.as_deref(), Some("TypeError"));
                assert_eq!(message, "");
                // Display should produce "TypeError" without duplication
                let display = format_cell_error_text(&err);
                assert_eq!(display, "TypeError");
                assert!(!display.contains("TypeError: TypeError"));
            }
            other => panic!("expected Runtime, got {other:?}"),
        }
    }

    #[test]
    fn js_exc_forwards_stack_to_cell_error() {
        let exc = JsException {
            name: Some("TypeError".into()),
            message: String::new(),
            line: None,
            action: None,
            code: None,
            hint: None,
            recovery: None,
            stack: Some("    at foo (eval:1:5)\n    at bar (eval:2:10)".into()),
        };
        match cell_error_from_js_exception(exc) {
            CellError::Runtime { stack, .. } => {
                assert!(
                    stack
                        .as_ref()
                        .is_some_and(|s| s.contains("at foo (eval:1:5)")),
                    "stack should be forwarded: {stack:?}"
                );
            }
            other => panic!("expected Runtime, got {other:?}"),
        }
    }

    // ── cell_error_from_text ─────────────────────────────────────────

    #[test]
    fn text_type_error() {
        let err = cell_error_from_text("TypeError: x is not a function");
        match err {
            CellError::Runtime { name, message, .. } => {
                assert_eq!(name.as_deref(), Some("TypeError"));
                assert_eq!(message, "x is not a function");
            }
            other => panic!("expected Runtime, got {other:?}"),
        }
    }

    #[test]
    fn text_interrupted() {
        assert!(matches!(cell_error_from_text("interrupted"), CellError::FuelExhausted));
    }

    #[test]
    fn text_syntax_error_with_parse_diagnostic() {
        let err = cell_error_from_text("SyntaxError: unexpected token");
        match err {
            CellError::Compile { name, message, .. } => {
                assert_eq!(name.as_deref(), Some("SyntaxError"));
                assert_eq!(message, "unexpected token");
            }
            other => panic!("expected Compile, got {other:?}"),
        }
    }

    // Regression: format_cell_error_text must not double-prefix the error name.
    #[test]
    fn display_no_double_prefix() {
        let err = cell_error_from_text("TypeError: x is not a function");
        let display = format_cell_error_text(&err);
        assert_eq!(display, "TypeError: x is not a function");
    }
}
