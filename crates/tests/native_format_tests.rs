use dom_semantic_tree::format::{format_snapshot, SnapshotFormat};
use dom_semantic_tree::model::*;

fn make_node(ref_id: &str, role: &str, name: Option<&str>) -> SemanticNode {
    SemanticNode {
        ref_id: ref_id.to_string(),
        role: role.to_string(),
        name: name.map(|s| s.to_string()),
        description: None,
        tag: "div".to_string(),
        id: None,
        classes: None,
        value: None,
        placeholder: None,
        href: None,
        states: States::default(),
        input_type: None,
        rect: None,
        in_viewport: true,
        visible: true,
        path: None,
    }
}

fn make_snapshot(nodes: Vec<SemanticNode>) -> TreeSnapshot {
    TreeSnapshot {
        version: "0.1.0".to_string(),
        url: None,
        title: None,
        viewport: None,
        nodes,
        outline: None,
    }
}

#[test]
fn test_compact_empty() {
    let snap = make_snapshot(vec![]);
    let out = format_snapshot(&snap, SnapshotFormat::CompactText);
    assert_eq!(out, "");
}

#[test]
fn test_compact_button() {
    let snap = make_snapshot(vec![make_node("e1", "button", Some("Save"))]);
    let out = format_snapshot(&snap, SnapshotFormat::CompactText);
    assert_eq!(out, "[e1] button \"Save\"");
}

#[test]
fn test_compact_states() {
    let mut node = make_node("e2", "checkbox", Some("Agree"));
    node.states.checked = Some(true);
    node.states.required = Some(true);
    let snap = make_snapshot(vec![node]);
    let out = format_snapshot(&snap, SnapshotFormat::CompactText);
    assert_eq!(out, "[e2] checkbox \"Agree\" checked required");
}

#[test]
fn test_compact_value_placeholder() {
    let mut node = make_node("e3", "textbox", Some("Email"));
    node.value = Some("a@b.com".to_string());
    node.placeholder = Some("you@example.com".to_string());
    let snap = make_snapshot(vec![node]);
    let out = format_snapshot(&snap, SnapshotFormat::CompactText);
    assert_eq!(
        out,
        "[e3] textbox \"Email\" value=\"a@b.com\" placeholder=\"you@example.com\""
    );
}

#[test]
fn test_compact_href() {
    let mut node = make_node("e4", "link", Some("Forgot password?"));
    node.href = Some("/forgot".to_string());
    let snap = make_snapshot(vec![node]);
    let out = format_snapshot(&snap, SnapshotFormat::CompactText);
    assert_eq!(out, "[e4] link \"Forgot password?\" href=\"/forgot\"");
}

#[test]
fn test_json_pretty() {
    let snap = make_snapshot(vec![make_node("e1", "button", Some("Go"))]);
    let out = format_snapshot(&snap, SnapshotFormat::JsonPretty);
    assert!(out.contains("\"role\": \"button\""));
    assert!(out.contains("\"name\": \"Go\""));
}

#[test]
fn test_compact_input_type() {
    let mut node = make_node("e5", "textbox", Some("Email"));
    node.input_type = Some("email".to_string());
    let snap = make_snapshot(vec![node]);
    let out = format_snapshot(&snap, SnapshotFormat::CompactText);
    assert_eq!(out, "[e5] textbox \"Email\" inputType=\"email\"");
}

#[test]
fn test_compact_description() {
    let mut node = make_node("e6", "textbox", Some("Username"));
    node.description = Some("Must be 3-20 characters.".to_string());
    let snap = make_snapshot(vec![node]);
    let out = format_snapshot(&snap, SnapshotFormat::CompactText);
    assert_eq!(
        out,
        "[e6] textbox \"Username\" description=\"Must be 3-20 characters.\""
    );
}
