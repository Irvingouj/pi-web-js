use crate::model::States;

#[derive(Debug, Default, Clone)]
pub struct StateInput {
    pub tag: String,
    pub disabled: Option<bool>,
    pub checked: Option<bool>,
    pub selected: Option<bool>,
    pub expanded: Option<bool>,
    pub pressed: Option<bool>,
    pub required: Option<bool>,
    pub readonly: Option<bool>,
    pub invalid: Option<bool>,
    pub hidden: Option<bool>,
    pub focusable: Option<bool>,
    pub aria_disabled: Option<bool>,
    pub aria_checked: Option<bool>,
    pub aria_selected: Option<bool>,
    pub aria_expanded: Option<bool>,
    pub aria_pressed: Option<bool>,
    pub aria_required: Option<bool>,
    pub aria_readonly: Option<bool>,
    pub aria_invalid: Option<bool>,
    pub aria_hidden: Option<bool>,
    pub tabindex: Option<i32>,
    pub contenteditable: bool,
    pub has_click_handler: bool,
    pub is_natural_focusable: bool,
    pub interactive_role: bool,
    pub open: Option<bool>,
    pub aria_current: Option<bool>,
}

pub fn extract_states(input: &StateInput) -> States {
    let mut s = States::default();

    if input.tag == "details" {
        s.expanded = input.open;
    }

    if let Some(v) = coalesce_bool(input.disabled, input.aria_disabled) {
        s.disabled = Some(v);
    }
    if let Some(v) = coalesce_bool(input.checked, input.aria_checked) {
        s.checked = Some(v);
    }
    if let Some(v) = coalesce_bool(input.selected, input.aria_selected) {
        s.selected = Some(v);
    }
    if let Some(v) = coalesce_bool(input.expanded, input.aria_expanded) {
        s.expanded = Some(v);
    }
    if let Some(v) = coalesce_bool(input.pressed, input.aria_pressed) {
        s.pressed = Some(v);
    }
    if let Some(v) = coalesce_bool(input.required, input.aria_required) {
        s.required = Some(v);
    }
    if let Some(v) = coalesce_bool(input.readonly, input.aria_readonly) {
        s.readonly = Some(v);
    }
    if let Some(v) = coalesce_bool(input.invalid, input.aria_invalid) {
        s.invalid = Some(v);
    }
    if let Some(v) = coalesce_bool(input.hidden, input.aria_hidden) {
        s.hidden = Some(v);
    }
    if let Some(v) = input.aria_current {
        s.current = Some(v);
    }

    let focusable = input.is_natural_focusable
        || input.contenteditable
        || input.tabindex.is_some_and(|t| t >= 0)
        || input.interactive_role;
    if focusable {
        s.focusable = Some(true);
    }

    let interactive = input.interactive_role
        || input.has_click_handler
        || input.is_natural_focusable
        || input.contenteditable
        || input.tabindex.is_some_and(|t| t >= 0);
    if interactive {
        s.interactive = Some(true);
    }

    s
}

fn coalesce_bool(dom: Option<bool>, aria: Option<bool>) -> Option<bool> {
    match (dom, aria) {
        (Some(v), _) => Some(v),
        (None, Some(v)) => Some(v),
        (None, None) => None,
    }
}
