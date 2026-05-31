pub mod log;
pub mod session;

pub use log::set_log_level;
pub use session::ExtensionSession;

use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn main() {
    tracing_wasm::set_as_global_default();
    web_sys::console::log_1(&wasm_bindgen::JsValue::from_str("[tracing-wasm] init ok"));
    tracing::info!("extension-js WASM initialized, tracing enabled");
    tracing::error!("[tracing-wasm] test error log");
}

#[wasm_bindgen(js_name = generateApiDocs)]
pub fn generate_api_docs(format: String) -> String {
    let _session = ExtensionSession::new();
    web_js_core::api_docs::generate(&format)
}
