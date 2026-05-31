pub mod browser_api;
pub mod session;

pub use session::WebSession;

#[wasm_bindgen::prelude::wasm_bindgen(start)]
pub fn main() {
    console_error_panic_hook::set_once();
    tracing_wasm::set_as_global_default();
    tracing::info!("web-js WASM initialized, tracing enabled");
}

/// Generate API documentation for the JS runtime.
#[wasm_bindgen::prelude::wasm_bindgen(js_name = generateApiDocs)]
pub fn generate_api_docs(format: &str) -> String {
    // Ensure the registry is populated even when no session has been created
    // (e.g. during the build step).
    web_js_core::api_docs::register_all_api_docs();
    web_js_core::api_docs::generate(format)
}
