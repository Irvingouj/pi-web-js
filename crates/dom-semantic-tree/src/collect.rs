use wasm_bindgen::JsCast;
use web_sys::{Document, Element, HtmlElement, Node, Window};

use crate::markdown_visible::is_markdown_visible_element;
use crate::model::{CollectOptions, OutlineNode, SemanticNode, TreeSnapshot, Viewport};
use crate::name::{compute_name, NameContext};
use crate::refs::RefAllocator;
use crate::role::{infer_role, is_interactive_role};
use crate::state::{extract_states, StateInput};
use crate::visibility::{is_display_none, is_visibility_hidden, is_zero_size};

use crate::geometry::dom_rect_to_rect;

const EXCLUDED_TAGS: &[&str] = &[
    "script", "style", "meta", "link", "template", "noscript", "head",
];

fn empty_snapshot() -> TreeSnapshot {
    TreeSnapshot {
        version: env!("CARGO_PKG_VERSION").to_string(),
        url: None,
        title: None,
        viewport: None,
        nodes: vec![],
        outline: None,
    }
}

pub fn collect_document(options: CollectOptions) -> TreeSnapshot {
    let window = match web_sys::window() {
        Some(w) => w,
        None => return empty_snapshot(),
    };
    let document = match window.document() {
        Some(d) => d,
        None => return empty_snapshot(),
    };

    let body = match document.body() {
        Some(b) => b,
        None => return empty_snapshot(),
    };

    collect_element_with_context(&body.into(), &options, &window, &document)
}

pub fn collect_element(root: &Element, options: CollectOptions) -> TreeSnapshot {
    let window = match web_sys::window() {
        Some(w) => w,
        None => return empty_snapshot(),
    };
    let document = match window.document() {
        Some(d) => d,
        None => return empty_snapshot(),
    };

    collect_element_with_context(root, &options, &window, &document)
}

fn collect_element_with_context(
    root: &Element,
    opts: &CollectOptions,
    window: &Window,
    document: &Document,
) -> TreeSnapshot {
    collect_element_internal(root, opts, window, document)
}

fn collect_element_internal(
    root: &Element,
    opts: &CollectOptions,
    window: &Window,
    document: &Document,
) -> TreeSnapshot {
    let mut allocator = RefAllocator::new();
    let mut nodes = Vec::new();
    let mut outline = Vec::new();

    let viewport = Viewport {
        width: window
            .inner_width()
            .map_or(0.0, |v| v.as_f64().unwrap_or(0.0)),
        height: window
            .inner_height()
            .map_or(0.0, |v| v.as_f64().unwrap_or(0.0)),
        scroll_x: window.scroll_x().unwrap_or(0.0),
        scroll_y: window.scroll_y().unwrap_or(0.0),
    };

    let url = document.url().ok();
    let title = document.title();
    let title = if title.is_empty() { None } else { Some(title) };

    let body = document.body();
    let is_body = body.as_ref().is_some_and(|b| **b == *root);

    traverse(
        root,
        opts,
        window,
        document,
        &viewport,
        &mut allocator,
        &mut nodes,
        &mut outline,
        "",
        is_body,
    );

    TreeSnapshot {
        version: env!("CARGO_PKG_VERSION").to_string(),
        url,
        title,
        viewport: Some(viewport),
        nodes,
        outline: if outline.is_empty() {
            None
        } else {
            Some(outline)
        },
    }
}

#[allow(clippy::too_many_arguments)]
fn traverse(
    element: &Element,
    opts: &CollectOptions,
    window: &Window,
    document: &Document,
    viewport: &Viewport,
    allocator: &mut RefAllocator,
    nodes: &mut Vec<SemanticNode>,
    outline: &mut Vec<OutlineNode>,
    parent_path: &str,
    _skip_root: bool,
) {
    if nodes.len() >= opts.max_nodes {
        return;
    }

    let tag = element.tag_name().to_lowercase();

    if EXCLUDED_TAGS.contains(&tag.as_str()) {
        return;
    }

    let style = window.get_computed_style(element).ok().flatten();

    let display = style
        .as_ref()
        .and_then(|s| s.get_property_value("display").ok());
    let visibility = style
        .as_ref()
        .and_then(|s| s.get_property_value("visibility").ok());

    let is_display_none = display.as_deref().is_some_and(is_display_none);
    let is_visibility_hidden = visibility.as_deref().is_some_and(is_visibility_hidden);

    let rect = element.get_bounding_client_rect();
    let rect_opt = if opts.include_geometry {
        Some(dom_rect_to_rect(&rect))
    } else {
        None
    };

    let is_in_viewport = if let Some(r) = &rect_opt {
        crate::visibility::in_viewport(r, viewport.width, viewport.height)
    } else {
        false
    };

    let html_element = element.dyn_ref::<HtmlElement>();

    let hidden_attr = element.has_attribute("hidden");
    let aria_hidden = element.get_attribute("aria-hidden");
    let aria_hidden_true = aria_hidden.as_deref() == Some("true");

    let inert = html_element.is_some_and(|he| he.inert());

    let is_hidden =
        hidden_attr || aria_hidden_true || inert || is_display_none || is_visibility_hidden;

    if is_hidden && !opts.include_hidden {
        return;
    }

    let role_attr = element.get_attribute("role");
    let type_attr = element.get_attribute("type");
    let scope_attr = element.get_attribute("scope");

    let has_name = element.get_attribute("aria-label").is_some()
        || element.get_attribute("aria-labelledby").is_some()
        || element.get_attribute("title").is_some();

    let role = infer_role(
        &tag,
        type_attr.as_deref(),
        role_attr.as_deref(),
        scope_attr.as_deref(),
        has_name,
    );
    let interactive_role = is_interactive_role(&role);

    let tabindex = html_element.map(|he| he.tab_index());
    let contenteditable = element.get_attribute("contenteditable");
    let contenteditable_true = contenteditable.as_deref() == Some("true");
    let has_click = element.has_attribute("onclick");

    let is_natural_focusable = matches!(
        tag.as_str(),
        "input" | "select" | "textarea" | "button" | "a"
    ) || tabindex.is_some_and(|t| t >= 0);

    let focusable = is_natural_focusable
        || contenteditable_true
        || tabindex.is_some_and(|t| t >= 0)
        || interactive_role;
    let interactive = interactive_role
        || has_click
        || is_natural_focusable
        || contenteditable_true
        || tabindex.is_some_and(|t| t >= 0);

    let is_zero_size = if let Some(r) = &rect_opt {
        is_zero_size(r.width, r.height, false, interactive)
    } else {
        false
    };

    if is_zero_size && !interactive {
        return;
    }

    let visible = !is_hidden && !is_zero_size;

    if !interactive && opts.interactive_only && !opts.include_non_interactive {
        // skip collecting, but may still need to recurse for children
        if !is_hidden || opts.include_hidden {
            let path = if opts.include_path {
                format!("{}{}/", parent_path, tag)
            } else {
                String::new()
            };
            recurse_children(
                element, opts, window, document, viewport, allocator, nodes, outline, &path,
            );
        }
        return;
    }

    // Gather state
    let mut input_disabled = None;
    let mut input_checked = None;
    let mut input_value = None;
    let mut input_required = None;
    let mut input_readonly = None;
    let mut select_value = None;
    let mut open_attr = None;

    if let Some(inp) = element.dyn_ref::<web_sys::HtmlInputElement>() {
        input_disabled = Some(inp.disabled());
        input_checked = Some(inp.checked());
        input_value = Some(inp.value());
        input_required = Some(inp.required());
        input_readonly = Some(inp.read_only());
    }
    if let Some(ta) = element.dyn_ref::<web_sys::HtmlTextAreaElement>() {
        input_disabled = Some(ta.disabled());
        input_value = Some(ta.value());
        input_required = Some(ta.required());
        input_readonly = Some(ta.read_only());
    }
    if let Some(sel) = element.dyn_ref::<web_sys::HtmlSelectElement>() {
        input_disabled = Some(sel.disabled());
        select_value = Some(sel.value());
        input_required = Some(sel.required());
    }
    if let Some(btn) = element.dyn_ref::<web_sys::HtmlButtonElement>() {
        input_disabled = Some(btn.disabled());
    }
    if tag == "details" {
        open_attr = Some(element.has_attribute("open"));
    }

    let state_input = StateInput {
        tag: tag.clone(),
        disabled: input_disabled,
        checked: input_checked,
        selected: None,
        expanded: open_attr,
        pressed: None,
        required: input_required,
        readonly: input_readonly,
        invalid: element.get_attribute("aria-invalid").map(|v| v == "true"),
        hidden: Some(is_hidden),
        focusable: Some(focusable),
        aria_disabled: element.get_attribute("aria-disabled").map(|v| v == "true"),
        aria_checked: element.get_attribute("aria-checked").map(|v| v == "true"),
        aria_selected: element.get_attribute("aria-selected").map(|v| v == "true"),
        aria_expanded: element.get_attribute("aria-expanded").map(|v| v == "true"),
        aria_pressed: element.get_attribute("aria-pressed").map(|v| v == "true"),
        aria_required: element.get_attribute("aria-required").map(|v| v == "true"),
        aria_readonly: element.get_attribute("aria-readonly").map(|v| v == "true"),
        aria_invalid: element.get_attribute("aria-invalid").map(|v| v == "true"),
        aria_hidden: element.get_attribute("aria-hidden").map(|v| v == "true"),
        tabindex,
        contenteditable: contenteditable_true,
        has_click_handler: has_click,
        is_natural_focusable,
        interactive_role,
        aria_current: element
            .get_attribute("aria-current")
            .map(|v| !v.is_empty() && v != "false"),
        open: open_attr,
    };

    let states = extract_states(&state_input);

    // Description from aria-describedby
    let describedby = element.get_attribute("aria-describedby");
    let description = describedby.as_deref().and_then(|ids| {
        let texts: Vec<String> = ids
            .split_whitespace()
            .filter_map(|id| {
                document
                    .get_element_by_id(id)
                    .and_then(|el| el.text_content())
                    .map(|t| crate::name::normalize(&t))
            })
            .filter(|t| !t.is_empty())
            .collect();
        if texts.is_empty() {
            None
        } else {
            Some(texts.join(" "))
        }
    });

    // Name computation
    let labelledby = element.get_attribute("aria-labelledby");
    let aria_label = element.get_attribute("aria-label");
    let alt = element.get_attribute("alt");
    let title = element.get_attribute("title");
    let placeholder = element.get_attribute("placeholder");
    let href = element.get_attribute("href");

    let text_content = element.text_content().unwrap_or_default();
    let text_content = if aria_hidden_true {
        String::new()
    } else {
        text_content
    };

    let id = element.get_attribute("id");
    let label_for_text = id.as_ref().and_then(|elem_id| {
        let selector = format!("label[for=\"{}\"]", elem_id.replace('"', "\\\""));
        document
            .query_selector(&selector)
            .ok()
            .flatten()
            .and_then(|el| el.text_content())
    });

    let ancestor_label = if matches!(tag.as_str(), "input" | "select" | "textarea") {
        find_ancestor_label(element, document)
    } else {
        None
    };

    let doc = document.clone();
    let ctx = NameContext {
        tag: &tag,
        input_type: type_attr.as_deref(),
        aria_labelledby: labelledby.as_deref(),
        aria_label: aria_label.as_deref(),
        alt: alt.as_deref(),
        title: title.as_deref(),
        placeholder: placeholder.as_deref(),
        value: input_value.as_deref(),
        find_text_by_id: Box::new(move |id_str: &str| {
            doc.get_element_by_id(id_str)
                .and_then(|el| el.text_content())
                .map(|t| crate::name::normalize(&t))
        }),
        ancestor_label_text: ancestor_label,
        text_content,
        label_for_text,
    };

    let name = compute_name(&ctx, opts.max_text_length);
    let name = name.map(|n| {
        if states.required == Some(true) {
            let trimmed = n.trim_end();
            if let Some(stripped) = trimmed.strip_suffix('*') {
                stripped.trim_end().to_string()
            } else if let Some(stripped) = trimmed.strip_suffix("(required)") {
                stripped.trim_end().to_string()
            } else if let Some(stripped) = trimmed.strip_suffix("(Required)") {
                stripped.trim_end().to_string()
            } else {
                trimmed.to_string()
            }
        } else {
            n
        }
    });

    let classes = if let Some(cls) = element.get_attribute("class") {
        let parts: Vec<String> = cls.split_whitespace().map(|s| s.to_string()).collect();
        if parts.is_empty() {
            None
        } else {
            Some(parts)
        }
    } else {
        None
    };

    let value = select_value.or(input_value);

    // Skip empty generic containers unless they carry markdown-visible text
    let is_empty_generic = role == "generic"
        && name.is_none()
        && value.is_none()
        && element.children().length() == 0
        && !is_markdown_visible_element(element, &role);
    if is_empty_generic {
        return;
    }

    let path = if opts.include_path {
        Some(format!("{}{}", parent_path, tag))
    } else {
        None
    };

    let ref_id = allocator.allocate();
    let _ = element.set_attribute("data-ref-id", &ref_id);

    // Outline for headings
    if role == "heading" {
        outline.push(OutlineNode {
            role: role.clone(),
            name: name.clone().unwrap_or_default(),
            ref_id: ref_id.clone(),
        });
    }

    nodes.push(SemanticNode {
        ref_id,
        role,
        name,
        description,
        tag: tag.clone(),
        id,
        classes,
        value,
        placeholder,
        href,
        states,
        input_type: type_attr,
        rect: rect_opt,
        in_viewport: is_in_viewport,
        visible,
        path,
    });

    // Skip SVG children unless SVG itself has role, name, or is interactive
    if tag == "svg" && role_attr.is_none() && !interactive && !has_name {
        return;
    }

    let child_path = if opts.include_path {
        format!("{}{}/", parent_path, tag)
    } else {
        String::new()
    };
    recurse_children(
        element,
        opts,
        window,
        document,
        viewport,
        allocator,
        nodes,
        outline,
        &child_path,
    );
}

#[allow(clippy::too_many_arguments)]
fn recurse_children(
    element: &Element,
    opts: &CollectOptions,
    window: &Window,
    document: &Document,
    viewport: &Viewport,
    allocator: &mut RefAllocator,
    nodes: &mut Vec<SemanticNode>,
    outline: &mut Vec<OutlineNode>,
    path: &str,
) {
    if let Ok(children) = element.children().dyn_into::<web_sys::HtmlCollection>() {
        let len = children.length();
        for i in 0..len {
            if let Some(child) = children.item(i) {
                traverse(
                    &child, opts, window, document, viewport, allocator, nodes, outline, path,
                    false,
                );
            }
        }
    }
}

fn find_ancestor_label(element: &Element, _document: &Document) -> Option<String> {
    let mut current: Option<Node> = Some(element.clone().into());
    while let Some(node) = current {
        if let Some(el) = node.dyn_ref::<Element>() {
            if el.tag_name().to_lowercase() == "label" {
                return el.text_content().map(|t| crate::name::normalize(&t));
            }
            current = el.parent_node();
        } else {
            break;
        }
    }
    None
}
