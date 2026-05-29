use dom_semantic_tree::name::{compute_name, limit_length, normalize, NameContext};
use std::collections::HashMap;

#[allow(clippy::too_many_arguments)]
fn make_ctx<'a>(
    tag: &'a str,
    text: &'a str,
    labelledby: Option<&'a str>,
    label: Option<&'a str>,
    alt: Option<&'a str>,
    title: Option<&'a str>,
    placeholder: Option<&'a str>,
    value: Option<&'a str>,
    label_for: Option<String>,
    ancestor_label: Option<String>,
    id_map: HashMap<String, String>,
) -> NameContext<'a> {
    NameContext {
        tag,
        input_type: None,
        aria_labelledby: labelledby,
        aria_label: label,
        alt,
        title,
        placeholder,
        value,
        find_text_by_id: Box::new(move |id_str: &str| id_map.get(id_str).cloned()),
        ancestor_label_text: ancestor_label,
        text_content: text.to_string(),
        label_for_text: label_for,
    }
}

#[test]
fn test_name_aria_labelledby() {
    let mut map = HashMap::new();
    map.insert("x".to_string(), "Username".to_string());
    let ctx = make_ctx(
        "input",
        "",
        Some("x"),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        map,
    );
    assert_eq!(compute_name(&ctx, 120), Some("Username".to_string()));
}

#[test]
fn test_name_aria_label() {
    let ctx = make_ctx(
        "button",
        "",
        None,
        Some("Close"),
        None,
        None,
        None,
        None,
        None,
        None,
        HashMap::new(),
    );
    assert_eq!(compute_name(&ctx, 120), Some("Close".to_string()));
}

#[test]
fn test_name_label_for() {
    let ctx = make_ctx(
        "input",
        "",
        None,
        None,
        None,
        None,
        None,
        None,
        Some("Email".to_string()),
        None,
        HashMap::new(),
    );
    assert_eq!(compute_name(&ctx, 120), Some("Email".to_string()));
}

#[test]
fn test_name_ancestor_label() {
    let ctx = make_ctx(
        "input",
        "",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        Some("Password".to_string()),
        HashMap::new(),
    );
    assert_eq!(compute_name(&ctx, 120), Some("Password".to_string()));
}

#[test]
fn test_name_alt_img() {
    let ctx = make_ctx(
        "img",
        "",
        None,
        None,
        Some("Logo"),
        None,
        None,
        None,
        None,
        None,
        HashMap::new(),
    );
    assert_eq!(compute_name(&ctx, 120), Some("Logo".to_string()));
}

#[test]
fn test_name_alt_not_img() {
    // alt on non-img should be ignored
    let ctx = make_ctx(
        "div",
        "",
        None,
        None,
        Some("Logo"),
        None,
        None,
        None,
        None,
        None,
        HashMap::new(),
    );
    assert_eq!(compute_name(&ctx, 120), None);
}

#[test]
fn test_name_title() {
    let ctx = make_ctx(
        "div",
        "",
        None,
        None,
        None,
        Some("Tooltip"),
        None,
        None,
        None,
        None,
        HashMap::new(),
    );
    assert_eq!(compute_name(&ctx, 120), Some("Tooltip".to_string()));
}

#[test]
fn test_name_placeholder() {
    let ctx = make_ctx(
        "input",
        "",
        None,
        None,
        None,
        None,
        Some("Search…"),
        None,
        None,
        None,
        HashMap::new(),
    );
    assert_eq!(compute_name(&ctx, 120), Some("Search…".to_string()));
}

#[test]
fn test_name_text_content() {
    let ctx = make_ctx(
        "button",
        "Submit",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        HashMap::new(),
    );
    assert_eq!(compute_name(&ctx, 120), Some("Submit".to_string()));
}

#[test]
fn test_name_value_button() {
    let mut ctx = make_ctx(
        "input",
        "",
        None,
        None,
        None,
        None,
        None,
        Some("Go"),
        None,
        None,
        HashMap::new(),
    );
    ctx.input_type = Some("submit");
    assert_eq!(compute_name(&ctx, 120), Some("Go".to_string()));
}

#[test]
fn test_name_priority() {
    let mut map = HashMap::new();
    map.insert("x".to_string(), "Name".to_string());
    // aria-labelledby should win over aria-label
    let ctx = make_ctx(
        "input",
        "",
        Some("x"),
        Some("Other"),
        None,
        None,
        None,
        None,
        None,
        None,
        map,
    );
    assert_eq!(compute_name(&ctx, 120), Some("Name".to_string()));
}

#[test]
fn test_normalize() {
    assert_eq!(normalize("  hello   world  "), "hello world");
    assert_eq!(normalize("\t\n  a  b \r\n c  "), "a b c");
}

#[test]
fn test_limit_length() {
    assert_eq!(limit_length("short".to_string(), 10), "short".to_string());
    let long = "a".repeat(200);
    let limited = limit_length(long.clone(), 120);
    assert!(limited.len() <= 125); // account for ellipsis
    assert!(limited.ends_with('…'));
}
