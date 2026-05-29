#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

use dom_semantic_tree::collect::collect_document;
use dom_semantic_tree::model::CollectOptions;
use wasm_bindgen::JsValue;
use web_sys::window;

fn make_options() -> JsValue {
    let opts = CollectOptions {
        include_hidden: false,
        include_non_interactive: true,
        include_geometry: true,
        include_path: false,
        max_text_length: 120,
        max_nodes: 1000,
        interactive_only: false,
        format: None,
    };
    serde_wasm_bindgen::to_value(&opts).unwrap()
}

#[wasm_bindgen_test]
fn test_button_text() {
    let doc = window().unwrap().document().unwrap();
    let body = doc.body().unwrap();
    body.set_inner_html("<button id=\"b\">Save</button>");

    let opts = make_options();
    let result = collect_document(opts);
    let snap: dom_semantic_tree::model::TreeSnapshot =
        serde_wasm_bindgen::from_value(result).unwrap();

    let btn = snap
        .nodes
        .iter()
        .find(|n| n.tag == "button")
        .expect("button node");
    assert_eq!(btn.role, "button");
    assert_eq!(btn.name.as_deref(), Some("Save"));
}

#[wasm_bindgen_test]
fn test_aria_label() {
    let doc = window().unwrap().document().unwrap();
    let body = doc.body().unwrap();
    body.set_inner_html("<button aria-label=\"Close\"><svg></svg></button>");

    let opts = make_options();
    let result = collect_document(opts);
    let snap: dom_semantic_tree::model::TreeSnapshot =
        serde_wasm_bindgen::from_value(result).unwrap();

    let btn = snap
        .nodes
        .iter()
        .find(|n| n.role == "button")
        .expect("button node");
    assert_eq!(btn.name.as_deref(), Some("Close"));
}

#[wasm_bindgen_test]
fn test_label_for_input() {
    let doc = window().unwrap().document().unwrap();
    let body = doc.body().unwrap();
    body.set_inner_html("<label for=\"email\">Email</label><input id=\"email\" type=\"text\">");

    let opts = make_options();
    let result = collect_document(opts);
    let snap: dom_semantic_tree::model::TreeSnapshot =
        serde_wasm_bindgen::from_value(result).unwrap();

    let input = snap
        .nodes
        .iter()
        .find(|n| n.tag == "input")
        .expect("input node");
    assert_eq!(input.role, "textbox");
    assert_eq!(input.name.as_deref(), Some("Email"));
}

#[wasm_bindgen_test]
fn test_aria_labelledby() {
    let doc = window().unwrap().document().unwrap();
    let body = doc.body().unwrap();
    body.set_inner_html("<span id=\"x\">Username</span><input aria-labelledby=\"x\">");

    let opts = make_options();
    let result = collect_document(opts);
    let snap: dom_semantic_tree::model::TreeSnapshot =
        serde_wasm_bindgen::from_value(result).unwrap();

    let input = snap
        .nodes
        .iter()
        .find(|n| n.tag == "input")
        .expect("input node");
    assert_eq!(input.name.as_deref(), Some("Username"));
}

#[wasm_bindgen_test]
fn test_hidden_exclusion() {
    let doc = window().unwrap().document().unwrap();
    let body = doc.body().unwrap();
    body.set_inner_html("<button style=\"display:none\">Hidden</button>");

    let opts = make_options();
    let result = collect_document(opts);
    let snap: dom_semantic_tree::model::TreeSnapshot =
        serde_wasm_bindgen::from_value(result).unwrap();

    assert!(!snap
        .nodes
        .iter()
        .any(|n| n.name.as_deref() == Some("Hidden")));
}

#[wasm_bindgen_test]
fn test_aria_hidden_exclusion() {
    let doc = window().unwrap().document().unwrap();
    let body = doc.body().unwrap();
    body.set_inner_html("<div aria-hidden=\"true\"><button>Hidden</button></div>");

    let opts = make_options();
    let result = collect_document(opts);
    let snap: dom_semantic_tree::model::TreeSnapshot =
        serde_wasm_bindgen::from_value(result).unwrap();

    assert!(!snap
        .nodes
        .iter()
        .any(|n| n.name.as_deref() == Some("Hidden")));
}

#[wasm_bindgen_test]
fn test_checkbox_state() {
    let doc = window().unwrap().document().unwrap();
    let body = doc.body().unwrap();
    body.set_inner_html("<input type=\"checkbox\" id=\"c\" checked>");

    let opts = make_options();
    let result = collect_document(opts);
    let snap: dom_semantic_tree::model::TreeSnapshot =
        serde_wasm_bindgen::from_value(result).unwrap();

    let cb = snap
        .nodes
        .iter()
        .find(|n| n.role == "checkbox")
        .expect("checkbox node");
    assert_eq!(cb.states.checked, Some(true));
}

#[wasm_bindgen_test]
fn test_select_value() {
    let doc = window().unwrap().document().unwrap();
    let body = doc.body().unwrap();
    body.set_inner_html(
        r#"<select><option value=\"a\">A</option><option value=\"b\" selected>B</option></select>"#,
    );

    let opts = make_options();
    let result = collect_document(opts);
    let snap: dom_semantic_tree::model::TreeSnapshot =
        serde_wasm_bindgen::from_value(result).unwrap();

    let sel = snap
        .nodes
        .iter()
        .find(|n| n.role == "combobox")
        .expect("select node");
    assert_eq!(sel.value.as_deref(), Some("b"));
}

#[wasm_bindgen_test]
fn test_geometry_visible() {
    let doc = window().unwrap().document().unwrap();
    let body = doc.body().unwrap();
    body.set_inner_html("<button>Click me</button>");

    let opts = make_options();
    let result = collect_document(opts);
    let snap: dom_semantic_tree::model::TreeSnapshot =
        serde_wasm_bindgen::from_value(result).unwrap();

    let btn = snap
        .nodes
        .iter()
        .find(|n| n.role == "button")
        .expect("button node");
    assert!(btn.rect.is_some());
    let r = btn.rect.as_ref().unwrap();
    assert!(r.width > 0.0 || r.height > 0.0);
}

#[wasm_bindgen_test]
fn test_disabled_button() {
    let doc = window().unwrap().document().unwrap();
    let body = doc.body().unwrap();
    body.set_inner_html("<button disabled>Preview</button>");

    let opts = make_options();
    let result = collect_document(opts);
    let snap: dom_semantic_tree::model::TreeSnapshot =
        serde_wasm_bindgen::from_value(result).unwrap();

    let btn = snap
        .nodes
        .iter()
        .find(|n| n.role == "button")
        .expect("button node");
    assert_eq!(btn.states.disabled, Some(true));
}

#[wasm_bindgen_test]
fn test_required_name_cleaned() {
    let doc = window().unwrap().document().unwrap();
    let body = doc.body().unwrap();
    body.set_inner_html(r#"<label for="x">Full Name <span aria-label="required">*</span></label><input id="x" type="text" required />"#);

    let opts = make_options();
    let result = collect_document(opts);
    let snap: dom_semantic_tree::model::TreeSnapshot =
        serde_wasm_bindgen::from_value(result).unwrap();

    let input = snap
        .nodes
        .iter()
        .find(|n| n.role == "textbox")
        .expect("textbox node");
    assert_eq!(input.name.as_deref(), Some("Full Name"));
    assert_eq!(input.states.required, Some(true));
}

#[wasm_bindgen_test]
fn test_aria_describedby() {
    let doc = window().unwrap().document().unwrap();
    let body = doc.body().unwrap();
    body.set_inner_html(r#"<input id="u" type="text" aria-describedby="help" /><span id="help">Must be 3-20 characters.</span>"#);

    let opts = make_options();
    let result = collect_document(opts);
    let snap: dom_semantic_tree::model::TreeSnapshot =
        serde_wasm_bindgen::from_value(result).unwrap();

    let input = snap
        .nodes
        .iter()
        .find(|n| n.role == "textbox")
        .expect("textbox node");
    assert_eq!(
        input.description.as_deref(),
        Some("Must be 3-20 characters.")
    );
}

#[wasm_bindgen_test]
fn test_input_type_color() {
    let doc = window().unwrap().document().unwrap();
    let body = doc.body().unwrap();
    body.set_inner_html(r##"<input type="color" value="#ff0000" />"##);

    let opts = make_options();
    let result = collect_document(opts);
    let snap: dom_semantic_tree::model::TreeSnapshot =
        serde_wasm_bindgen::from_value(result).unwrap();

    let node = snap
        .nodes
        .iter()
        .find(|n| n.role == "button")
        .expect("button node for color input");
    assert_eq!(node.input_type.as_deref(), Some("color"));
    assert_eq!(node.value.as_deref(), Some("#ff0000"));
}
