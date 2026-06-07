use crate::browser_api::init_fs_registry;
use wasm_bindgen::prelude::*;
use web_js_base::types::*;
use web_js_base::BaseSession;
use tracing::Instrument;
use std::sync::atomic::{AtomicU64, Ordering};

static SESSION_COUNTER: AtomicU64 = AtomicU64::new(0);

// ─── ExtensionSession ───────────────────────────────────────────

/// ExtensionSession wraps BaseSession for the Chrome Extension environment.
/// WASM runs inside a Web Worker; all browser side-effects are dispatched
/// through the unified executable handler registry (Rust-local handlers or JS-registered callbacks).
#[wasm_bindgen]
pub struct ExtensionSession {
    base: BaseSession,
    session_id: String,
    aborted: std::cell::Cell<bool>,
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
        let session_id = format!("sess_{}", SESSION_COUNTER.fetch_add(1, Ordering::Relaxed));
        let session = Self {
            base: BaseSession::new_extension(),
            session_id,
            aborted: std::cell::Cell::new(false),
        };
        tracing::info!(session_id = %session.session_id, "session_created");
        session
    }

    /// Reset the session, clearing all JS state.
    pub fn reset(&mut self) {
        // Perform immediate context recreation so bindings are injected into
        // the new context, not the old one that will be discarded.
        self.base.reset_now();
        init_fs_registry();
        self.inject_registry_bindings();
        tracing::info!(session_id = %self.session_id, "session_reset");
    }

    /// Inject async and sync API bindings from the doc registry into the JS environment.
    /// Must be called after all manifest entries are registered.
    #[wasm_bindgen(js_name = injectRegistryBindings)]
    pub fn inject_registry_bindings(&mut self) {
        let js_code = web_js_core::api_docs::generate_js_bindings_code();
        if !js_code.is_empty() {
            let _ = self.base.inner.run_cell_unwrapped(&js_code, "");
        }
        let sync_js_code = web_js_core::api_docs::generate_js_sync_bindings_code();
        if !sync_js_code.is_empty() {
            let _ = self.base.inner.run_cell_unwrapped(&sync_js_code, "");
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

    /// Generate API documentation for every registered public API.
    #[wasm_bindgen(js_name = apiDocs)]
    pub fn api_docs(&self, format: String) -> Result<String, JsValue> {
        web_js_core::api_docs::generate(&format)
            .map_err(|e| JsValue::from_str(&e))
    }

    /// Clean up the session and release resources.
    #[wasm_bindgen(js_name = stopWith)]
    pub fn stop_with(&mut self) {
        self.base.reset();
    }

    /// Signal the async execution loop to abort between command batches.
    #[wasm_bindgen(js_name = setAborted)]
    pub fn set_aborted(&self, value: bool) {
        self.aborted.set(value);
    }

    /// Run a cell, automatically resolving all async calls through the
    /// unified handler registry.
    #[wasm_bindgen(js_name = runCellAsync)]
    pub async fn run_cell_async(&mut self, code: String, stdin: String, run_id: String) -> CellResult {
        let span = tracing::info_span!("run_cell_async", session_id = %self.session_id, run_id = %run_id);
        self.aborted.set(false);
        let result = web_js_base::run_cell_async_loop(
            &mut self.base,
            &code,
            &stdin,
            |mut cmd| {
                let run_id_for_cmd = run_id.clone();
                async move {
                    cmd.run_id = Some(run_id_for_cmd);
                    let span = tracing::info_span!("handle_command", command_id = cmd.call_id, action = %cmd.action, run_id = ?cmd.run_id);
                    async {
                        match ExtensionSession::handle_command(&cmd).await {
                            Ok(r) => Ok(r),
                            Err(e) => Err(WasmAsyncError {
                                message: e,
                                code: "E_DISPATCH_ERROR".into(),
                            }),
                        }
                    }.instrument(span).await
                }
            },
            Some(&self.aborted),
        ).instrument(span).await;

        result.into()
    }
}

impl ExtensionSession {
    async fn handle_command(cmd: &WasmAsyncCommand) -> Result<WasmAsyncResponse, String> {
        tracing::info!(call_id = cmd.call_id, action = %cmd.action, run_id = ?cmd.run_id, "handle_command_start");

        let core_cmd = web_js_core::AsyncCommand {
            call_id: cmd.call_id,
            action: cmd.action.clone(),
            params: cmd.params.clone(),
            run_id: cmd.run_id.clone(),
        };

        match web_js_core::api_docs::dispatch_handler(&cmd.action, core_cmd) {
            Some(fut) => {
                let resp = fut.await?;
                let wasm_resp = WasmAsyncResponse {
                    ok: resp.ok,
                    value: resp.value,
                    error: resp.error.map(|e| WasmAsyncError {
                        message: e.message,
                        code: e.code,
                    }),
                };
                tracing::info!(call_id = cmd.call_id, action = %cmd.action, ok = wasm_resp.ok, "handle_command_done");
                Ok(wasm_resp)
            }
            None => {
                tracing::warn!(call_id = cmd.call_id, action = %cmd.action, "handle_command_unknown_action");
                Err(format!("Unknown action: {}", cmd.action))
            }
        }
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

        // After creating session, fs manifest entries should be registered with handlers
        let entries = web_js_core::api_docs::list_manifest_entries();
        let fs_entries: Vec<_> = entries.iter().filter(|e| e.namespace == "fs" && e.action.as_ref().map(|a| web_js_core::api_docs::has_handler(a)).unwrap_or(false)).collect();
        assert!(
            !fs_entries.is_empty(),
            "ExtensionSession::new() should register fs manifest entries with handlers"
        );

        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_docs();
    }

    #[test]
    fn test_extension_session_new_has_no_js_registered_entries() {
        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_manifest_entries();

        let _session = ExtensionSession::new();

        // JS-registered APIs should NOT be hardcoded in the Rust registry.
        // They are supplied by the JS manifest via register_js_call().
        let docs = web_js_core::api_docs::list_docs();
        let doc_actions: Vec<String> = docs
            .iter()
            .filter_map(|d| d.action.clone())
            .collect();

        assert!(
            !doc_actions.iter().any(|a| a == "chrome_tabs_query"),
            "chrome_tabs_query should NOT be in Rust registry at session creation"
        );
        assert!(
            !doc_actions.iter().any(|a| a == "chrome_action_setBadgeText"),
            "chrome_action_setBadgeText should NOT be in Rust registry at session creation"
        );
        assert!(
            !doc_actions.iter().any(|a| a == "tab_query"),
            "tab_query should NOT be in Rust registry at session creation"
        );
        assert!(
            !doc_actions.iter().any(|a| a == "bookmarks_search"),
            "bookmarks_search should NOT be in Rust registry at session creation"
        );

        // RustCore APIs should be present
        assert!(
            doc_actions.iter().any(|a| a == "url_parse"),
            "RustCore url_parse should be registered"
        );
        assert!(
            doc_actions.iter().any(|a| a == "crypto_sha256"),
            "RustCore crypto_sha256 should be registered"
        );

        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_manifest_entries();
    }

    #[test]
    fn test_js_manifest_registration_produces_bindings() {
        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_manifest_entries();

        let _session = ExtensionSession::new();

        // Simulate JS manifest registration via register_js_call
        let entry = web_js_core::api_docs::ApiManifestEntry {
            namespace: "chrome.tabs".into(),
            name: "query".into(),
            action: Some("chrome_tabs_query".into()),
            description: "Query tabs.".into(),
            params: vec![],
            returns: web_js_core::api_docs::ReturnDoc {
                js_type: "object[]".into(),
                description: "Array of tab objects.".into(),
            },
            public_name: "chrome.tabs.query".into(),
            local_name: None,
            transport: web_js_core::api_docs::ToolTransport::Async,
            tool_source: web_js_core::api_docs::ToolSource::Extension,
            fields: None,
            aliases: vec![],
            permission: None,
            example: None,
        };
        let _ = web_js_core::api_docs::register_manifest_entry(entry);
        // Register a handler so the binding is generated
        let _ = web_js_core::api_docs::register_handler(
            "chrome_tabs_query",
            web_js_core::api_docs::ApiHandler::Rust(std::rc::Rc::new(|_cmd| {
                Box::pin(async move {
                    Ok(web_js_core::AsyncResponse {
                        ok: true,
                        value: None,
                        error: None,
                    })
                })
                    as std::pin::Pin<Box<dyn std::future::Future<Output = Result<web_js_core::AsyncResponse, String>>>>
            })),
        );

        let entry2 = web_js_core::api_docs::ApiManifestEntry {
            namespace: "chrome.windows".into(),
            name: "getCurrent".into(),
            action: Some("chrome_windows_getCurrent".into()),
            description: "Get current window.".into(),
            params: vec![],
            returns: web_js_core::api_docs::ReturnDoc {
                js_type: "object".into(),
                description: "Window object.".into(),
            },
            public_name: "chrome.windows.getCurrent".into(),
            local_name: None,
            transport: web_js_core::api_docs::ToolTransport::Async,
            tool_source: web_js_core::api_docs::ToolSource::Extension,
            fields: None,
            aliases: vec![],
            permission: None,
            example: None,
        };
        let _ = web_js_core::api_docs::register_manifest_entry(entry2);
        // Register a handler so the binding is generated
        let _ = web_js_core::api_docs::register_handler(
            "chrome_windows_getCurrent",
            web_js_core::api_docs::ApiHandler::Rust(std::rc::Rc::new(|_cmd| {
                Box::pin(async move {
                    Ok(web_js_core::AsyncResponse {
                        ok: true,
                        value: None,
                        error: None,
                    })
                })
                    as std::pin::Pin<Box<dyn std::future::Future<Output = Result<web_js_core::AsyncResponse, String>>>>
            })),
        );

        // Verify generate_js_bindings_code() produces bindings for JS-registered entries
        let js = web_js_core::api_docs::generate_js_bindings_code();
        assert!(
            js.contains("chrome.tabs"),
            "JS bindings should include chrome.tabs namespace after manifest registration"
        );
        assert!(
            js.contains("chrome.windows"),
            "JS bindings should include chrome.windows namespace after manifest registration"
        );

        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_manifest_entries();
    }

    #[test]
    fn test_fs_commands_handled_locally() {
        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_docs();

        init_fs_registry();

        // Verify fs manifest entries are registered with handlers
        let entries = web_js_core::api_docs::list_manifest_entries();
        let fs_actions: Vec<String> = entries
            .iter()
            .filter(|e| e.namespace == "fs" && e.action.as_ref().map(|a| web_js_core::api_docs::has_handler(a)).unwrap_or(false))
            .filter_map(|e| e.action.clone())
            .collect();
        assert!(fs_actions.iter().any(|a| a == "fs_exists"), "fs_exists should be registered");
        assert!(fs_actions.iter().any(|a| a == "fs_read"), "fs_read should be registered");
        assert!(fs_actions.iter().any(|a| a == "fs_write"), "fs_write should be registered");

        // Verify dispatch works for an fs command (handler_registry checks manifest first)
        let cmd = web_js_core::AsyncCommand {
            call_id: 1,
            action: "fs_exists".to_string(),
            params: serde_json::json!({"path": "/tmp"}),
            run_id: None,
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

        let entries = web_js_core::api_docs::list_manifest_entries();
        let fs_actions: Vec<String> = entries
            .iter()
            .filter(|e| e.namespace == "fs" && e.action.as_ref().map(|a| web_js_core::api_docs::has_handler(a)).unwrap_or(false))
            .filter_map(|e| e.action.clone())
            .collect();

        // Non-fs commands should NOT be in the fs registry
        assert!(
            !fs_actions.iter().any(|h| h == "fetch"),
            "fetch should NOT be in extension fs registry"
        );
        assert!(
            !fs_actions.iter().any(|h| h == "page_click"),
            "page_click should NOT be in extension fs registry"
        );
        assert!(
            !fs_actions.iter().any(|h| h == "sleep"),
            "sleep should NOT be in extension fs registry"
        );

        // Verify dispatch returns "not available" for non-fs commands,
        // which forces ExtensionSession::handle_command to relay them.
        let cmd = web_js_core::AsyncCommand {
            call_id: 1,
            action: "fetch".to_string(),
            params: serde_json::json!({}),
            run_id: None,
        };
        let result = block_on(web_js_core::handler_registry::dispatch_command(&cmd));
        assert!(result.is_err(), "fetch should return error in extension context");
        assert!(result.unwrap_err().contains("not available"));

        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_docs();
    }

    #[test]
    fn test_handle_command_routes_by_handler_presence() {
        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_manifest_entries();

        // Register fs_exists as RustCore (via the fs registry init)
        init_fs_registry();

        // Register chrome_tabs_query as JS-registered
        let _ = web_js_core::api_docs::register_manifest_entry(web_js_core::api_docs::ApiManifestEntry {
            namespace: "chrome.tabs".into(),
            name: "query".into(),
            action: Some("chrome_tabs_query".into()),
            description: "Query tabs.".into(),
            params: vec![],
            returns: web_js_core::api_docs::ReturnDoc {
                js_type: "object[]".into(),
                description: "Array of tab objects.".into(),
            },
            public_name: "chrome.tabs.query".into(),
            local_name: None,
            transport: web_js_core::api_docs::ToolTransport::Async,
            tool_source: web_js_core::api_docs::ToolSource::Extension,
            fields: None,
            aliases: vec![],
            permission: None,
            example: None,
        });

        // Test 1: fs_exists routes to handler_registry and succeeds
        let cmd = WasmAsyncCommand {
            call_id: 1,
            action: "fs_exists".to_string(),
            params: serde_json::json!({"path": "/tmp"}),
            run_id: None,
        };
        let result = block_on(ExtensionSession::handle_command(&cmd));
        assert!(
            result.is_ok(),
            "fs_exists (RustCore) should route to handler_registry: {:?}",
            result.err()
        );

        // Test 2: chrome_tabs_query (JS-registered) without a registered callback
        // should return "Unknown action" because dispatch_handler finds no handler.
        let cmd = WasmAsyncCommand {
            call_id: 2,
            action: "chrome_tabs_query".to_string(),
            params: serde_json::json!({}),
            run_id: None,
        };
        let result = block_on(ExtensionSession::handle_command(&cmd));
        assert!(
            result.is_err(),
            "chrome_tabs_query (JS-registered) without callback should fail in test context"
        );
        let err = result.unwrap_err();
        assert!(
            err.contains("Unknown action: chrome_tabs_query"),
            "JS-registered without callback should report unknown action, got: {}",
            err
        );

        // Test 3: unknown action returns typed error
        let cmd = WasmAsyncCommand {
            call_id: 3,
            action: "unknown_action".to_string(),
            params: serde_json::json!({}),
            run_id: None,
        };
        let result = block_on(ExtensionSession::handle_command(&cmd));
        assert!(result.is_err(), "unknown action should return error");
        let err = result.unwrap_err();
        assert!(
            err.contains("Unknown action"),
            "Should get 'Unknown action' error, got: {}",
            err
        );

        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_manifest_entries();
    }

    #[test]
    fn test_manifest_integrity_after_init() {
        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_manifest_entries();

        let _session = ExtensionSession::new();

        // Simulate JS manifest registration for a JS-registered API
        let _ = web_js_core::api_docs::register_manifest_entry(web_js_core::api_docs::ApiManifestEntry {
            namespace: "chrome.tabs".into(),
            name: "query".into(),
            action: Some("chrome_tabs_query".into()),
            description: "Query tabs.".into(),
            params: vec![],
            returns: web_js_core::api_docs::ReturnDoc {
                js_type: "object[]".into(),
                description: "Array of tab objects.".into(),
            },
            public_name: "chrome.tabs.query".into(),
            local_name: None,
            transport: web_js_core::api_docs::ToolTransport::Async,
            tool_source: web_js_core::api_docs::ToolSource::Extension,
            fields: None,
            aliases: vec![],
            permission: None,
            example: None,
        });

        let entries = web_js_core::api_docs::list_manifest_entries();
        let mut seen_actions = std::collections::HashSet::new();

        for entry in &entries {
            let action = entry.action.clone().unwrap_or_default();
            assert!(!action.is_empty(), "manifest entry must have an action");

            // No duplicate actions
            assert!(
                !seen_actions.contains(&action),
                "duplicate action '{}' in manifest",
                action
            );
            seen_actions.insert(action);
        }

        // fs.* actions (registered via web_api! macro) have handlers in manifest
        let fs_actions: Vec<String> = entries
            .iter()
            .filter(|e| e.namespace == "fs")
            .filter_map(|e| e.action.clone())
            .collect();
        for action in &fs_actions {
            let entry = web_js_core::api_docs::get_manifest_entry(action);
            assert!(
                entry.is_some() && web_js_core::api_docs::has_handler(action),
                "fs RustCore action '{}' must have a handler in manifest",
                action
            );
        }

        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_manifest_entries();
    }

    #[test]
    fn test_js_registered_actions_have_manifest_entries() {
        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_manifest_entries();

        let _session = ExtensionSession::new();

        // Register JS-registered APIs as the JS side would
        let js_registered_actions = vec![
            ("chrome_tabs_query", "chrome.tabs", "query"),
            ("page_title", "page", "title"),
            ("page_url", "page", "url"),
            ("storage_set", "storage", "set"),
            ("fetch", "network", "fetch"),
        ];

        for (action, ns, name) in &js_registered_actions {
            let _ = web_js_core::api_docs::register_manifest_entry(web_js_core::api_docs::ApiManifestEntry {
                namespace: (*ns).into(),
                name: (*name).into(),
                action: Some((*action).into()),
                description: "Test API.".into(),
                params: vec![],
                returns: web_js_core::api_docs::ReturnDoc {
                    js_type: "null".into(),
                    description: "None".into(),
                },
                public_name: format!("{}.{}", ns, name),
                local_name: None,
                transport: web_js_core::api_docs::ToolTransport::Async,
                tool_source: web_js_core::api_docs::ToolSource::Extension,
            fields: None,
            aliases: vec![],
            permission: None,
            example: None,
        });
        }

        // Verify each action is in the manifest
        for (action, _ns, _name) in &js_registered_actions {
            let entry = web_js_core::api_docs::get_manifest_entry(action);
            assert!(
                entry.is_some(),
                "action '{}' must be in manifest",
                action
            );
        }

        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_manifest_entries();
    }

    #[test]
    fn test_fs_actions_have_handlers() {
        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_docs();

        init_fs_registry();

        let entries = web_js_core::api_docs::list_manifest_entries();

        // fs.* RustCore actions have Rust handlers (registered via web_api! macro)
        let expected_fs_handlers = vec![
            "fs_exists",
            "fs_stat",
            "fs_list",
            "fs_read",
            "fs_read_text",
            "fs_write",
            "fs_write_text",
            "fs_delete",
            "fs_copy",
            "fs_move",
            "fs_mkdir",
            "fs_append",
            "fs_append_text",
            "fs_hash",
        ];

        for action in &expected_fs_handlers {
            let entry = web_js_core::api_docs::get_manifest_entry(action);
            assert!(
                entry.is_some() && web_js_core::api_docs::has_handler(action),
                "fs RustCore action '{}' must have a handler in manifest",
                action
            );
        }

        // Verify every manifest entry has a handler (fs entries only
        // after init_fs_registry, since sync APIs are registered by register_web_module).
        for entry in &entries {
            let action = entry.action.clone().unwrap_or_default();
            let is_fs = entry.namespace == "fs";
            let action_has_handler = web_js_core::api_docs::has_handler(&action);
            if is_fs {
                assert!(
                    action_has_handler,
                    "fs action '{}' must have a handler",
                    action
                );
            }
        }

        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_docs();
    }

    #[test]
    fn test_unknown_action_returns_error() {
        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_manifest_entries();

        init_fs_registry();

        // Test 1: unknown action via handler_registry dispatch returns "not available"
        let cmd = web_js_core::AsyncCommand {
            call_id: 1,
            action: "totally_unknown_action_xyz".to_string(),
            params: serde_json::json!({}),
            run_id: None,
        };
        let result = block_on(web_js_core::handler_registry::dispatch_command(&cmd));
        assert!(result.is_err(), "unknown action should return error from handler_registry");
        let err = result.unwrap_err();
        assert!(
            err.contains("not available"),
            "handler_registry error should indicate unavailability, got: {}",
            err
        );

        // Test 2: unknown action via handle_command returns "Unknown action"
        let cmd = WasmAsyncCommand {
            call_id: 2,
            action: "totally_unknown_action_xyz".to_string(),
            params: serde_json::json!({}),
            run_id: None,
        };
        let result = block_on(ExtensionSession::handle_command(&cmd));
        assert!(result.is_err(), "unknown action should return error from handle_command");
        let err = result.unwrap_err();
        assert!(
            err.contains("Unknown action"),
            "handle_command error should be 'Unknown action', got: {}",
            err
        );

        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_manifest_entries();
    }

    #[test]
    fn test_generate_docs_json_includes_rust_fs_apis() {
        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_manifest_entries();

        let _session = ExtensionSession::new();

        let json = web_js_core::api_docs::generate("json").expect("json docs");
        assert!(json.contains("\"public_name\": \"fs.exists\""));
        assert!(json.contains("\"action\": \"fs_exists\""));
        assert!(json.contains("\"tool_source\": \"RustCore\""));

        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_manifest_entries();
    }

    #[test]
    fn test_generate_docs_markdown_groups_by_namespace() {
        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_manifest_entries();

        let _session = ExtensionSession::new();

        let markdown = web_js_core::api_docs::generate("markdown")
            .expect("markdown docs");
        assert!(markdown.contains("## `fs` module"));
        assert!(markdown.contains("fs.exists"));
        assert!(markdown.contains("_(action: `fs_exists`)_"));
        assert!(markdown.contains("**Parameters**"));
        assert!(markdown.contains("**Returns**"));

        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_manifest_entries();
    }

    #[test]
    fn test_generate_docs_includes_aliases() {
        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_manifest_entries();

        let _session = ExtensionSession::new();

        let entry = web_js_core::api_docs::ApiManifestEntry {
            namespace: "web".into(),
            name: "fetch".into(),
            action: Some("fetch".into()),
            description: "Fetch a URL.".into(),
            params: vec![],
            returns: web_js_core::api_docs::ReturnDoc {
                js_type: "object".into(),
                description: "Response.".into(),
            },
            public_name: "web.fetch".into(),
            local_name: None,
            transport: web_js_core::api_docs::ToolTransport::Async,
            tool_source: web_js_core::api_docs::ToolSource::Extension,
            fields: Some(vec!["url".into()]),
            aliases: vec![web_js_core::api_docs::ApiAlias {
                namespace: "network".into(),
                name: "fetch".into(),
                fields: Some(vec!["url".into()]),
            }],
            permission: None,
            example: None,
        };
        let _ = web_js_core::api_docs::register_manifest_entry(entry);
        let _ = web_js_core::api_docs::register_handler(
            "fetch",
            web_js_core::api_docs::ApiHandler::Rust(std::rc::Rc::new(|_cmd| {
                Box::pin(async move {
                    Ok(web_js_core::AsyncResponse {
                        ok: true,
                        value: None,
                        error: None,
                    })
                })
                    as std::pin::Pin<
                        Box<dyn std::future::Future<Output = Result<web_js_core::AsyncResponse, String>>>,
                    >
            })),
        );

        let json = web_js_core::api_docs::generate("json").expect("json docs");
        assert!(json.contains("\"namespace\": \"network\""));
        assert!(json.contains("\"name\": \"fetch\""));

        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_manifest_entries();
    }

    #[test]
    fn test_generate_docs_includes_registered_extension_manifest_entry() {
        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_manifest_entries();

        let _session = ExtensionSession::new();

        let entry = web_js_core::api_docs::ApiManifestEntry {
            namespace: "contract".into(),
            name: "docs_export".into(),
            action: Some("contract_docs_export".into()),
            description: "Contract docs export test.".into(),
            params: vec![web_js_core::api_docs::ParamDoc {
                name: "key".into(),
                js_type: "string".into(),
                required: true,
                description: "Lookup key.".into(),
            }],
            returns: web_js_core::api_docs::ReturnDoc {
                js_type: "string".into(),
                description: "Lookup result.".into(),
            },
            public_name: "contract.docs_export".into(),
            local_name: None,
            transport: web_js_core::api_docs::ToolTransport::Async,
            tool_source: web_js_core::api_docs::ToolSource::Extension,
            fields: Some(vec!["key".into()]),
            aliases: vec![],
            permission: None,
            example: None,
        };
        let _ = web_js_core::api_docs::register_manifest_entry(entry);
        let _ = web_js_core::api_docs::register_handler(
            "contract_docs_export",
            web_js_core::api_docs::ApiHandler::Rust(std::rc::Rc::new(|_cmd| {
                Box::pin(async move {
                    Ok(web_js_core::AsyncResponse {
                        ok: true,
                        value: Some(serde_json::json!("ok")),
                        error: None,
                    })
                })
                    as std::pin::Pin<
                        Box<dyn std::future::Future<Output = Result<web_js_core::AsyncResponse, String>>>,
                    >
            })),
        );

        let json = web_js_core::api_docs::generate("json").expect("json docs");
        assert!(json.contains("\"public_name\": \"contract.docs_export\""));
        assert!(json.contains("\"description\": \"Contract docs export test.\""));
        assert!(json.contains("\"tool_source\": \"Extension\""));

        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_manifest_entries();
    }

    #[test]
    fn test_reset_reinjects_bindings() {
        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_manifest_entries();

        let mut session = ExtensionSession::new();

        // Verify bindings exist after init (fs namespace should be present)
        let js_before = web_js_core::api_docs::generate_js_bindings_code();
        assert!(!js_before.is_empty(), "Bindings should exist after init");
        assert!(
            js_before.contains("fs"),
            "Bindings should include fs namespace after init"
        );

        // Simulate the JS side freezing the manifest after init
        assert!(
            web_js_core::api_docs::freeze_manifest().is_ok(),
            "freeze_manifest should succeed after init (sync APIs are not orphans)"
        );

        // Reset the session
        session.reset();

        // Verify bindings exist after reset
        let js_after = web_js_core::api_docs::generate_js_bindings_code();
        assert!(!js_after.is_empty(), "Bindings should be re-injected after reset");
        assert!(
            js_after.contains("fs"),
            "Bindings should include fs namespace after reset"
        );

        // Verify a RustCore handler remains dispatchable after reset
        let cmd = WasmAsyncCommand {
            call_id: 1,
            action: "fs_exists".to_string(),
            run_id: None,
            params: serde_json::json!({"path": "/tmp"}),
        };
        let result = block_on(ExtensionSession::handle_command(&cmd));
        assert!(
            result.is_ok(),
            "fs_exists should dispatch after reset: {:?}",
            result.err()
        );

        web_js_core::handler_registry::clear_handlers();
        web_js_core::api_docs::clear_manifest_entries();
    }
}

// ─── Macro-generated wasm_bindgen fs methods ──────────────────────
crate::impl_extension_session_fs!();
