pub mod browser_api;
pub mod session;

pub use session::WebSession;

#[wasm_bindgen::prelude::wasm_bindgen(start)]
pub fn main() {
    console_error_panic_hook::set_once();
    tracing_wasm::set_as_global_default();
    tracing::info!("web-js WASM initialized, tracing enabled");
}

