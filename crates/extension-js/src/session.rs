use crate::log::{log_debug, log_error};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use web_js_base::types::*;
use web_js_base::BaseSession;

#[wasm_bindgen]
extern "C" {
    /// Global JS function injected by the Worker bootstrap code.
    /// Takes a WasmAsyncCommand as a JS object, relays it to the
    /// main-thread runner via postMessage, and returns a Promise
    /// that resolves with the WasmAsyncResponse.
    #[wasm_bindgen(js_name = __extension_js_relay)]
    fn extension_js_relay(cmd: JsValue) -> js_sys::Promise;
}

// ─── ExtensionSession ───────────────────────────────────────────

/// ExtensionSession wraps BaseSession for the Chrome Extension environment.
/// WASM runs inside a Web Worker; all browser side-effects are relayed
/// to the main-thread runner via the `__extension_js_relay` global function.
#[wasm_bindgen]
pub struct ExtensionSession {
    base: BaseSession,
}

impl Default for ExtensionSession {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl ExtensionSession {
    /// Create a new extension session.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            base: BaseSession::new(),
        }
    }

    /// Reset the session, clearing all JS state.
    pub fn reset(&mut self) {
        self.base.reset();
    }

    /// Set the fuel limit for execution.
    pub fn set_fuel_limit(&mut self, limit: i32) {
        self.base.set_fuel_limit(limit as u64);
    }

    /// Load a JS library by executing its source code.
    pub fn load_library(&mut self, source: &str) -> CellResult {
        self.base.load_library(source).into()
    }

    /// Inspect all global variables in the current JS state.
    pub fn inspect_globals(&mut self) -> WasmGlobalsSnapshot {
        self.base.inspect_globals()
    }

    /// Clean up the session and release resources.
    #[wasm_bindgen(js_name = stopWith)]
    pub fn stop_with(&mut self) {
        self.base.reset();
    }

    /// Run a cell, automatically resolving all async calls by relaying
    /// them to the main-thread runner via `__extension_js_relay`.
    #[wasm_bindgen(js_name = runCellAsync)]
    pub async fn run_cell_async(&mut self, code: String, stdin: String) -> CellResult {
        let result = web_js_base::run_cell_async_loop(
            &mut self.base,
            &code,
            &stdin,
            |cmd| async move {
                let action = cmd.action.clone();
                match ExtensionSession::handle_command(&cmd).await {
                    Ok(r) => {
                        log_debug(&format!(
                            "[ExtensionSession] async response: action={}",
                            action
                        ));
                        Ok(r)
                    }
                    Err(e) => {
                        log_error(&format!(
                            "[ExtensionSession] async relay error: action={}, err={}",
                            action, e
                        ));
                        Err(WasmAsyncError {
                            message: e,
                            code: "E_RELAY_ERROR".into(),
                        })
                    }
                }
            },
            None,
        )
        .await;

        result.into()
    }
}

impl ExtensionSession {
    async fn handle_command(cmd: &WasmAsyncCommand) -> Result<WasmAsyncResponse, String> {
        // Serialize command to a JSON string, then parse to a JS object.
        // This avoids serde_wasm_bindgen's default map-to-JS-Map behavior,
        // ensuring serde_json::Value::Object becomes a plain JS Object.
        let json_str = serde_json::to_string(cmd)
            .map_err(|e| format!("Failed to serialize command: {:?}", e))?;
        let js_cmd = js_sys::JSON::parse(&json_str)
            .map_err(|e| format!("Failed to parse command JSON: {:?}", e))?;

        let promise = extension_js_relay(js_cmd);
        let resp_js = JsFuture::from(promise)
            .await
            .map_err(|e| format!("Relay promise rejected: {:?}", e))?;

        // Stringify the JS response and parse as JSON to avoid
        // serde_wasm_bindgen deserialization quirks with nested objects.
        let resp_json_str = js_sys::JSON::stringify(&resp_js)
            .map_err(|e| format!("Failed to stringify response: {:?}", e))?
            .as_string()
            .ok_or_else(|| "JSON.stringify returned non-string".to_string())?;
        let resp: WasmAsyncResponse = serde_json::from_str(&resp_json_str)
            .map_err(|e| format!("Failed to deserialize response: {:?}", e))?;

        log_debug(&format!(
            "[ExtensionSession] deserialized response: ok={}",
            resp.ok
        ));
        Ok(resp)
    }
}
