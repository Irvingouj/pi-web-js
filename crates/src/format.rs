use crate::model::{SemanticNode, TreeSnapshot};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum SnapshotFormat {
    #[default]
    CompactText,
    Json,
    JsonPretty,
}

pub fn format_snapshot(snapshot: &TreeSnapshot, format: SnapshotFormat) -> String {
    match format {
        SnapshotFormat::CompactText => format_compact(snapshot),
        SnapshotFormat::Json => format_json(snapshot, false),
        SnapshotFormat::JsonPretty => format_json(snapshot, true),
    }
}

fn format_compact(snapshot: &TreeSnapshot) -> String {
    let mut lines = Vec::with_capacity(snapshot.nodes.len());
    for node in &snapshot.nodes {
        lines.push(format_node_compact(node));
    }
    lines.join("\n")
}

fn format_node_compact(node: &SemanticNode) -> String {
    let mut parts = Vec::new();
    parts.push(format!("[{}]", node.ref_id));
    parts.push(node.role.clone());

    if let Some(name) = &node.name {
        let escaped = name.replace('"', "\\\"");
        parts.push(format!("\"{}\"", escaped));
    }

    push_state(&mut parts, node, "disabled");
    push_state(&mut parts, node, "checked");
    push_state(&mut parts, node, "selected");
    push_state(&mut parts, node, "expanded");
    push_state(&mut parts, node, "pressed");
    push_state(&mut parts, node, "required");
    push_state(&mut parts, node, "readonly");
    push_state(&mut parts, node, "invalid");
    push_state(&mut parts, node, "current");

    if let Some(input_type) = &node.input_type {
        let esc = input_type.replace('"', "\\\"");
        parts.push(format!("inputType=\"{}\"", esc));
    }

    if let Some(description) = &node.description {
        if !description.is_empty() {
            let esc = description.replace('"', "\\\"");
            parts.push(format!("description=\"{}\"", esc));
        }
    }

    if let Some(value) = &node.value {
        if !value.is_empty() {
            let esc = value.replace('"', "\\\"");
            parts.push(format!("value=\"{}\"", esc));
        }
    }

    if let Some(placeholder) = &node.placeholder {
        if !placeholder.is_empty() {
            let esc = placeholder.replace('"', "\\\"");
            parts.push(format!("placeholder=\"{}\"", esc));
        }
    }

    if let Some(href) = &node.href {
        if !href.is_empty() {
            parts.push(format!("href=\"{}\"", href));
        }
    }

    parts.join(" ")
}

fn push_state(parts: &mut Vec<String>, node: &SemanticNode, key: &str) {
    let val = match key {
        "disabled" => node.states.disabled,
        "checked" => node.states.checked,
        "selected" => node.states.selected,
        "expanded" => node.states.expanded,
        "pressed" => node.states.pressed,
        "required" => node.states.required,
        "readonly" => node.states.readonly,
        "invalid" => node.states.invalid,
        "current" => node.states.current,
        _ => None,
    };
    if let Some(true) = val {
        parts.push(key.to_string());
    }
}

fn format_json(snapshot: &TreeSnapshot, pretty: bool) -> String {
    if pretty {
        serde_json::to_string_pretty(snapshot).unwrap_or_default()
    } else {
        serde_json::to_string(snapshot).unwrap_or_default()
    }
}
