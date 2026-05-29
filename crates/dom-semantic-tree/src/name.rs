/// Compute accessible-ish name using a practical subset of AccName.
///
/// Priority:
/// 1. aria-labelledby (resolve space-separated IDs, concatenate text)
/// 2. aria-label
/// 3. associated label for form controls
/// 4. alt for img / image input
/// 5. title
/// 6. placeholder for text inputs as weak fallback
/// 7. visible textContent fallback
/// 8. value fallback for input[type=button/submit/reset]
///
/// `find_text_by_id` resolves an element by id and returns its text/name.
/// `ancestor_label_text` returns text of an ancestor <label> if any.
/// `text_content` returns visible textContent of this element.
/// `label_for_text` looks up a <label for="id"> and returns its text.
use std::collections::HashSet;

#[allow(clippy::type_complexity)]
pub struct NameContext<'a> {
    pub tag: &'a str,
    pub input_type: Option<&'a str>,
    pub aria_labelledby: Option<&'a str>,
    pub aria_label: Option<&'a str>,
    pub alt: Option<&'a str>,
    pub title: Option<&'a str>,
    pub placeholder: Option<&'a str>,
    pub value: Option<&'a str>,
    pub find_text_by_id: Box<dyn Fn(&str) -> Option<String>>,
    pub ancestor_label_text: Option<String>,
    pub text_content: String,
    pub label_for_text: Option<String>,
}

pub fn compute_name(ctx: &NameContext, max_len: usize) -> Option<String> {
    let mut visited_ids: HashSet<String> = HashSet::new();

    let name = try_aria_labelledby(ctx, &mut visited_ids)
        .or_else(|| try_aria_label(ctx))
        .or_else(|| ctx.label_for_text.clone())
        .or_else(|| ctx.ancestor_label_text.clone())
        .or_else(|| try_alt(ctx))
        .or_else(|| try_title(ctx))
        .or_else(|| try_placeholder(ctx))
        .or_else(|| try_value(ctx))
        .or_else(|| try_text_content(ctx));

    name.map(|n| limit_length(normalize(&n), max_len))
}

fn try_aria_labelledby(ctx: &NameContext, visited: &mut HashSet<String>) -> Option<String> {
    let ids = ctx.aria_labelledby?;
    let mut parts = Vec::new();
    for id in ids.split_whitespace() {
        if visited.contains(id) {
            continue;
        }
        visited.insert(id.to_string());
        if let Some(text) = (ctx.find_text_by_id)(id) {
            let normalized = normalize(&text);
            if !normalized.is_empty() {
                parts.push(normalized);
            }
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" "))
    }
}

fn try_aria_label(ctx: &NameContext) -> Option<String> {
    ctx.aria_label.map(|s| s.to_string())
}

fn try_alt(ctx: &NameContext) -> Option<String> {
    if ctx.tag == "img" || ctx.input_type == Some("image") {
        ctx.alt.map(|s| s.to_string())
    } else {
        None
    }
}

fn try_title(ctx: &NameContext) -> Option<String> {
    ctx.title.map(|s| s.to_string())
}

fn try_placeholder(ctx: &NameContext) -> Option<String> {
    ctx.placeholder.map(|s| s.to_string())
}

fn try_value(ctx: &NameContext) -> Option<String> {
    match ctx.input_type {
        Some("button") | Some("submit") | Some("reset") => ctx.value.map(|s| s.to_string()),
        _ => None,
    }
}

fn try_text_content(ctx: &NameContext) -> Option<String> {
    let t = normalize(&ctx.text_content);
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}

pub fn normalize(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut prev_space = true; // trim leading
    for ch in text.chars() {
        if ch.is_whitespace() {
            if !prev_space {
                result.push(' ');
                prev_space = true;
            }
        } else {
            result.push(ch);
            prev_space = false;
        }
    }
    // trim trailing
    if result.ends_with(' ') {
        result.pop();
    }
    result
}

pub fn limit_length(s: String, max: usize) -> String {
    if s.len() <= max {
        s
    } else {
        let mut cut = max;
        while cut > 0 && !s.is_char_boundary(cut) {
            cut -= 1;
        }
        format!("{}…", &s[..cut])
    }
}
