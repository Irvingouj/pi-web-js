use web_sys::{Element, Node};

pub fn is_markdown_text_tag(tag: &str) -> bool {
    matches!(
        tag,
        "p" | "span"
            | "label"
            | "footer"
            | "header"
            | "blockquote"
            | "pre"
            | "code"
            | "figcaption"
            | "td"
            | "th"
            | "li"
            | "em"
            | "strong"
            | "small"
            | "cite"
            | "q"
            | "mark"
            | "time"
            | "abbr"
            | "dfn"
            | "kbd"
            | "samp"
            | "var"
            | "sub"
            | "sup"
    )
}

pub fn has_direct_text_content(element: &Element) -> bool {
    for i in 0..element.child_nodes().length() {
        if let Some(child) = element.child_nodes().item(i) {
            if child.node_type() == Node::TEXT_NODE {
                if let Some(text) = child.text_content() {
                    if !text.trim().is_empty() {
                        return true;
                    }
                }
            }
        }
    }
    false
}

/// True when the element would remain visible in a Markdown rendering.
pub fn is_markdown_visible_element(element: &Element, role: &str) -> bool {
    if role != "generic" {
        return true;
    }

    if element
        .get_attribute("aria-live")
        .is_some_and(|v| v != "off")
    {
        return true;
    }

    if matches!(
        element.get_attribute("role").as_deref(),
        Some("status") | Some("alert")
    ) {
        return true;
    }

    let text = element.text_content().unwrap_or_default();
    if text.trim().is_empty() {
        return false;
    }

    let tag = element.tag_name().to_lowercase();
    if is_markdown_text_tag(&tag) {
        return true;
    }

    has_direct_text_content(element)
}

#[cfg(test)]
mod tests {
    use super::is_markdown_text_tag;

    #[test]
    fn markdown_text_tags_include_status_paragraph() {
        assert!(is_markdown_text_tag("p"));
        assert!(is_markdown_text_tag("footer"));
        assert!(!is_markdown_text_tag("div"));
    }
}
