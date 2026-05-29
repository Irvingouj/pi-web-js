use std::sync::atomic::{AtomicI32, Ordering};
use wasm_bindgen::prelude::*;

static LOG_LEVEL: AtomicI32 = AtomicI32::new(3); // default "error"

/// 0=debug, 1=info, 2=warn, 3=error, 4=none
#[wasm_bindgen(js_name = setLogLevel)]
pub fn set_log_level(level: i32) {
    LOG_LEVEL.store(level.clamp(0, 4), Ordering::Relaxed);
}

fn should_log(level: i32) -> bool {
    level >= LOG_LEVEL.load(Ordering::Relaxed)
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console, js_name = log)]
    fn console_log(s: &str);
    #[wasm_bindgen(js_namespace = console, js_name = warn)]
    fn console_warn(s: &str);
    #[wasm_bindgen(js_namespace = console, js_name = error)]
    fn console_error(s: &str);
}

pub fn log_debug(msg: &str) {
    if should_log(0) {
        console_log(msg);
    }
}

pub fn log_info(msg: &str) {
    if should_log(1) {
        console_log(msg);
    }
}

pub fn log_warn(msg: &str) {
    if should_log(2) {
        console_warn(msg);
    }
}

pub fn log_error(msg: &str) {
    if should_log(3) {
        console_error(msg);
    }
}
