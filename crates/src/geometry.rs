use crate::model::Rect;

pub fn rect_from_values(x: f64, y: f64, width: f64, height: f64) -> Rect {
    Rect {
        x,
        y,
        width,
        height,
        top: y,
        right: x + width,
        bottom: y + height,
        left: x,
    }
}

pub fn dom_rect_to_rect(dom_rect: &web_sys::DomRect) -> Rect {
    rect_from_values(
        dom_rect.x(),
        dom_rect.y(),
        dom_rect.width(),
        dom_rect.height(),
    )
}
