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

fn split_name_message(text: &str) -> (Option<String>, String) {
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
                    if !is_artifact_message(&message) {
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
                    if !is_artifact_message(&message) {
                        return message;
                    }
                }
            }
        }
    }

    if let Some(stack) = stack {
        if let Some(first_line) = stack.lines().find(|line| !line.trim().is_empty()) {
            let trimmed = first_line.trim();
            if !is_artifact_message(trimmed) {
                return trimmed.to_string();
            }
        }
    }

    name.clone().unwrap_or_else(|| format_js_value(value))
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
        };
    };

    let mut name = read_js_string_field(obj, "name");
    let mut message = read_js_string_field(obj, "message").unwrap_or_default();
    let stack = read_js_string_field(obj, "stack");
    let action = read_js_string_field(obj, "action");
    let code = read_js_string_field(obj, "code");

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
    }
}
