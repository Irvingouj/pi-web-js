pub mod browser_api;
pub mod fs;
pub mod log;
pub mod session;

pub use log::set_log_level;
pub use session::ExtensionSession;

use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
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

#[wasm_bindgen(js_name = registerJsCall)]
pub fn register_js_call(
    entry: web_js_core::api_docs::JsManifestEntry,
    callback: js_sys::Function,
) -> Result<(), JsValue> {
    let action = entry.action.clone();
    let spec = web_js_core::api_docs::ApiManifestEntry::try_from(entry)
        .map_err(|e| JsValue::from_str(&format!("Failed to convert manifest entry: {}", e)))?;

    web_js_core::api_docs::register_executable_entry(
        spec,
        web_js_core::api_docs::ApiHandler::JsCallback(wasm_bindgen::JsValue::from(callback)),
    )
    .map_err(|e| JsValue::from_str(&format!("Failed to register JS action '{}': {}", action, e)))?;

    Ok(())
}

#[wasm_bindgen(js_name = registerSharedDispatch)]
pub fn register_shared_dispatch(callback: js_sys::Function) -> Result<(), JsValue> {
    web_js_core::api_docs::set_shared_js_dispatch(callback.into());
    Ok(())
}

#[wasm_bindgen(js_name = importManifestEntries)]
pub fn import_manifest_entries(entries: js_sys::Array) -> Result<(), JsValue> {
    let mut vec = Vec::with_capacity(entries.length() as usize);
    for i in 0..entries.length() {
        let val = entries.get(i);
        let entry: web_js_core::api_docs::JsManifestEntry = serde_wasm_bindgen::from_value(val)
            .map_err(|e| JsValue::from_str(&format!("Invalid manifest entry: {}", e)))?;
        vec.push(entry);
    }
    web_js_core::api_docs::import_js_manifest_entries(vec)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

fn require_js_field<'a>(value: &'a JsValue, field: &str) -> Result<&'a JsValue, JsValue> {
    if value.is_null() || value.is_undefined() {
        return Err(JsValue::from_str(&format!("Batch item missing '{field}' field")));
    }
    Ok(value)
}

fn require_js_function(value: JsValue, field: &str) -> Result<js_sys::Function, JsValue> {
    require_js_field(&value, field)?;
    value
        .dyn_into::<js_sys::Function>()
        .map_err(|_| JsValue::from_str(&format!("Batch item '{field}' must be a function")))
}

#[wasm_bindgen(js_name = registerJsCallBatch)]
pub fn register_js_call_batch(items: js_sys::Array) -> Result<(), JsValue> {
    let mut batch = Vec::with_capacity(items.length() as usize);
    for i in 0..items.length() {
        let item = items.get(i);
        let entry_val = js_sys::Reflect::get(&item, &"entry".into())
            .map_err(|_| JsValue::from_str("Batch item missing 'entry' field"))?;
        let callback_val = js_sys::Reflect::get(&item, &"callback".into())
            .map_err(|_| JsValue::from_str("Batch item missing 'callback' field"))?;
        require_js_field(&entry_val, "entry")?;
        let callback = require_js_function(callback_val, "callback")?;
        let entry: web_js_core::api_docs::JsManifestEntry = serde_wasm_bindgen::from_value(entry_val)
            .map_err(|e| JsValue::from_str(&format!("Invalid manifest entry: {}", e)))?;
        let spec = web_js_core::api_docs::ApiManifestEntry::try_from(entry)
            .map_err(|e| JsValue::from_str(&format!("Failed to convert manifest entry: {}", e)))?;
        batch.push((
            spec,
            web_js_core::api_docs::ApiHandler::JsCallback(callback.into()),
        ));
    }
    web_js_core::api_docs::register_executable_entries_batch(batch)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen(js_name = freezeManifest)]
pub fn freeze_manifest() {
    web_js_core::api_docs::freeze_manifest();
}

#[wasm_bindgen(js_name = generateApiDocs)]
pub fn generate_api_docs(format: String) -> Result<String, JsValue> {
    let _session = ExtensionSession::new();
    web_js_core::api_docs::generate(&format)
        .map_err(|e| JsValue::from_str(&e))
}
