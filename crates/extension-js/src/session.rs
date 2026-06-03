use crate::browser_api::{init_extension_registry, init_fs_registry};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use web_js_base::types::*;
use web_js_base::BaseSession;
use tracing::Instrument;
use std::sync::atomic::{AtomicU64, Ordering};

static SESSION_COUNTER: AtomicU64 = AtomicU64::new(0);

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
    session_id: String,
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
        init_fs_registry();
        init_extension_registry();
        let session_id = format!("sess_{}", SESSION_COUNTER.fetch_add(1, Ordering::Relaxed));
        let mut session = Self {
            base: BaseSession::new(),
            session_id,
        };
        session.inject_registry_bindings();
        tracing::info!(session_id = %session.session_id, "session_created");
        session
    }

    /// Reset the session, clearing all JS state.
    pub fn reset(&mut self) {
        self.base.reset();
        init_fs_registry();
        init_extension_registry();
        self.inject_registry_bindings();
        tracing::info!(session_id = %self.session_id, "session_reset");
    }

    /// Inject async API bindings from the doc registry into the JS environment.
    fn inject_registry_bindings(&mut self) {
        let js_code = web_js_core::api_docs::generate_js_bindings_code();
        if !js_code.is_empty() {
            let _ = self.base.inner.run_cell(&js_code, "");
        }
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
    pub async fn run_cell_async(&mut self, code: String, stdin: String, run_id: String) -> CellResult {
        let span = tracing::info_span!("run_cell_async", session_id = %self.session_id, run_id = %run_id);
        let result = web_js_base::run_cell_async_loop(
            &mut self.base,
            &code,
            &stdin,
            |cmd| {
                let run_id_for_cmd = run_id.clone();
                async move {
                    let span = tracing::info_span!("handle_command", command_id = cmd.call_id, action = %cmd.action, run_id = %run_id_for_cmd);
                    async {
                        match ExtensionSession::handle_command(&cmd).await {
                            Ok(r) => Ok(r),
                            Err(e) => Err(WasmAsyncError {
                                message: e,
                                code: "E_RELAY_ERROR".into(),
                            }),
                        }
                    }.instrument(span).await
                }
            },
            None,
        ).instrument(span).await;

        result.into()
    }
}

impl ExtensionSession {
    async fn handle_command(cmd: &WasmAsyncCommand) -> Result<WasmAsyncResponse, String> {
        tracing::info!(call_id = cmd.call_id, action = %cmd.action, "handle_command_start");

        // If action starts with "fs_", dispatch via the local registry.
        if cmd.action.starts_with("fs_") {
            let core_cmd = web_js_core::AsyncCommand {
                call_id: cmd.call_id,
                action: cmd.action.clone(),
                params: cmd.params.clone(),
            };
            match web_js_core::handler_registry::dispatch_command(&core_cmd).await {
                Ok(resp) => {
                    let wasm_resp = WasmAsyncResponse {
                        ok: resp.ok,
                        value: resp.value,
                        error: resp.error.map(|e| WasmAsyncError {
                            message: e.message,
                            code: e.code,
                        }),
                    };
                    tracing::info!(call_id = cmd.call_id, action = %cmd.action, ok = wasm_resp.ok, "handle_command_fs_done");
                    return Ok(wasm_resp);
                }
                Err(e) => {
                    tracing::info!(call_id = cmd.call_id, action = %cmd.action, error = %e, "handle_command_fs_error");
                    return Err(e);
                }
            }
        }

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

        tracing::info!(call_id = cmd.call_id, action = %cmd.action, ok = resp.ok, "handle_command_relay_done");
        Ok(resp)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block_on<F: std::future::Future>(f: F) -> F::Output {
        use std::task::{Context, Poll, Waker};
        let waker = unsafe { Waker::from_raw(std::task::RawWaker::new(std::ptr::null(), &VTABLE)) };
        let mut context = Context::from_waker(&waker);
        let mut pinned = std::boxed::Box::pin(f);
        loop {
            match pinned.as_mut().poll(&mut context) {
                Poll::Ready(val) => return val,
                Poll::Pending => {},
            }
        }
    }

    static VTABLE: std::task::RawWakerVTable = std::task::RawWakerVTable::new(
        |_| std::task::RawWaker::new(std::ptr::null(), &VTABLE),
        |_| {},
        |_| {},
        |_| {},
    );

    #[test]
    fn test_extension_session_new_initializes_fs_registry() {
        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_docs();

        // Before creating session, registry should be empty
        assert!(web_js_core::handler_registry::is_empty());

        // Creating a session should initialize the fs registry
        let _session = ExtensionSession::new();

        // After creating session, fs handlers should be registered
        let handlers = web_js_core::handler_registry::list_handlers();
        assert!(
            handlers.iter().any(|h| h.starts_with("fs_")),
            "ExtensionSession::new() should register fs handlers"
        );

        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_docs();
    }

    #[test]
    fn test_extension_session_new_initializes_extension_registry() {
        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_docs();

        let _session = ExtensionSession::new();

        // Doc registry should contain extension-only APIs so that
        // generate_js_bindings_code() produces JS bindings for them.
        let docs = web_js_core::api_docs::list_docs();
        let doc_actions: Vec<String> = docs
            .iter()
            .filter_map(|d| d.action.clone())
            .collect();

        assert!(
            doc_actions.iter().any(|a| a == "chrome_tabs_query"),
            "Doc registry should contain chrome_tabs_query for JS binding generation"
        );
        assert!(
            doc_actions.iter().any(|a| a == "chrome_action_setBadgeText"),
            "Doc registry should contain chrome_action_setBadgeText for JS binding generation"
        );
        assert!(
            doc_actions.iter().any(|a| a == "tab_query"),
            "Doc registry should contain tab_query for JS binding generation"
        );
        assert!(
            doc_actions.iter().any(|a| a == "bookmarks_search"),
            "Doc registry should contain bookmarks_search for JS binding generation"
        );

        // Verify generate_js_bindings_code() actually produces bindings for them
        let js = web_js_core::api_docs::generate_js_bindings_code();
        assert!(
            js.contains("chrome.tabs"),
            "JS bindings should include chrome.tabs namespace"
        );
        assert!(
            js.contains("chrome.action"),
            "JS bindings should include chrome.action namespace"
        );
        assert!(
            js.contains("web.tab"),
            "JS bindings should include web.tab namespace"
        );
        assert!(
            js.contains("web.bookmarks"),
            "JS bindings should include web.bookmarks namespace"
        );

        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_docs();
    }

    #[test]
    fn test_extension_registry_includes_new_actions() {
        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_docs();

        let _session = ExtensionSession::new();

        // Doc registry should contain the 4 newly added extension-only APIs
        let docs = web_js_core::api_docs::list_docs();
        let doc_actions: Vec<String> = docs
            .iter()
            .filter_map(|d| d.action.clone())
            .collect();

        assert!(
            doc_actions.iter().any(|a| a == "chrome_windows_getCurrent"),
            "Doc registry should contain chrome_windows_getCurrent for JS binding generation"
        );
        assert!(
            doc_actions.iter().any(|a| a == "chrome_sessions_getRecentlyClosed"),
            "Doc registry should contain chrome_sessions_getRecentlyClosed for JS binding generation"
        );
        assert!(
            doc_actions.iter().any(|a| a == "chrome_sessions_getDevices"),
            "Doc registry should contain chrome_sessions_getDevices for JS binding generation"
        );
        assert!(
            doc_actions.iter().any(|a| a == "chrome_sessions_restore"),
            "Doc registry should contain chrome_sessions_restore for JS binding generation"
        );

        // Verify generate_js_bindings_code() produces bindings for the new namespaces
        let js = web_js_core::api_docs::generate_js_bindings_code();
        assert!(
            js.contains("chrome.windows"),
            "JS bindings should include chrome.windows namespace"
        );
        assert!(
            js.contains("chrome.sessions"),
            "JS bindings should include chrome.sessions namespace"
        );

        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_docs();
    }

    #[test]
    fn test_fs_commands_handled_locally() {
        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_docs();

        init_fs_registry();

        // Verify fs handlers are registered
        let handlers = web_js_core::handler_registry::list_handlers();
        assert!(handlers.iter().any(|h| h == "fs_exists"), "fs_exists should be registered");
        assert!(handlers.iter().any(|h| h == "fs_read"), "fs_read should be registered");
        assert!(handlers.iter().any(|h| h == "fs_write"), "fs_write should be registered");

        // Verify dispatch works for an fs command
        let cmd = web_js_core::AsyncCommand {
            call_id: 1,
            action: "fs_exists".to_string(),
            params: serde_json::json!({"path": "/tmp"}),
        };
        let result = block_on(web_js_core::handler_registry::dispatch_command(&cmd));
        // fs_exists returns a boolean, so it should succeed
        assert!(
            result.is_ok(),
            "fs_exists should dispatch successfully: {:?}",
            result.err()
        );

        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_docs();
    }

    #[test]
    fn test_non_fs_commands_relayed() {
        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_docs();

        init_fs_registry();

        let handlers = web_js_core::handler_registry::list_handlers();

        // Non-fs commands should NOT be in the local registry
        assert!(
            !handlers.iter().any(|h| h == "fetch"),
            "fetch should NOT be in extension fs registry"
        );
        assert!(
            !handlers.iter().any(|h| h == "page_click"),
            "page_click should NOT be in extension fs registry"
        );
        assert!(
            !handlers.iter().any(|h| h == "sleep"),
            "sleep should NOT be in extension fs registry"
        );

        // Verify dispatch returns "not available" for non-fs commands,
        // which forces ExtensionSession::handle_command to relay them.
        let cmd = web_js_core::AsyncCommand {
            call_id: 1,
            action: "fetch".to_string(),
            params: serde_json::json!({}),
        };
        let result = block_on(web_js_core::handler_registry::dispatch_command(&cmd));
        assert!(result.is_err(), "fetch should return error in extension context");
        assert!(result.unwrap_err().contains("not available"));

        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_docs();
    }
}
