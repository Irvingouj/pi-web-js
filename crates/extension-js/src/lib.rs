pub mod browser_api;
pub mod fs;
pub mod log;
pub mod session;

pub use log::set_log_level;
pub use session::ExtensionSession;

use wasm_bindgen::prelude::*;
use tracing_subscriber::{layer::SubscriberExt, Registry};
use tracing_wasm::WASMLayer;

#[wasm_bindgen(start)]
pub fn main() {
    let subscriber = Registry::default()
        .with(log::LogLevelFilterLayer)
        .with(WASMLayer::new(Default::default()));
    tracing::subscriber::set_global_default(subscriber).unwrap();
    tracing::info!("extension-js WASM initialized, tracing enabled");
}

#[wasm_bindgen(js_name = generateApiDocs)]
pub fn generate_api_docs(format: String) -> String {
    let _session = ExtensionSession::new();
    web_js_core::api_docs::generate(&format)
}
