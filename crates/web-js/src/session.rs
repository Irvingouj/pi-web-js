use rquickjs::function::{Func, Rest};
use rquickjs::{Ctx, Object, Value};
use std::cell::Cell;
use wasm_bindgen::prelude::*;
use web_js_base::types::*;
use web_js_base::BaseSession;

// ─── WebSession ─────────────────────────────────────────────────

/// WebSession wraps BaseSession for the web environment.
/// WASM runs on the main thread; browser side-effects are executed
/// directly via web_sys.
#[wasm_bindgen]
pub struct WebSession {
    base: BaseSession,
    aborted: Cell<bool>,
}

impl Default for WebSession {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl WebSession {
    /// Create a new web session.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        let mut session = Self {
            base: BaseSession::new(),
            aborted: Cell::new(false),
        };
        crate::browser_api::init_registry();
        session.inject_registry_bindings();
        session.register_browser_globals();
        session
    }

    /// Reset the session, clearing all JS state.
    pub fn reset(&mut self) {
        self.base.reset();
        crate::browser_api::init_registry();
        self.inject_registry_bindings();
        self.register_browser_globals();
    }

    /// Check if a global variable exists (not undefined).
    pub fn has_global(&mut self, name: &str) -> bool {
        self.base.inner.with_context(|ctx| {
            let global = ctx.globals();
            match global.get::<_, rquickjs::Value>(name) {
                Ok(v) => !v.is_undefined(),
                Err(_) => false,
            }
        })
    }

    fn register_browser_globals(&mut self) {
        self.base.inner.with_context(|ctx| {
            let _ = ctx.globals().set(
                "__webJsLocalStorageGet",
                Func::new(browser_local_storage_get),
            );
            let _ = ctx.globals().set(
                "__webJsLocalStorageSet",
                Func::new(browser_local_storage_set),
            );
            let _ = ctx.globals().set(
                "__webJsLocalStorageRemove",
                Func::new(browser_local_storage_remove),
            );
            let _ = ctx.globals().set(
                "__webJsLocalStorageClear",
                Func::new(browser_local_storage_clear),
            );
            let _ = ctx.globals().set(
                "__webJsLocalStorageKey",
                Func::new(browser_local_storage_key),
            );
            let _ = ctx.globals().set(
                "__webJsLocalStorageLength",
                Func::new(browser_local_storage_length),
            );
            let _ = ctx
                .globals()
                .set("__webJsQuerySelector", Func::new(browser_query_selector));
            let _ = ctx.globals().set(
                "__webJsQuerySelectorAll",
                Func::new(browser_query_selector_all),
            );
            let _ = ctx
                .globals()
                .set("__webJsDocumentTitle", Func::new(browser_document_title));
            let _ = ctx.globals().set(
                "__webJsWindowLocationHref",
                Func::new(browser_window_location_href),
            );
        });
    }

    /// Inject async API bindings from the doc registry into the JS environment.
    /// This replaces the old hard-coded makeAsync bindings in prelude.js with
    /// dynamically generated bindings driven by the Rust registry.
    fn inject_registry_bindings(&mut self) {
        let js_code = web_js_core::api_docs::generate_js_bindings_code();
        if !js_code.is_empty() {
            let _ = self.base.inner.run_cell_unwrapped(&js_code, "");
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
    /// Sets the abort flag so any in-flight run_cell_async loop
    /// will exit cooperatively after the current async operation.
    #[wasm_bindgen(js_name = stopWith)]
    pub fn stop_with(&mut self) {
        self.aborted.set(true);
        self.base.reset();
        self.register_browser_globals();
    }

    /// Run a cell, automatically resolving all async calls
    /// directly via web_sys without yielding to JS.
    #[wasm_bindgen(js_name = runCellAsync)]
    pub async fn run_cell_async(&mut self, code: String, stdin: String) -> CellResult {
        self.aborted.set(false);
        let result = web_js_base::run_cell_async_loop(
            &mut self.base,
            &code,
            &stdin,
            |cmd| async move {
                WebSession::handle_command(&cmd)
                    .await
                    .map_err(|e| WasmAsyncError::new(e, "E_UNSUPPORTED"))
            },
            Some(&self.aborted),
        )
        .await;

        // If we exited because of abort, reset state so the session is clean
        if self.aborted.get() {
            self.base.reset();
            self.aborted.set(false);
        }

        result.into()
    }
}

fn browser_local_storage_get<'js>(
    ctx: Ctx<'js>,
    args: Rest<Value<'js>>,
) -> rquickjs::Result<Value<'js>> {
    let key = args
        .0
        .first()
        .and_then(|v| v.as_string())
        .and_then(|s| s.to_string().ok())
        .unwrap_or_default();
    let value = web_sys::window()
        .and_then(|w| w.local_storage().ok())
        .and_then(|s| s)
        .and_then(|s| s.get_item(&key).ok())
        .flatten();
    match value {
        Some(v) => Ok(rquickjs::String::from_str(ctx, &v)?.into_value()),
        None => Ok(rquickjs::Null.into_value(ctx)),
    }
}

fn browser_local_storage_set<'js>(
    ctx: Ctx<'js>,
    args: Rest<Value<'js>>,
) -> rquickjs::Result<Value<'js>> {
    let key = args
        .0
        .first()
        .and_then(|v| v.as_string())
        .and_then(|s| s.to_string().ok())
        .unwrap_or_default();
    let value = args
        .0
        .get(1)
        .and_then(|v| v.as_string())
        .and_then(|s| s.to_string().ok())
        .unwrap_or_default();
    let _ = web_sys::window()
        .and_then(|w| w.local_storage().ok())
        .and_then(|s| s)
        .and_then(|s| s.set_item(&key, &value).ok());
    Ok(rquickjs::Null.into_value(ctx))
}

fn browser_local_storage_remove<'js>(
    ctx: Ctx<'js>,
    args: Rest<Value<'js>>,
) -> rquickjs::Result<Value<'js>> {
    let key = args
        .0
        .first()
        .and_then(|v| v.as_string())
        .and_then(|s| s.to_string().ok())
        .unwrap_or_default();
    let _ = web_sys::window()
        .and_then(|w| w.local_storage().ok())
        .and_then(|s| s)
        .and_then(|s| s.remove_item(&key).ok());
    Ok(rquickjs::Null.into_value(ctx))
}

fn browser_local_storage_clear<'js>(
    ctx: Ctx<'js>,
    _args: Rest<Value<'js>>,
) -> rquickjs::Result<Value<'js>> {
    let _ = web_sys::window()
        .and_then(|w| w.local_storage().ok())
        .and_then(|s| s)
        .and_then(|s| s.clear().ok());
    Ok(rquickjs::Null.into_value(ctx))
}

fn browser_local_storage_key<'js>(
    ctx: Ctx<'js>,
    args: Rest<Value<'js>>,
) -> rquickjs::Result<Value<'js>> {
    let index = args.0.first().and_then(|v| v.as_int()).unwrap_or(0);
    let value = web_sys::window()
        .and_then(|w| w.local_storage().ok())
        .and_then(|s| s)
        .and_then(|s| s.key(index as u32).ok())
        .flatten();
    match value {
        Some(v) => Ok(rquickjs::String::from_str(ctx, &v)?.into_value()),
        None => Ok(rquickjs::Null.into_value(ctx)),
    }
}

fn browser_local_storage_length<'js>(
    ctx: Ctx<'js>,
    _args: Rest<Value<'js>>,
) -> rquickjs::Result<Value<'js>> {
    let len = web_sys::window()
        .and_then(|w| w.local_storage().ok())
        .and_then(|s| s)
        .map(|s| s.length().unwrap_or(0))
        .unwrap_or(0);
    Ok(rquickjs::Value::new_int(ctx, len as i32))
}

fn browser_query_selector<'js>(
    ctx: Ctx<'js>,
    args: Rest<Value<'js>>,
) -> rquickjs::Result<Value<'js>> {
    let selector = args
        .0
        .first()
        .and_then(|v| v.as_string())
        .and_then(|s| s.to_string().ok())
        .unwrap_or_default();
    let element = web_sys::window()
        .and_then(|w| w.document())
        .and_then(|d| d.query_selector(&selector).ok())
        .flatten();
    if let Some(el) = element {
        let obj = Object::new(ctx)?;
        let _ = obj.set("tagName", el.tag_name());
        let _ = obj.set(
            "value",
            el.dyn_ref::<web_sys::HtmlInputElement>()
                .map(|i| i.value())
                .unwrap_or_default(),
        );
        let _ = obj.set("refId", el.get_attribute("data-ref-id").unwrap_or_default());
        let _ = obj.set(
            "text",
            el.text_content()
                .unwrap_or_default()
                .chars()
                .take(100)
                .collect::<String>(),
        );
        Ok(obj.into_value())
    } else {
        Ok(rquickjs::Null.into_value(ctx))
    }
}

fn browser_query_selector_all<'js>(
    ctx: Ctx<'js>,
    args: Rest<Value<'js>>,
) -> rquickjs::Result<Value<'js>> {
    let selector = args
        .0
        .first()
        .and_then(|v| v.as_string())
        .and_then(|s| s.to_string().ok())
        .unwrap_or_default();
    let document = match web_sys::window().and_then(|w| w.document()) {
        Some(d) => d,
        None => {
            let arr = Object::new(ctx)?;
            let _ = arr.set("length", 0);
            return Ok(arr.into_value());
        }
    };
    let elements = match document.query_selector_all(&selector) {
        Ok(nl) => nl,
        Err(_) => {
            let arr = Object::new(ctx)?;
            let _ = arr.set("length", 0);
            return Ok(arr.into_value());
        }
    };
    let arr = Object::new(ctx.clone())?;
    let len = elements.length();
    let _ = arr.set("length", len as i32);
    for i in 0..len {
        if let Some(el) = elements.item(i) {
            if let Some(el) = el.dyn_ref::<web_sys::Element>() {
                let obj = Object::new(ctx.clone())?;
                let _ = obj.set("tagName", el.tag_name());
                let _ = obj.set(
                    "value",
                    el.dyn_ref::<web_sys::HtmlInputElement>()
                        .map(|i| i.value())
                        .unwrap_or_default(),
                );
                let _ = obj.set("refId", el.get_attribute("data-ref-id").unwrap_or_default());
                let _ = obj.set(
                    "text",
                    el.text_content()
                        .unwrap_or_default()
                        .chars()
                        .take(100)
                        .collect::<String>(),
                );
                let _ = arr.set(i.to_string(), obj);
            }
        }
    }
    Ok(arr.into_value())
}

fn browser_document_title<'js>(
    ctx: Ctx<'js>,
    _args: Rest<Value<'js>>,
) -> rquickjs::Result<Value<'js>> {
    let title = web_sys::window()
        .and_then(|w| w.document())
        .map(|d| d.title())
        .unwrap_or_default();
    Ok(rquickjs::String::from_str(ctx, &title)?.into_value())
}

fn browser_window_location_href<'js>(
    ctx: Ctx<'js>,
    _args: Rest<Value<'js>>,
) -> rquickjs::Result<Value<'js>> {
    let href = web_sys::window()
        .and_then(|w| w.location().href().ok())
        .unwrap_or_default();
    Ok(rquickjs::String::from_str(ctx, &href)?.into_value())
}

impl WebSession {
    async fn handle_command(cmd: &WasmAsyncCommand) -> Result<WasmAsyncResponse, String> {
        tracing::info!(
            "[handle_command] action={} call_id={}",
            cmd.action,
            cmd.call_id
        );

        let core_cmd = web_js_core::AsyncCommand {
            call_id: cmd.call_id,
            action: cmd.action.clone(),
            params: cmd.params.clone(),
            run_id: cmd.run_id.clone(),
        };

        let result = web_js_core::handler_registry::dispatch_command(&core_cmd).await;

        let wasm_result = result.map(|resp| WasmAsyncResponse {
            ok: resp.ok,
            value: resp.value,
            error: resp.error.map(|e| WasmAsyncError::new(e.message, e.code)),
        });

        match &wasm_result {
            Ok(resp) => tracing::info!("[handle_command] action={} ok={}", cmd.action, resp.ok),
            Err(e) => tracing::info!("[handle_command] action={} error={}", cmd.action, e),
        }
        wasm_result
    }
}
