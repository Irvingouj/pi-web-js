/// Normalize a CSS display value string.
pub fn is_display_none(display: &str) -> bool {
    display.trim() == "none"
}

/// Normalize a CSS visibility value string.
pub fn is_visibility_hidden(visibility: &str) -> bool {
    matches!(visibility.trim(), "hidden" | "collapse")
}

/// Determine if an element is effectively zero-size.
pub fn is_zero_size(width: f64, height: f64, is_text_node: bool, is_interactive: bool) -> bool {
    if width <= 0.0 || height <= 0.0 {
        // Interactive or text elements are still meaningful even if zero-size
        if !is_text_node && !is_interactive {
            return true;
        }
    }
    false
}

/// Compute whether a rect is within the viewport.
pub fn in_viewport(rect: &crate::model::Rect, viewport_width: f64, viewport_height: f64) -> bool {
    rect.right > 0.0
        && rect.bottom > 0.0
        && rect.left < viewport_width
        && rect.top < viewport_height
}
