use crate::error::format::format_js_exception;
use crate::error::js_exception::{extract_line_number, parse_js_exception, JsException};
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
    while ctx.execute_pending_job() {
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
        CellError::Runtime {
            name: exc.name,
            message: exc.message,
            line,
            action: exc.action,
            code: exc.code,
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

    let (name, message) = {
        let trimmed = msg.trim();
        if let Some(colon_idx) = trimmed.find(": ") {
            let name = trimmed[..colon_idx].trim();
            let message = trimmed[colon_idx + 2..].trim();
            if !name.is_empty() && !message.is_empty() {
                (Some(name.to_string()), message.to_string())
            } else {
                (None, trimmed.to_string())
            }
        } else {
            (None, trimmed.to_string())
        }
    };

    cell_error_from_js_exception(JsException {
        name,
        message,
        line: extract_line_number(msg),
        action: None,
        code: None,
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
