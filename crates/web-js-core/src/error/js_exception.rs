use crate::js_value::format_js_value;
use rquickjs::Value;

/// Parsed fields from a JavaScript exception value.
#[derive(Debug, Clone)]
pub(crate) struct JsException {
    pub name: Option<String>,
    pub message: String,
    pub line: Option<u32>,
    pub action: Option<String>,
    pub code: Option<String>,
    pub hint: Option<String>,
    pub recovery: Option<Vec<String>>,
}

/// Extract a line number from an error message or stack trace.
pub(crate) fn extract_line_number(msg: &str) -> Option<u32> {
    let msg = msg.trim();

    if let Some(idx) = msg.find("at line ") {
        let rest = &msg[idx + 8..];
        let num_str: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        return num_str.parse().ok();
    }

    if let Some(idx) = msg.find("line ") {
        let rest = &msg[idx + 5..];
        let num_str: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        return num_str.parse().ok();
    }

    for line in msg.lines().rev() {
        if let Some(last_colon) = line.rfind(':') {
            let after_last = &line[last_colon + 1..];
            if after_last.parse::<u32>().is_ok() {
                if let Some(prev_colon) = line[..last_colon].rfind(':') {
                    let between = &line[prev_colon + 1..last_colon];
                    if let Ok(num) = between.parse::<u32>() {
                        return Some(num);
                    }
                }
            }
        }
    }

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

fn read_js_string_field<'js>(obj: &rquickjs::Object<'js>, key: &str) -> Option<String> {
    obj.get::<_, rquickjs::String>(key)
        .ok()
        .and_then(|s| s.to_string().ok())
        .map(|s| s.replace('\0', "").trim().to_string())
        .filter(|s| !s.is_empty())
}

fn is_artifact_message(message: &str) -> bool {
    message.is_empty()
        || message == ")"
        || message == "<no message>"
        || message == "<no details available>"
}

pub(crate) fn split_name_message(text: &str) -> (Option<String>, String) {
    let trimmed = text.trim();
    if let Some(colon_idx) = trimmed.find(": ") {
        let name = trimmed[..colon_idx].trim();
        let message = trimmed[colon_idx + 2..].trim();
        if !name.is_empty() && !message.is_empty() {
            return (Some(name.to_string()), message.to_string());
        }
    }
    (None, trimmed.to_string())
}

fn resolve_message_fallback<'js>(
    value: &Value<'js>,
    obj: &rquickjs::Object<'js>,
    name: &Option<String>,
    stack: &Option<String>,
) -> String {
    if let Ok(to_string) = obj.get::<_, rquickjs::Function>("toString") {
        if let Ok(val) = to_string.call::<_, rquickjs::String>(()) {
            if let Ok(s) = val.to_string() {
                let s = s.replace('\0', "").trim().to_string();
                if !s.is_empty() && s != "[object Object]" {
                    let (_, message) = split_name_message(&s);
                    if !is_artifact_message(&message) && name.as_deref() != Some(message.trim()) {
                        return message;
                    }
                }
            }
        }
    }

    let ctx = value.ctx().clone();
    if let Ok(stringify_fn) = ctx.eval::<rquickjs::Function, _>(
        "(function(v) { try { return String(v); } catch(e) { return ''; } })",
    ) {
        if let Ok(val) = stringify_fn.call::<_, rquickjs::String>((value.clone(),)) {
            if let Ok(s) = val.to_string() {
                let s = s.replace('\0', "").trim().to_string();
                if !s.is_empty() && s != "[object Object]" {
                    let (_, message) = split_name_message(&s);
                    if !is_artifact_message(&message) && name.as_deref() != Some(message.trim()) {
                        return message;
                    }
                }
            }
        }
    }

    // Try stack trace lines for richer context than just the error name.
    if let Some(stack) = stack {
        let stack_lines: Vec<&str> = stack.lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty() && !is_artifact_message(l))
            .take(3)
            .collect();
        if !stack_lines.is_empty() {
            let combined = stack_lines.join("\n");
            // Avoid returning something identical to name to prevent "TypeError: TypeError".
            if name.as_deref() != Some(combined.trim()) {
                return combined;
            }
        }
    }

    // Last resort: return empty rather than duplicating the name.
    // format_name_message(Some("TypeError"), "") produces "TypeError" cleanly.
    String::new()
}

/// Parse a JavaScript exception value into structured fields once.
pub(crate) fn parse_js_exception<'js>(value: &Value<'js>) -> JsException {
    let Some(obj) = value.as_object() else {
        let text = format_js_value(value);
        let (name, message) = split_name_message(&text);
        return JsException {
            name,
            message,
            line: extract_line_number(&text),
            action: None,
            code: None,
            hint: None,
            recovery: None,
        };
    };

    let mut name = read_js_string_field(obj, "name");
    let mut message = read_js_string_field(obj, "message").unwrap_or_default();
    let stack = read_js_string_field(obj, "stack");
    let action = read_js_string_field(obj, "action");
    let code = read_js_string_field(obj, "code");
    let hint = read_js_string_field(obj, "hint");
    let recovery = obj
        .get::<_, rquickjs::Value>("recovery")
        .ok()
        .and_then(|val| {
            if let Some(arr) = val.as_array() {
                let mut items = Vec::new();
                for i in 0..arr.len() {
                    if let Ok(item) = arr.get::<rquickjs::String>(i) {
                        if let Ok(s) = item.to_string() {
                            if !s.is_empty() {
                                items.push(s);
                            }
                        }
                    }
                }
                if items.is_empty() {
                    None
                } else {
                    Some(items)
                }
            } else {
                None
            }
        });

    if is_artifact_message(&message) {
        message = resolve_message_fallback(value, obj, &name, &stack);
        if name.is_none() {
            if let Ok(to_string) = obj.get::<_, rquickjs::Function>("toString") {
                if let Ok(val) = to_string.call::<_, rquickjs::String>(()) {
                    if let Ok(s) = val.to_string() {
                        let parsed_name = split_name_message(&s).0;
                        if parsed_name.is_some() {
                            name = parsed_name;
                        }
                    }
                }
            }
        }
    }

    let combined = match (&name, message.is_empty()) {
        (Some(n), false) => format!("{}: {}", n, message),
        (Some(n), true) => n.clone(),
        (None, false) => message.clone(),
        (None, true) => String::new(),
    };
    let line =
        extract_line_number(&combined).or_else(|| stack.as_deref().and_then(extract_line_number));

    JsException {
        name,
        message,
        line,
        action,
        code,
        hint,
        recovery,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── extract_line_number ──────────────────────────────────────────────

    #[test]
    fn extract_line_number_at_line_prefix() {
        assert_eq!(extract_line_number("at line 42"), Some(42));
    }

    #[test]
    fn extract_line_number_line_prefix() {
        assert_eq!(extract_line_number("line 7"), Some(7));
    }

    #[test]
    fn extract_line_number_mid_sentence() {
        assert_eq!(
            extract_line_number("something at line 3 and more"),
            Some(3)
        );
    }

    #[test]
    fn extract_line_number_none_when_absent() {
        assert_eq!(extract_line_number("no line info"), None);
    }

    #[test]
    fn extract_line_number_stack_trace_colon_format() {
        // The colon-based parser requires digits-only after the last colon.
        // "script:10:5)" fails because "5)" is not a valid u32.
        // "script:10:5" (no trailing paren) succeeds.
        assert_eq!(extract_line_number("    at foo (script:10:5)"), None);
        assert_eq!(extract_line_number("    at foo (script:10:5"), Some(10));
    }

    #[test]
    fn extract_line_number_paren_line_format() {
        assert_eq!(extract_line_number("(line 15)"), Some(15));
    }

    #[test]
    fn extract_line_number_empty_string() {
        assert_eq!(extract_line_number(""), None);
    }

    // ── split_name_message ───────────────────────────────────────────────

    #[test]
    fn split_name_message_standard() {
        let (name, message) = split_name_message("TypeError: x is not a function");
        assert_eq!(name, Some("TypeError".to_string()));
        assert_eq!(message, "x is not a function");
    }

    #[test]
    fn split_name_message_no_colon() {
        let (name, message) = split_name_message("no colon here");
        assert_eq!(name, None);
        assert_eq!(message, "no colon here");
    }

    #[test]
    fn split_name_message_empty_message_after_colon() {
        // "Name: " trimmed becomes "Name:" which no longer contains ": ",
        // so the colon-space pattern is not found and the whole trimmed string is returned.
        let (name, message) = split_name_message("Name: ");
        assert_eq!(name, None);
        assert_eq!(message, "Name:");
    }

    #[test]
    fn split_name_message_empty_name_before_colon() {
        let (name, message) = split_name_message(": message only");
        assert_eq!(name, None);
        assert_eq!(message, ": message only");
    }

    #[test]
    fn split_name_message_extraneous_whitespace() {
        let (name, message) = split_name_message("  TypeError:  some message  ");
        assert_eq!(name, Some("TypeError".to_string()));
        assert_eq!(message, "some message");
    }

    // ── is_artifact_message ─────────────────────────────────────────────

    #[test]
    fn is_artifact_message_empty() {
        assert!(is_artifact_message(""));
    }

    #[test]
    fn is_artifact_message_closing_paren() {
        assert!(is_artifact_message(")"));
    }

    #[test]
    fn is_artifact_message_no_message_tag() {
        assert!(is_artifact_message("<no message>"));
    }

    #[test]
    fn is_artifact_message_no_details_tag() {
        assert!(is_artifact_message("<no details available>"));
    }

    #[test]
    fn is_artifact_message_real_text_false() {
        assert!(!is_artifact_message("actual error text"));
    }
}
