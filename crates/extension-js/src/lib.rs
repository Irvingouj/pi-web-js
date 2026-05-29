pub mod log;
pub mod session;

pub use log::set_log_level;
pub use session::ExtensionSession;

use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = generateApiDocs)]
pub fn generate_api_docs(format: String) -> String {
    let _session = ExtensionSession::new();
    web_js_core::api_docs::generate(&format)
}
