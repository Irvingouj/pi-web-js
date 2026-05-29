/// Infer a semantic role from tag name and attributes.
pub fn infer_role(
    tag: &str,
    type_attr: Option<&str>,
    role_attr: Option<&str>,
    scope_attr: Option<&str>,
    has_name: bool,
) -> String {
    // 1. Explicit valid role attribute
    if let Some(role) = role_attr {
        let role = role.trim();
        if is_valid_role(role) {
            return role.to_string();
        }
    }

    // 2. Native HTML semantics
    let role = match tag {
        "button" | "input" => match type_attr {
            Some("submit") | Some("button") | Some("reset") | Some("file") | Some("color") => {
                "button"
            }
            Some("text") | Some("search") | Some("email") | Some("url") | Some("tel")
            | Some("password") | Some("number") => "textbox",
            Some("checkbox") => "checkbox",
            Some("radio") => "radio",
            Some("range") => "slider",
            Some("image") => "img",
            _ => {
                if tag == "button" {
                    "button"
                } else {
                    "textbox"
                }
            }
        },
        "textarea" => "textbox",
        "select" => "combobox",
        "option" => "option",
        "a" => "link",
        "img" => "img",
        "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => "heading",
        "ul" | "ol" => "list",
        "li" => "listitem",
        "table" => "table",
        "thead" | "tbody" | "tfoot" => "rowgroup",
        "tr" => "row",
        "th" => {
            if scope_attr == Some("row") {
                "rowheader"
            } else {
                "columnheader"
            }
        }
        "td" => "cell",
        "nav" => "navigation",
        "main" => "main",
        "form" => "form",
        "section" if has_name => "region",
        "section" => "generic",
        "article" => "article",
        "dialog" => "dialog",
        "details" => "group",
        "summary" => "button",
        "label" => "label",
        "iframe" => "iframe",
        "video" => "video",
        "audio" => "audio",
        _ => "generic",
    };

    role.to_string()
}

fn is_valid_role(role: &str) -> bool {
    const VALID_ROLES: &[&str] = &[
        "alert",
        "alertdialog",
        "application",
        "article",
        "banner",
        "button",
        "cell",
        "checkbox",
        "columnheader",
        "combobox",
        "command",
        "comment",
        "complementary",
        "composite",
        "contentinfo",
        "definition",
        "dialog",
        "directory",
        "document",
        "feed",
        "figure",
        "form",
        "grid",
        "gridcell",
        "group",
        "heading",
        "img",
        "input",
        "landmark",
        "link",
        "list",
        "listbox",
        "listitem",
        "log",
        "main",
        "marquee",
        "math",
        "menu",
        "menubar",
        "menuitem",
        "menuitemcheckbox",
        "menuitemradio",
        "navigation",
        "none",
        "note",
        "option",
        "presentation",
        "progressbar",
        "radio",
        "radiogroup",
        "range",
        "region",
        "roletype",
        "row",
        "rowgroup",
        "rowheader",
        "scrollbar",
        "search",
        "searchbox",
        "section",
        "sectionhead",
        "select",
        "separator",
        "slider",
        "spinbutton",
        "status",
        "strong",
        "structure",
        "switch",
        "tab",
        "table",
        "tablist",
        "tabpanel",
        "term",
        "textbox",
        "timer",
        "toolbar",
        "tooltip",
        "tree",
        "treegrid",
        "treeitem",
        "widget",
        "window",
    ];
    VALID_ROLES.contains(&role)
}

/// Determine if a role is generally considered interactive.
pub fn is_interactive_role(role: &str) -> bool {
    matches!(
        role,
        "button"
            | "link"
            | "textbox"
            | "checkbox"
            | "radio"
            | "combobox"
            | "listbox"
            | "option"
            | "menuitem"
            | "switch"
            | "slider"
            | "tab"
            | "searchbox"
            | "spinbutton"
    )
}
