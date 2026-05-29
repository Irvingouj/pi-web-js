use dom_semantic_tree::role::infer_role;

#[test]
fn test_button_role() {
    assert_eq!(infer_role("button", None, None, None, false), "button");
}

#[test]
fn test_input_text_role() {
    assert_eq!(
        infer_role("input", Some("text"), None, None, false),
        "textbox"
    );
    assert_eq!(
        infer_role("input", Some("email"), None, None, false),
        "textbox"
    );
    assert_eq!(
        infer_role("input", Some("password"), None, None, false),
        "textbox"
    );
    assert_eq!(
        infer_role("input", Some("number"), None, None, false),
        "textbox"
    );
}

#[test]
fn test_input_checkbox_role() {
    assert_eq!(
        infer_role("input", Some("checkbox"), None, None, false),
        "checkbox"
    );
}

#[test]
fn test_input_radio_role() {
    assert_eq!(
        infer_role("input", Some("radio"), None, None, false),
        "radio"
    );
}

#[test]
fn test_input_submit_role() {
    assert_eq!(
        infer_role("input", Some("submit"), None, None, false),
        "button"
    );
    assert_eq!(
        infer_role("input", Some("button"), None, None, false),
        "button"
    );
    assert_eq!(
        infer_role("input", Some("reset"), None, None, false),
        "button"
    );
}

#[test]
fn test_input_range_role() {
    assert_eq!(
        infer_role("input", Some("range"), None, None, false),
        "slider"
    );
}

#[test]
fn test_input_file_role() {
    assert_eq!(
        infer_role("input", Some("file"), None, None, false),
        "button"
    );
}

#[test]
fn test_textarea_role() {
    assert_eq!(infer_role("textarea", None, None, None, false), "textbox");
}

#[test]
fn test_select_role() {
    assert_eq!(infer_role("select", None, None, None, false), "combobox");
}

#[test]
fn test_anchor_role() {
    assert_eq!(infer_role("a", None, None, None, false), "link");
}

#[test]
fn test_img_role() {
    assert_eq!(infer_role("img", None, None, None, false), "img");
}

#[test]
fn test_heading_roles() {
    assert_eq!(infer_role("h1", None, None, None, false), "heading");
    assert_eq!(infer_role("h6", None, None, None, false), "heading");
}

#[test]
fn test_list_roles() {
    assert_eq!(infer_role("ul", None, None, None, false), "list");
    assert_eq!(infer_role("ol", None, None, None, false), "list");
    assert_eq!(infer_role("li", None, None, None, false), "listitem");
}

#[test]
fn test_table_roles() {
    assert_eq!(infer_role("table", None, None, None, false), "table");
    assert_eq!(infer_role("thead", None, None, None, false), "rowgroup");
    assert_eq!(infer_role("tr", None, None, None, false), "row");
    assert_eq!(infer_role("th", None, None, None, false), "columnheader");
    assert_eq!(
        infer_role("th", None, None, Some("row"), false),
        "rowheader"
    );
    assert_eq!(infer_role("td", None, None, None, false), "cell");
}

#[test]
fn test_explicit_role_priority() {
    assert_eq!(
        infer_role("div", None, Some("button"), None, false),
        "button"
    );
    assert_eq!(infer_role("span", None, Some("link"), None, false), "link");
}

#[test]
fn test_invalid_explicit_role_fallback() {
    // invalid role should fall back to generic
    assert_eq!(
        infer_role("div", None, Some("notarole"), None, false),
        "generic"
    );
}

#[test]
fn test_nav_main_form_section_article() {
    assert_eq!(infer_role("nav", None, None, None, false), "navigation");
    assert_eq!(infer_role("main", None, None, None, false), "main");
    assert_eq!(infer_role("form", None, None, None, false), "form");
    assert_eq!(infer_role("section", None, None, None, false), "generic");
    assert_eq!(infer_role("section", None, None, None, true), "region");
    assert_eq!(infer_role("article", None, None, None, false), "article");
}

#[test]
fn test_input_color_role() {
    assert_eq!(
        infer_role("input", Some("color"), None, None, false),
        "button"
    );
}

#[test]
fn test_dialog_details_summary() {
    assert_eq!(infer_role("dialog", None, None, None, false), "dialog");
    assert_eq!(infer_role("details", None, None, None, false), "group");
    assert_eq!(infer_role("summary", None, None, None, false), "button");
}
