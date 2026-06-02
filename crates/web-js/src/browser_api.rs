use serde_json;
use std::collections::HashMap;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use web_js_base::types::WasmAsyncError;
use web_js_base::types::WasmAsyncResponse;
use web_js_core::command_params::*;

fn wasm_to_core(resp: WasmAsyncResponse) -> web_js_core::AsyncResponse {
    web_js_core::AsyncResponse {
        ok: resp.ok,
        value: resp.value,
        error: resp.error.map(|e| web_js_core::AsyncError {
            message: e.message,
            code: e.code,
        }),
    }
}

/// Param struct for APIs that take no parameters.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct EmptyParams {}

/// Param struct for host.call action.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct HostCallParams {
    pub action: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

/// Find an element by its accessible label, placeholder, or text content.
pub fn find_element_by_label(document: &web_sys::Document, query: &str) -> Option<web_sys::Element> {
    let lower_query = query.to_lowercase().trim().to_string();
    if lower_query.is_empty() {
        return None;
    }
    let elements = document
        .query_selector_all("input, textarea, select, button, a, [role='button'], [role='link']")
        .ok()?;
    for i in 0..elements.length() {
        if let Some(node) = elements.item(i) {
            if let Ok(el) = node.dyn_into::<web_sys::Element>() {
                if let Some(aria_label) = el.get_attribute("aria-label") {
                    if aria_label.to_lowercase().trim() == lower_query {
                        return Some(el);
                    }
                }
                if let Some(input) = el.dyn_ref::<web_sys::HtmlInputElement>() {
                    if input.placeholder().to_lowercase().trim() == lower_query {
                        return Some(el);
                    }
                }
                if let Some(text) = el.text_content() {
                    if text.to_lowercase().trim() == lower_query {
                        return Some(el);
                    }
                }
            }
        }
    }
    None
}

fn no_window_response() -> WasmAsyncResponse {
    WasmAsyncResponse {
        ok: false,
        value: None,
        error: Some(WasmAsyncError {
            message: "DOM APIs not available in this context".into(),
            code: "E_NO_WINDOW".into(),
        }),
    }
}

/// Check if a string looks like a CSS selector.
fn is_selector(s: &str) -> bool {
    s.contains('.') || s.contains('#') || s.contains('[') || s.contains(' ')
}

/// Resolve a ref_id or CSS selector to an actual ref_id.
/// If `selector` is explicitly provided, use it. Otherwise, if `ref_id` looks like
/// a CSS selector, treat it as one and resolve it via page.find.
async fn resolve_ref_id_or_selector(
    document: &web_sys::Document,
    ref_id: &str,
    selector: &Option<String>,
) -> Result<String, WasmAsyncResponse> {
    let sel = selector.as_ref().map(|s| s.as_str()).or_else(|| {
        if is_selector(ref_id) {
            Some(ref_id)
        } else {
            None
        }
    });

    if let Some(sel_str) = sel {
        let find_result = execute_page_find(PageFindParams {
            selector: sel_str.to_string(),
        })
        .await;
        if let Some(value) = find_result.value {
            if let Some(arr) = value.as_array() {
                if let Some(first) = arr.first() {
                    if let Some(rid) = first.get("refId").and_then(|v| v.as_str()) {
                        return Ok(rid.to_string());
                    }
                }
            }
        }
        return Err(WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(WasmAsyncError {
                message: format!("No element matching: {}", sel_str),
                code: "E_AGENT".into(),
            }),
        });
    }
    Ok(ref_id.to_string())
}

pub async fn execute_fetch_positional(args: FetchArgs) -> WasmAsyncResponse {
    let params = match args {
        FetchArgs::Flat(p) => p,
        FetchArgs::Positional { url, options } => {
            if let Some(opts) = options {
                FetchParams {
                    url,
                    method: opts.method,
                    headers: opts.headers,
                    body: opts.body,
                    timeout: opts.timeout,
                }
            } else {
                FetchParams {
                    url,
                    method: "GET".to_string(),
                    headers: HashMap::new(),
                    body: None,
                    timeout: 30000,
                }
            }
        }
    };
    execute_fetch(params).await
}

pub async fn execute_fetch(params: FetchParams) -> WasmAsyncResponse {
    let window = match web_sys::window() {
        Some(w) => w,
        None => return no_window_response(),
    };

    let request_init = web_sys::RequestInit::new();
    request_init.set_method(&params.method);

    // Headers
    if !params.headers.is_empty() {
        let headers = match web_sys::Headers::new() {
            Ok(h) => h,
            Err(_) => {
                return WasmAsyncResponse {
                    ok: false,
                    value: None,
                    error: Some(WasmAsyncError {
                        message: "Failed to create Headers object".into(),
                        code: "E_HEADERS".into(),
                    }),
                }
            }
        };
        for (key, val) in &params.headers {
            headers.append(key, val).ok();
        }
        request_init.set_headers(&headers);
    }

    // Body
    if let Some(body_str) = &params.body {
        request_init.set_body(&JsValue::from_str(body_str));
    }

    // AbortController for timeout
    let _abort_controller = match js_sys::Reflect::get(&window, &"AbortController".into()) {
        Ok(ac_ctor) if !ac_ctor.is_undefined() => {
            let ac = js_sys::Reflect::construct(
                &ac_ctor.dyn_into::<js_sys::Function>().unwrap(),
                &js_sys::Array::new(),
            )
            .unwrap();
            let signal = js_sys::Reflect::get(&ac, &"signal".into()).unwrap();
            let signal = signal.dyn_ref::<web_sys::AbortSignal>();
            request_init.set_signal(signal);

            let set_timeout = js_sys::Reflect::get(&window, &"setTimeout".into())
                .unwrap()
                .dyn_into::<js_sys::Function>()
                .unwrap();
            let abort_fn = js_sys::Reflect::get(&ac, &"abort".into()).unwrap();
            let _ = set_timeout.call2(
                &window,
                &abort_fn,
                &JsValue::from_f64(params.timeout as f64),
            );

            Some(ac)
        }
        _ => None,
    };

    let request = match web_sys::Request::new_with_str_and_init(&params.url, &request_init) {
        Ok(r) => r,
        Err(e) => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("Invalid request: {:?}", e),
                    code: "E_BAD_REQUEST".into(),
                }),
            };
        }
    };

    let resp = match JsFuture::from(window.fetch_with_request(&request)).await {
        Ok(r) => r,
        Err(e) => {
            let is_timeout = format!("{:?}", e).contains("AbortError");
            let msg = if is_timeout {
                format!("Request timed out after {}ms", params.timeout)
            } else {
                format!("Network error: {:?}", e)
            };
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: msg,
                    code: if is_timeout {
                        "ETIMEDOUT".into()
                    } else {
                        "ENETWORK".into()
                    },
                }),
            };
        }
    };

    let response = match resp.dyn_into::<web_sys::Response>() {
        Ok(r) => r,
        Err(_) => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: "Invalid response from fetch".into(),
                    code: "E_RESPONSE".into(),
                }),
            };
        }
    };

    let status = response.status();
    let ok = response.ok();

    let body = match response.text() {
        Ok(p) => match JsFuture::from(p).await {
            Ok(b) => b.as_string().unwrap_or_default(),
            Err(_) => String::new(),
        },
        Err(_) => String::new(),
    };

    let value = serde_json::json!({
        "status": status,
        "ok": ok,
        "body": body,
    });

    WasmAsyncResponse {
        ok: true,
        value: Some(value),
        error: None,
    }
}

pub async fn execute_sleep(params: SleepParams) -> WasmAsyncResponse {
    let window = match web_sys::window() {
        Some(w) => w,
        None => return no_window_response(),
    };
    let promise = js_sys::Promise::new(
        &mut |resolve: js_sys::Function, _reject: js_sys::Function| {
            let set_timeout = js_sys::Reflect::get(&window, &"setTimeout".into())
                .unwrap()
                .dyn_into::<js_sys::Function>()
                .unwrap();
            let _ = set_timeout.call2(
                &window,
                &resolve,
                &JsValue::from_f64(params.duration as f64),
            );
        },
    );

    let _ = JsFuture::from(promise).await;

    WasmAsyncResponse {
        ok: true,
        value: Some(serde_json::Value::Null),
        error: None,
    }
}

pub async fn execute_page_wait(params: PageWaitParams) -> WasmAsyncResponse {
    let _ = execute_sleep(SleepParams {
        duration: params.ms,
    })
    .await;
    WasmAsyncResponse {
        ok: true,
        value: Some(serde_json::Value::Bool(true)),
        error: None,
    }
}

fn get_local_storage() -> Result<web_sys::Storage, String> {
    web_sys::window()
        .ok_or("No window available")?
        .local_storage()
        .map_err(|e| format!("{:?}", e))?
        .ok_or("localStorage not available".into())
}

pub async fn execute_storage_get(params: StorageGetParams) -> WasmAsyncResponse {
    match get_local_storage() {
        Ok(storage) => match storage.get_item(&params.key) {
            Ok(Some(val)) => WasmAsyncResponse {
                ok: true,
                value: Some(serde_json::Value::String(val)),
                error: None,
            },
            Ok(None) => WasmAsyncResponse {
                ok: true,
                value: Some(serde_json::Value::Null),
                error: None,
            },
            Err(e) => WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("{:?}", e),
                    code: "E_STORAGE".into(),
                }),
            },
        },
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(WasmAsyncError {
                message: e,
                code: "E_STORAGE".into(),
            }),
        },
    }
}

pub async fn execute_storage_set(params: StorageSetParams) -> WasmAsyncResponse {
    match get_local_storage() {
        Ok(storage) => match storage.set_item(&params.key, &params.value) {
            Ok(_) => WasmAsyncResponse {
                ok: true,
                value: Some(serde_json::Value::Null),
                error: None,
            },
            Err(e) => WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("{:?}", e),
                    code: "E_STORAGE".into(),
                }),
            },
        },
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(WasmAsyncError {
                message: e,
                code: "E_STORAGE".into(),
            }),
        },
    }
}

pub async fn execute_storage_delete(params: StorageDeleteParams) -> WasmAsyncResponse {
    match get_local_storage() {
        Ok(storage) => match storage.remove_item(&params.key) {
            Ok(_) => WasmAsyncResponse {
                ok: true,
                value: Some(serde_json::Value::Null),
                error: None,
            },
            Err(e) => WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("{:?}", e),
                    code: "E_STORAGE".into(),
                }),
            },
        },
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(WasmAsyncError {
                message: e,
                code: "E_STORAGE".into(),
            }),
        },
    }
}

pub async fn execute_host_call(_action: &str, params: serde_json::Value) -> WasmAsyncResponse {
    // The actual handler name is in params.action (e.g. "greet"),
    // not in the action argument (which is always "call" for host_call).
    let handler_name = match params.get("action").and_then(|v| v.as_str()) {
        Some(name) => name,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: "host.call requires an action name".into(),
                    code: "E_HOST_NO_ACTION".into(),
                }),
            };
        }
    };
    let handler_params = params
        .get("params")
        .cloned()
        .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));

    let window = match web_sys::window() {
        Some(w) => w,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: "No window available".into(),
                    code: "E_HOST".into(),
                }),
            }
        }
    };

    let handlers_val = match js_sys::Reflect::get(&window, &"__hostHandlers".into()) {
        Ok(h) if !h.is_undefined() && !h.is_null() => h,
        _ => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("No handler registered for '{}'", handler_name),
                    code: "E_HOST_NO_HANDLER".into(),
                }),
            }
        }
    };
    let handlers: js_sys::Object = match handlers_val.dyn_into() {
        Ok(o) => o,
        Err(_) => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("No handler registered for '{}'", handler_name),
                    code: "E_HOST_NO_HANDLER".into(),
                }),
            }
        }
    };

    // Whitelist check: only allow own enumerable properties of __hostHandlers.
    let keys = js_sys::Object::keys(&handlers);
    let is_whitelisted =
        (0..keys.length()).any(|i| keys.get(i).as_string().as_deref() == Some(handler_name));
    if !is_whitelisted {
        return WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(WasmAsyncError {
                message: format!("Action '{}' is not whitelisted", handler_name),
                code: "E_NOT_WHITELISTED".into(),
            }),
        };
    }

    let handler = match js_sys::Reflect::get(&handlers, &handler_name.into()) {
        Ok(h) if h.is_function() => h.dyn_into::<js_sys::Function>().unwrap(),
        _ => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("No handler registered for '{}'", handler_name),
                    code: "E_HOST_NO_HANDLER".into(),
                }),
            }
        }
    };

    // Serialize params to a JSON string, then parse to a JS object.
    // This avoids serde_wasm_bindgen's default map-to-JS-Map behavior.
    let params_json = match serde_json::to_string(&handler_params) {
        Ok(s) => s,
        Err(e) => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("Failed to serialize params: {}", e),
                    code: "E_HOST".into(),
                }),
            }
        }
    };
    let params_js = match js_sys::JSON::parse(&params_json) {
        Ok(v) => v,
        Err(e) => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("Failed to parse params JSON: {:?}", e),
                    code: "E_HOST".into(),
                }),
            }
        }
    };

    let result = match handler.call1(&handlers, &params_js) {
        Ok(r) => r,
        Err(e) => {
            let msg = js_sys::Reflect::get(&e, &"message".into())
                .ok()
                .and_then(|v| v.as_string())
                .unwrap_or_else(|| "unknown handler error".to_string());
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: msg,
                    code: "E_HOST".into(),
                }),
            };
        }
    };

    // If result is a Promise, await it
    let resolved = if result.is_instance_of::<js_sys::Promise>() {
        match JsFuture::from(result.dyn_into::<js_sys::Promise>().unwrap()).await {
            Ok(v) => v,
            Err(e) => {
                let msg = js_sys::Reflect::get(&e, &"message".into())
                    .ok()
                    .and_then(|v| v.as_string())
                    .unwrap_or_else(|| "unknown promise rejection".to_string());
                return WasmAsyncResponse {
                    ok: false,
                    value: None,
                    error: Some(WasmAsyncError {
                        message: msg,
                        code: "E_HOST".into(),
                    }),
                };
            }
        }
    } else {
        result
    };

    let value = match serde_wasm_bindgen::from_value::<serde_json::Value>(resolved.clone()) {
        Ok(v) => v,
        Err(_) => {
            // If it can't be deserialized to JSON, treat as string
            let s = resolved
                .as_string()
                .unwrap_or_else(|| format!("{:?}", resolved));
            serde_json::Value::String(s)
        }
    };

    WasmAsyncResponse {
        ok: true,
        value: Some(value),
        error: None,
    }
}

// ─── DOM Snapshot ───────────────────────────────────────────────

pub fn execute_dom_snapshot(params: DomSnapshotParams) -> WasmAsyncResponse {
    let opts = dom_semantic_tree::model::CollectOptions {
        interactive_only: params.interactive_only,
        max_nodes: params.max_nodes as usize,
        ..Default::default()
    };

    let snapshot = dom_semantic_tree::collect::collect_document(opts);

    let text = dom_semantic_tree::format::format_snapshot(
        &snapshot,
        dom_semantic_tree::format::SnapshotFormat::CompactText,
    );

    let data = match serde_json::to_value(&snapshot) {
        Ok(v) => v,
        Err(_) => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: "Failed to serialize snapshot data".into(),
                    code: "E_SNAPSHOT".into(),
                }),
            }
        }
    };

    let result = serde_json::json!({
        "data": data,
        "text": text,
    });

    WasmAsyncResponse {
        ok: true,
        value: Some(result),
        error: None,
    }
}

pub fn execute_dom_format(params: DomFormatParams) -> WasmAsyncResponse {
    let snapshot = &params.snapshot;
    let snap: dom_semantic_tree::model::TreeSnapshot =
        match serde_json::from_value(snapshot.clone()) {
            Ok(s) => s,
            Err(_) => {
                return WasmAsyncResponse {
                    ok: false,
                    value: None,
                    error: Some(WasmAsyncError {
                        message: "Failed to parse snapshot for formatting".into(),
                        code: "E_FORMAT".into(),
                    }),
                }
            }
        };
    let text = dom_semantic_tree::format::format_snapshot(&snap, params.format);
    WasmAsyncResponse {
        ok: true,
        value: Some(serde_json::Value::String(text)),
        error: None,
    }
}

// ─── Page Agent Actions ─────────────────────────────────────────

fn get_element_by_ref_id(ref_id: &str) -> Result<web_sys::Element, String> {
    let document = web_sys::window()
        .ok_or("No window available")?
        .document()
        .ok_or("No document available")?;
    document
        .query_selector(&format!("[data-ref-id='{}']", ref_id))
        .map_err(|e| format!("{:?}", e))?
        .ok_or_else(|| format!("Element with ref_id '{}' not found", ref_id))
}

pub async fn execute_page_url(_params: EmptyParams) -> WasmAsyncResponse {
    let window = match web_sys::window() {
        Some(w) => w,
        None => return no_window_response(),
    };
    match window.location().href() {
        Ok(href) => WasmAsyncResponse {
            ok: true,
            value: Some(serde_json::Value::String(href)),
            error: None,
        },
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(WasmAsyncError {
                message: format!("{:?}", e),
                code: "E_AGENT".into(),
            }),
        },
    }
}

pub async fn execute_page_title(_params: EmptyParams) -> WasmAsyncResponse {
    let document = match web_sys::window().and_then(|w| w.document()) {
        Some(d) => d,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: "No document available".into(),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    WasmAsyncResponse {
        ok: true,
        value: Some(serde_json::Value::String(document.title())),
        error: None,
    }
}

pub async fn execute_page_goto(params: PageGotoParams) -> WasmAsyncResponse {
    let window = match web_sys::window() {
        Some(w) => w,
        None => return no_window_response(),
    };
    match window.location().set_href(&params.url) {
        Ok(_) => WasmAsyncResponse {
            ok: true,
            value: Some(serde_json::Value::Null),
            error: None,
        },
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(WasmAsyncError {
                message: format!("{:?}", e),
                code: "E_AGENT".into(),
            }),
        },
    }
}

pub async fn execute_page_back(_params: EmptyParams) -> WasmAsyncResponse {
    let window = match web_sys::window() {
        Some(w) => w,
        None => return no_window_response(),
    };
    match window.history().map_err(|e| format!("{:?}", e)) {
        Ok(h) => match h.back().map_err(|e| format!("{:?}", e)) {
            Ok(_) => WasmAsyncResponse {
                ok: true,
                value: Some(serde_json::Value::Null),
                error: None,
            },
            Err(msg) => WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: msg,
                    code: "E_AGENT".into(),
                }),
            },
        },
        Err(msg) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(WasmAsyncError {
                message: msg,
                code: "E_AGENT".into(),
            }),
        },
    }
}

pub async fn execute_page_forward(_params: EmptyParams) -> WasmAsyncResponse {
    let window = match web_sys::window() {
        Some(w) => w,
        None => return no_window_response(),
    };
    match window.history().map_err(|e| format!("{:?}", e)) {
        Ok(h) => match h.forward().map_err(|e| format!("{:?}", e)) {
            Ok(_) => WasmAsyncResponse {
                ok: true,
                value: Some(serde_json::Value::Null),
                error: None,
            },
            Err(msg) => WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: msg,
                    code: "E_AGENT".into(),
                }),
            },
        },
        Err(msg) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(WasmAsyncError {
                message: msg,
                code: "E_AGENT".into(),
            }),
        },
    }
}

pub async fn execute_page_reload(_params: EmptyParams) -> WasmAsyncResponse {
    let window = match web_sys::window() {
        Some(w) => w,
        None => return no_window_response(),
    };
    match window.location().reload() {
        Ok(_) => WasmAsyncResponse {
            ok: true,
            value: Some(serde_json::Value::Null),
            error: None,
        },
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(WasmAsyncError {
                message: format!("{:?}", e),
                code: "E_AGENT".into(),
            }),
        },
    }
}

pub async fn execute_page_click(params: PageClickParams) -> WasmAsyncResponse {
    let document = match web_sys::window().and_then(|w| w.document()) {
        Some(d) => d,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: "No document available".into(),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let ref_id = match resolve_ref_id_or_selector(&document, &params.ref_id, &params.selector).await {
        Ok(rid) => rid,
        Err(resp) => return resp,
    };
    let label = if params.label.is_empty() && !ref_id.is_empty() {
        ref_id.clone()
    } else {
        params.label.clone()
    };
    let element = match document.query_selector(&format!("[data-ref-id='{}']", ref_id)) {
        Ok(el) => el,
        Err(e) => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("{:?}", e),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let element = element.or_else(|| find_element_by_label(&document, &label));
    let element = match element {
        Some(el) => el,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("Element with ref_id '{}' not found", ref_id),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    match element.dyn_ref::<web_sys::HtmlElement>() {
        Some(el) => {
            el.click();
            WasmAsyncResponse {
                ok: true,
                value: Some(serde_json::Value::Null),
                error: None,
            }
        }
        None => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(WasmAsyncError {
                message: "Element is not clickable".into(),
                code: "E_AGENT".into(),
            }),
        },
    }
}

pub async fn execute_page_fill(params: PageFillParams) -> WasmAsyncResponse {
    let document = match web_sys::window().and_then(|w| w.document()) {
        Some(d) => d,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: "No document available".into(),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let ref_id = match resolve_ref_id_or_selector(&document, &params.ref_id, &params.selector).await {
        Ok(rid) => rid,
        Err(resp) => return resp,
    };
    let label = if params.label.is_empty() && !ref_id.is_empty() {
        ref_id.clone()
    } else {
        params.label.clone()
    };
    let element = match document.query_selector(&format!("[data-ref-id='{}']", ref_id)) {
        Ok(el) => el,
        Err(e) => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("{:?}", e),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let element = element.or_else(|| find_element_by_label(&document, &label));
    let element = match element {
        Some(el) => el,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("Element with ref_id '{}' not found", ref_id),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    if let Some(input) = element.dyn_ref::<web_sys::HtmlInputElement>() {
        input.set_value(&params.value);
    } else {
        return WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(WasmAsyncError {
                message: "Element is not an input".into(),
                code: "E_AGENT".into(),
            }),
        };
    }
    match web_sys::Event::new("input") {
        Ok(event) => {
            let _ = element.dispatch_event(&event);
            WasmAsyncResponse {
                ok: true,
                value: Some(serde_json::Value::Null),
                error: None,
            }
        }
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(WasmAsyncError {
                message: format!("{:?}", e),
                code: "E_AGENT".into(),
            }),
        },
    }
}

pub async fn execute_page_append(params: PageAppendParams) -> WasmAsyncResponse {
    let document = match web_sys::window().and_then(|w| w.document()) {
        Some(d) => d,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: "No document available".into(),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let ref_id = match resolve_ref_id_or_selector(&document, &params.ref_id, &params.selector).await {
        Ok(rid) => rid,
        Err(resp) => return resp,
    };
    let label = if params.label.is_empty() && !ref_id.is_empty() {
        ref_id.clone()
    } else {
        params.label.clone()
    };
    let element = match document.query_selector(&format!("[data-ref-id='{}']", ref_id)) {
        Ok(el) => el,
        Err(e) => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("{:?}", e),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let element = element.or_else(|| find_element_by_label(&document, &label));
    let element = match element {
        Some(el) => el,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("Element with ref_id '{}' not found", ref_id),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    if let Some(input) = element.dyn_ref::<web_sys::HtmlInputElement>() {
        let current = input.value();
        input.set_value(&format!("{}{}", current, params.text));
    } else {
        return WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(WasmAsyncError {
                message: "Element is not an input".into(),
                code: "E_AGENT".into(),
            }),
        };
    }
    match web_sys::Event::new("input") {
        Ok(event) => {
            let _ = element.dispatch_event(&event);
            WasmAsyncResponse {
                ok: true,
                value: Some(serde_json::Value::Null),
                error: None,
            }
        }
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(WasmAsyncError {
                message: format!("{:?}", e),
                code: "E_AGENT".into(),
            }),
        },
    }
}

pub async fn execute_page_hover(params: PageHoverParams) -> WasmAsyncResponse {
    let document = match web_sys::window().and_then(|w| w.document()) {
        Some(d) => d,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: "No document available".into(),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let ref_id = match resolve_ref_id_or_selector(&document, &params.ref_id, &params.selector).await {
        Ok(rid) => rid,
        Err(resp) => return resp,
    };
    let element = match document.query_selector(&format!("[data-ref-id='{}']", ref_id)) {
        Ok(el) => el,
        Err(e) => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("{:?}", e),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let element = match element {
        Some(el) => el,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("Element with ref_id '{}' not found", ref_id),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let event = match web_sys::MouseEvent::new_with_mouse_event_init_dict(
        "mouseenter",
        &web_sys::MouseEventInit::new(),
    ) {
        Ok(e) => e,
        Err(e) => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("{:?}", e),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let _ = element.dispatch_event(&event);
    WasmAsyncResponse {
        ok: true,
        value: Some(serde_json::Value::Bool(true)),
        error: None,
    }
}

pub async fn execute_page_unhover(_params: EmptyParams) -> WasmAsyncResponse {
    let document = match web_sys::window().and_then(|w| w.document()) {
        Some(d) => d,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: "No document available".into(),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    // Dispatch mouseleave on body to clear any hover
    if let Some(body) = document.body() {
        if let Ok(event) = web_sys::MouseEvent::new_with_mouse_event_init_dict(
            "mouseleave",
            &web_sys::MouseEventInit::new(),
        ) {
            let _ = body.dispatch_event(&event);
        }
    }
    WasmAsyncResponse {
        ok: true,
        value: Some(serde_json::Value::Bool(true)),
        error: None,
    }
}

pub async fn execute_page_scroll(params: PageScrollParams) -> WasmAsyncResponse {
    let window = match web_sys::window() {
        Some(w) => w,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: "No window available".into(),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let (dx, dy) = match params.direction.as_str() {
        "down" => (0.0, params.amount),
        "up" => (0.0, -params.amount),
        "left" => (-params.amount, 0.0),
        "right" => (params.amount, 0.0),
        _ => (0.0, params.amount),
    };
    window.scroll_by_with_x_and_y(dx, dy);
    WasmAsyncResponse {
        ok: true,
        value: Some(serde_json::Value::Bool(true)),
        error: None,
    }
}

pub async fn execute_page_scroll_to(params: PageScrollToParams) -> WasmAsyncResponse {
    let document = match web_sys::window().and_then(|w| w.document()) {
        Some(d) => d,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: "No document available".into(),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let ref_id = match resolve_ref_id_or_selector(&document, &params.ref_id, &params.selector).await {
        Ok(rid) => rid,
        Err(resp) => return resp,
    };
    let element = match document.query_selector(&format!("[data-ref-id='{}']", ref_id)) {
        Ok(el) => el,
        Err(e) => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("{:?}", e),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let element = match element {
        Some(el) => el,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("Element with ref_id '{}' not found", ref_id),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    element.scroll_into_view();
    WasmAsyncResponse {
        ok: true,
        value: Some(serde_json::Value::Bool(true)),
        error: None,
    }
}

pub async fn execute_page_dblclick(params: PageDblClickParams) -> WasmAsyncResponse {
    let document = match web_sys::window().and_then(|w| w.document()) {
        Some(d) => d,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: "No document available".into(),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let ref_id = match resolve_ref_id_or_selector(&document, &params.ref_id, &params.selector).await {
        Ok(rid) => rid,
        Err(resp) => return resp,
    };
    let element = match document.query_selector(&format!("[data-ref-id='{}']", ref_id)) {
        Ok(el) => el,
        Err(e) => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("{:?}", e),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let element = match element {
        Some(el) => el,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("Element with ref_id '{}' not found", ref_id),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let event = match web_sys::MouseEvent::new_with_mouse_event_init_dict(
        "dblclick",
        &web_sys::MouseEventInit::new(),
    ) {
        Ok(e) => e,
        Err(e) => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("{:?}", e),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let _ = element.dispatch_event(&event);
    WasmAsyncResponse {
        ok: true,
        value: Some(serde_json::Value::Bool(true)),
        error: None,
    }
}

pub async fn execute_page_type(params: PageTypeParams) -> WasmAsyncResponse {
    let document = match web_sys::window().and_then(|w| w.document()) {
        Some(d) => d,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: "No document available".into(),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let ref_id = match resolve_ref_id_or_selector(&document, &params.ref_id, &params.selector).await {
        Ok(rid) => rid,
        Err(resp) => return resp,
    };
    let element = match document.query_selector(&format!("[data-ref-id='{}']", ref_id)) {
        Ok(el) => el,
        Err(e) => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("{:?}", e),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let element = match element {
        Some(el) => el,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("Element with ref_id '{}' not found", ref_id),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    if let Some(input) = element.dyn_ref::<web_sys::HtmlInputElement>() {
        let new_val = format!("{}{}", input.value(), params.text);
        input.set_value(&new_val);
    } else if let Some(textarea) = element.dyn_ref::<web_sys::HtmlTextAreaElement>() {
        let new_val = format!("{}{}", textarea.value(), params.text);
        textarea.set_value(&new_val);
    } else {
        return WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(WasmAsyncError {
                message: "Element is not a text input".into(),
                code: "E_AGENT".into(),
            }),
        };
    }
    WasmAsyncResponse {
        ok: true,
        value: Some(serde_json::Value::Bool(true)),
        error: None,
    }
}

pub async fn execute_page_press(params: PagePressParams) -> WasmAsyncResponse {
    let document = match web_sys::window().and_then(|w| w.document()) {
        Some(d) => d,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: "No document available".into(),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let init = web_sys::KeyboardEventInit::new();
    init.set_key(&params.key);
    let event = match web_sys::KeyboardEvent::new_with_keyboard_event_init_dict("keydown", &init) {
        Ok(e) => e,
        Err(e) => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("{:?}", e),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let _ = document.dispatch_event(&event);
    WasmAsyncResponse {
        ok: true,
        value: Some(serde_json::Value::Bool(true)),
        error: None,
    }
}

pub async fn execute_page_select(params: PageSelectParams) -> WasmAsyncResponse {
    let document = match web_sys::window().and_then(|w| w.document()) {
        Some(d) => d,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: "No document available".into(),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let ref_id = match resolve_ref_id_or_selector(&document, &params.ref_id, &params.selector).await {
        Ok(rid) => rid,
        Err(resp) => return resp,
    };
    let element = match document.query_selector(&format!("[data-ref-id='{}']", ref_id)) {
        Ok(el) => el,
        Err(e) => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("{:?}", e),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let element = match element {
        Some(el) => el,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("Element with ref_id '{}' not found", ref_id),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    if let Some(select) = element.dyn_ref::<web_sys::HtmlSelectElement>() {
        select.set_value(&params.value);
    } else {
        return WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(WasmAsyncError {
                message: "Element is not a select".into(),
                code: "E_AGENT".into(),
            }),
        };
    }
    WasmAsyncResponse {
        ok: true,
        value: Some(serde_json::Value::Bool(true)),
        error: None,
    }
}

pub async fn execute_page_check(params: PageCheckParams) -> WasmAsyncResponse {
    let document = match web_sys::window().and_then(|w| w.document()) {
        Some(d) => d,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: "No document available".into(),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let ref_id = match resolve_ref_id_or_selector(&document, &params.ref_id, &params.selector).await {
        Ok(rid) => rid,
        Err(resp) => return resp,
    };
    let element = match document.query_selector(&format!("[data-ref-id='{}']", ref_id)) {
        Ok(el) => el,
        Err(e) => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("{:?}", e),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let element = match element {
        Some(el) => el,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("Element with ref_id '{}' not found", ref_id),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    if let Some(input) = element.dyn_ref::<web_sys::HtmlInputElement>() {
        input.set_checked(params.checked);
    } else {
        return WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(WasmAsyncError {
                message: "Element is not a checkbox".into(),
                code: "E_AGENT".into(),
            }),
        };
    }
    WasmAsyncResponse {
        ok: true,
        value: Some(serde_json::Value::Bool(true)),
        error: None,
    }
}

pub async fn execute_storage_list(_params: EmptyParams) -> WasmAsyncResponse {
    match get_local_storage() {
        Ok(storage) => {
            let len = storage.length().unwrap_or(0);
            let mut keys = Vec::new();
            for i in 0..len {
                if let Ok(Some(k)) = storage.key(i) {
                    keys.push(serde_json::Value::String(k));
                }
            }
            WasmAsyncResponse {
                ok: true,
                value: Some(serde_json::Value::Array(keys)),
                error: None,
            }
        }
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(WasmAsyncError {
                message: e,
                code: "E_STORAGE".into(),
            }),
        },
    }
}

// ─── fs.* helpers ───────────────────────────────────────────────

fn fs_err_to_wasm(err: web_fs::FsError) -> WasmAsyncError {
    WasmAsyncError {
        message: err.wire_message(),
        code: err.wire_code().into(),
    }
}

pub async fn execute_fs_exists(
    params: web_js_core::command_params::FsPathParams,
) -> WasmAsyncResponse {
    let exists = web_fs::exists(&params.path).await;
    WasmAsyncResponse {
        ok: true,
        value: Some(serde_json::Value::Bool(exists)),
        error: None,
    }
}

pub async fn execute_fs_stat(
    params: web_js_core::command_params::FsPathParams,
) -> WasmAsyncResponse {
    match web_fs::stat(&params.path).await {
        Ok(meta) => match serde_json::to_value(&meta) {
            Ok(v) => WasmAsyncResponse {
                ok: true,
                value: Some(v),
                error: None,
            },
            Err(e) => WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("Failed to serialize metadata: {}", e),
                    code: "E_IO".into(),
                }),
            },
        },
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_wasm(e)),
        },
    }
}

pub async fn execute_fs_list(
    params: web_js_core::command_params::FsPathParams,
) -> WasmAsyncResponse {
    match web_fs::list(&params.path).await {
        Ok(entries) => match serde_json::to_value(&entries) {
            Ok(v) => WasmAsyncResponse {
                ok: true,
                value: Some(v),
                error: None,
            },
            Err(e) => WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("Failed to serialize entries: {}", e),
                    code: "E_IO".into(),
                }),
            },
        },
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_wasm(e)),
        },
    }
}

pub async fn execute_fs_mkdir(
    params: web_js_core::command_params::FsPathParams,
) -> WasmAsyncResponse {
    match web_fs::mkdir(&params.path).await {
        Ok(_) => WasmAsyncResponse {
            ok: true,
            value: Some(serde_json::Value::Bool(true)),
            error: None,
        },
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_wasm(e)),
        },
    }
}

pub async fn execute_fs_delete(
    params: web_js_core::command_params::FsPathParams,
) -> WasmAsyncResponse {
    match web_fs::delete(&params.path).await {
        Ok(_) => WasmAsyncResponse {
            ok: true,
            value: Some(serde_json::Value::Bool(true)),
            error: None,
        },
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_wasm(e)),
        },
    }
}

pub async fn execute_fs_copy(
    params: web_js_core::command_params::FsCopyParams,
) -> WasmAsyncResponse {
    match web_fs::copy(&params.from, &params.to).await {
        Ok(_) => WasmAsyncResponse {
            ok: true,
            value: Some(serde_json::Value::Bool(true)),
            error: None,
        },
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_wasm(e)),
        },
    }
}

pub async fn execute_fs_move(
    params: web_js_core::command_params::FsCopyParams,
) -> WasmAsyncResponse {
    match web_fs::rename(&params.from, &params.to).await {
        Ok(_) => WasmAsyncResponse {
            ok: true,
            value: Some(serde_json::Value::Bool(true)),
            error: None,
        },
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_wasm(e)),
        },
    }
}

pub async fn execute_fs_read(
    params: web_js_core::command_params::FsPathParams,
) -> WasmAsyncResponse {
    match web_fs::read(&params.path).await {
        Ok(bytes) => WasmAsyncResponse {
            ok: true,
            value: Some(serde_json::Value::String(
                data_encoding::BASE64.encode(&bytes),
            )),
            error: None,
        },
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_wasm(e)),
        },
    }
}

pub async fn execute_fs_read_text(
    params: web_js_core::command_params::FsPathParams,
) -> WasmAsyncResponse {
    match web_fs::read_text(&params.path).await {
        Ok(text) => WasmAsyncResponse {
            ok: true,
            value: Some(serde_json::Value::String(text)),
            error: None,
        },
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_wasm(e)),
        },
    }
}

pub async fn execute_fs_read_base64(
    params: web_js_core::command_params::FsPathParams,
) -> WasmAsyncResponse {
    match web_fs::read_base64(&params.path).await {
        Ok(b64) => WasmAsyncResponse {
            ok: true,
            value: Some(serde_json::Value::String(b64)),
            error: None,
        },
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_wasm(e)),
        },
    }
}

pub async fn execute_fs_read_range(
    params: web_js_core::command_params::FsReadRangeParams,
) -> WasmAsyncResponse {
    match web_fs::read_range(&params.path, params.offset, params.len).await {
        Ok(bytes) => WasmAsyncResponse {
            ok: true,
            value: Some(serde_json::Value::String(
                data_encoding::BASE64.encode(&bytes),
            )),
            error: None,
        },
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_wasm(e)),
        },
    }
}

pub async fn execute_fs_write(
    params: web_js_core::command_params::FsWriteParams,
) -> WasmAsyncResponse {
    let bytes = match data_encoding::BASE64.decode(params.data.as_bytes()) {
        Ok(b) => b,
        Err(_) => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: "Invalid base64 data".into(),
                    code: "E_INVALID_ENCODING".into(),
                }),
            };
        }
    };
    match web_fs::write(&params.path, &bytes).await {
        Ok(_) => WasmAsyncResponse {
            ok: true,
            value: Some(serde_json::Value::Bool(true)),
            error: None,
        },
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_wasm(e)),
        },
    }
}

pub async fn execute_fs_write_text(
    params: web_js_core::command_params::FsWriteParams,
) -> WasmAsyncResponse {
    match web_fs::write_text(&params.path, &params.data).await {
        Ok(_) => WasmAsyncResponse {
            ok: true,
            value: Some(serde_json::Value::Bool(true)),
            error: None,
        },
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_wasm(e)),
        },
    }
}

pub async fn execute_fs_write_base64(
    params: web_js_core::command_params::FsWriteParams,
) -> WasmAsyncResponse {
    match web_fs::write_base64(&params.path, &params.data).await {
        Ok(_) => WasmAsyncResponse {
            ok: true,
            value: Some(serde_json::Value::Bool(true)),
            error: None,
        },
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_wasm(e)),
        },
    }
}

pub async fn execute_fs_append(
    params: web_js_core::command_params::FsWriteParams,
) -> WasmAsyncResponse {
    let bytes = match data_encoding::BASE64.decode(params.data.as_bytes()) {
        Ok(b) => b,
        Err(_) => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: "Invalid base64 data".into(),
                    code: "E_INVALID_ENCODING".into(),
                }),
            };
        }
    };
    match web_fs::append(&params.path, &bytes).await {
        Ok(_) => WasmAsyncResponse {
            ok: true,
            value: Some(serde_json::Value::Bool(true)),
            error: None,
        },
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_wasm(e)),
        },
    }
}

pub async fn execute_fs_append_text(
    params: web_js_core::command_params::FsWriteParams,
) -> WasmAsyncResponse {
    match web_fs::append_text(&params.path, &params.data).await {
        Ok(_) => WasmAsyncResponse {
            ok: true,
            value: Some(serde_json::Value::Bool(true)),
            error: None,
        },
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_wasm(e)),
        },
    }
}

pub async fn execute_fs_append_base64(
    params: web_js_core::command_params::FsWriteParams,
) -> WasmAsyncResponse {
    match web_fs::append_base64(&params.path, &params.data).await {
        Ok(_) => WasmAsyncResponse {
            ok: true,
            value: Some(serde_json::Value::Bool(true)),
            error: None,
        },
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_wasm(e)),
        },
    }
}

pub async fn execute_fs_update(
    params: web_js_core::command_params::FsUpdateParams,
) -> WasmAsyncResponse {
    let bytes = match data_encoding::BASE64.decode(params.data.as_bytes()) {
        Ok(b) => b,
        Err(_) => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: "Invalid base64 data".into(),
                    code: "E_INVALID_ENCODING".into(),
                }),
            };
        }
    };
    match web_fs::update(&params.path, params.offset, &bytes).await {
        Ok(_) => WasmAsyncResponse {
            ok: true,
            value: Some(serde_json::Value::Bool(true)),
            error: None,
        },
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_wasm(e)),
        },
    }
}

pub async fn execute_fs_hash(
    params: web_js_core::command_params::FsHashParams,
) -> WasmAsyncResponse {
    match web_fs::hash(&params.path, &params.algo).await {
        Ok(hex) => WasmAsyncResponse {
            ok: true,
            value: Some(serde_json::Value::String(hex)),
            error: None,
        },
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_wasm(e)),
        },
    }
}

// ─── Inline handler wrappers (moved from session.rs) ────────────

pub async fn execute_mock_async(_params: EmptyParams) -> WasmAsyncResponse {
    WasmAsyncResponse {
        ok: true,
        value: Some(serde_json::Value::Null),
        error: None,
    }
}

pub async fn execute_page_find(params: PageFindParams) -> WasmAsyncResponse {
    let document = match web_sys::window().and_then(|w| w.document()) {
        Some(d) => d,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: "No document available".into(),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let elements = match document.query_selector_all(&params.selector) {
        Ok(nl) => nl,
        Err(e) => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("{:?}", e),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let mut results = Vec::new();
    for i in 0..elements.length() {
        if let Some(el) = elements.item(i) {
            if let Some(el) = el.dyn_ref::<web_sys::Element>() {
                let tag = el.tag_name();
                let ref_id = el.get_attribute("data-ref-id").unwrap_or_else(|| {
                    let id = format!("webjs-find-{}", i);
                    let _ = el.set_attribute("data-ref-id", &id);
                    id
                });
                let text = el
                    .text_content()
                    .unwrap_or_default()
                    .chars()
                    .take(100)
                    .collect::<String>();
                results.push(serde_json::json!({
                    "tag": tag,
                    "refId": ref_id,
                    "text": text,
                }));
            }
        }
    }
    WasmAsyncResponse {
        ok: true,
        value: Some(serde_json::Value::Array(results)),
        error: None,
    }
}

pub async fn execute_page_wait_for(params: PageWaitForParams) -> WasmAsyncResponse {
    let window = match web_sys::window() {
        Some(w) => w,
        None => return no_window_response(),
    };
    let document = match window.document() {
        Some(d) => d,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: "No document available".into(),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let start = js_sys::Date::now();
    let timeout = params.timeout as f64;
    let interval_ms = 100.0;

    loop {
        if let Ok(Some(_)) = document.query_selector(&params.selector) {
            return WasmAsyncResponse {
                ok: true,
                value: Some(serde_json::Value::Bool(true)),
                error: None,
            };
        }
        let elapsed = js_sys::Date::now() - start;
        if elapsed >= timeout {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: format!("Timeout waiting for selector: {}", params.selector),
                    code: "E_TIMEOUT".into(),
                }),
            };
        }
        let promise = js_sys::Promise::new(
            &mut |resolve: js_sys::Function, _reject: js_sys::Function| {
                let set_timeout = js_sys::Reflect::get(&window, &"setTimeout".into())
                    .unwrap()
                    .dyn_into::<js_sys::Function>()
                    .unwrap();
                let _ = set_timeout.call2(
                    &window,
                    &resolve,
                    &JsValue::from_f64(interval_ms),
                );
            },
        );
        let _ = JsFuture::from(promise).await;
    }
}

pub async fn execute_page_extract(params: PageExtractParams) -> WasmAsyncResponse {
    let document = match web_sys::window().and_then(|w| w.document()) {
        Some(d) => d,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: "No document available".into(),
                    code: "E_AGENT".into(),
                }),
            }
        }
    };
    let mut result = serde_json::Map::new();
    for field in &params.fields {
        match field.as_str() {
            "title" => {
                result.insert(
                    "title".to_string(),
                    serde_json::Value::String(document.title()),
                );
            }
            "url" => {
                let href = match web_sys::window().and_then(|w| w.location().href().ok()) {
                    Some(h) => h,
                    None => {
                        return WasmAsyncResponse {
                            ok: false,
                            value: None,
                            error: Some(WasmAsyncError {
                                message: "No window available".into(),
                                code: "E_AGENT".into(),
                            }),
                        }
                    }
                };
                result.insert("url".to_string(), serde_json::Value::String(href));
            }
            "headings" => {
                let headings = match document.query_selector_all("h1, h2, h3, h4, h5, h6") {
                    Ok(nl) => nl,
                    Err(e) => {
                        return WasmAsyncResponse {
                            ok: false,
                            value: None,
                            error: Some(WasmAsyncError {
                                message: format!("{:?}", e),
                                code: "E_AGENT".into(),
                            }),
                        }
                    }
                };
                let mut list = Vec::new();
                for i in 0..headings.length() {
                    if let Some(el) = headings.item(i) {
                        if let Some(el) = el.dyn_ref::<web_sys::Element>() {
                            list.push(serde_json::json!({
                                "tag": el.tag_name(),
                                "text": el.text_content().unwrap_or_default().trim().to_string(),
                            }));
                        }
                    }
                }
                result.insert("headings".to_string(), serde_json::Value::Array(list));
            }
            "links" => {
                let links = match document.query_selector_all("a[href]") {
                    Ok(nl) => nl,
                    Err(e) => {
                        return WasmAsyncResponse {
                            ok: false,
                            value: None,
                            error: Some(WasmAsyncError {
                                message: format!("{:?}", e),
                                code: "E_AGENT".into(),
                            }),
                        }
                    }
                };
                let mut list = Vec::new();
                for i in 0..links.length() {
                    if let Some(el) = links.item(i) {
                        if let Some(el) = el.dyn_ref::<web_sys::Element>() {
                            list.push(serde_json::json!({
                                "href": el.get_attribute("href").unwrap_or_default(),
                                "text": el.text_content().unwrap_or_default().trim().to_string(),
                            }));
                        }
                    }
                }
                result.insert("links".to_string(), serde_json::Value::Array(list));
            }
            "text" => {
                let body_text = document
                    .body()
                    .and_then(|b| b.text_content())
                    .unwrap_or_default()
                    .trim()
                    .chars()
                    .take(500)
                    .collect::<String>();
                result.insert("text".to_string(), serde_json::Value::String(body_text));
            }
            _ => {}
        }
    }
    WasmAsyncResponse {
        ok: true,
        value: Some(serde_json::Value::Object(result)),
        error: None,
    }
}

pub async fn execute_page_screenshot(_params: EmptyParams) -> WasmAsyncResponse {
    WasmAsyncResponse {
        ok: false,
        value: None,
        error: Some(WasmAsyncError {
            message: "screenshot not yet implemented in web-js".into(),
            code: "E_NOT_IMPLEMENTED".into(),
        }),
    }
}

pub async fn execute_page_snapshot_text(params: DomSnapshotParams) -> WasmAsyncResponse {
    let resp = execute_dom_snapshot(params);
    if let Some(ref value) = resp.value {
        if let Some(text) = value.get("text").and_then(|t| t.as_str()) {
            return WasmAsyncResponse {
                ok: true,
                value: Some(serde_json::Value::String(text.to_string())),
                error: None,
            };
        }
    }
    resp
}

pub async fn execute_page_snapshot_data(params: DomSnapshotParams) -> WasmAsyncResponse {
    let mut resp = execute_dom_snapshot(params);
    if let Some(ref mut value) = resp.value {
        if let Some(serde_json::Value::Object(ref mut map)) = value.get_mut("data") {
            if let Some(nodes) = map.get("nodes").cloned() {
                map.insert("elements".to_string(), nodes);
            }
        }
    }
    resp
}

pub async fn execute_sidepanel_snapshot_text(params: DomSnapshotParams) -> WasmAsyncResponse {
    execute_page_snapshot_text(params).await
}

pub async fn execute_sidepanel_snapshot_data(params: DomSnapshotParams) -> WasmAsyncResponse {
    execute_page_snapshot_data(params).await
}

pub async fn execute_sidepanel_click(params: PageClickParams) -> WasmAsyncResponse {
    execute_page_click(params).await
}

pub async fn execute_sidepanel_fill(params: PageFillParams) -> WasmAsyncResponse {
    execute_page_fill(params).await
}

pub async fn execute_sidepanel_append(params: PageAppendParams) -> WasmAsyncResponse {
    execute_page_append(params).await
}

pub async fn execute_sidepanel_url(_params: EmptyParams) -> WasmAsyncResponse {
    execute_page_url(EmptyParams {}).await
}

pub async fn execute_sidepanel_title(_params: EmptyParams) -> WasmAsyncResponse {
    execute_page_title(EmptyParams {}).await
}

pub async fn execute_host_call_from_registry(params: HostCallParams) -> WasmAsyncResponse {
    let params_json = serde_json::to_value(params).unwrap_or(serde_json::Value::Null);
    execute_host_call("call", params_json).await
}

// ─── Core wrapper macros ────────────────────────────────────────

macro_rules! core_wrap_async {
    ($name:ident, $params:ty, $fn:path) => {
        async fn $name(params: $params) -> web_js_core::AsyncResponse {
            wasm_to_core($fn(params).await)
        }
    };
}

macro_rules! core_wrap_async_empty {
    ($name:ident, $fn:path) => {
        async fn $name(_params: EmptyParams) -> web_js_core::AsyncResponse {
            wasm_to_core($fn(EmptyParams {}).await)
        }
    };
}

macro_rules! core_wrap_sync {
    ($name:ident, $params:ty, $fn:path) => {
        async fn $name(params: $params) -> web_js_core::AsyncResponse {
            wasm_to_core($fn(params))
        }
    };
}

// Generate core wrappers for all handlers

core_wrap_async!(core_execute_fetch, FetchParams, execute_fetch);
core_wrap_async!(core_execute_fetch_positional, FetchArgs, execute_fetch_positional);
core_wrap_async!(core_execute_sleep, SleepParams, execute_sleep);
core_wrap_async!(core_execute_page_wait, PageWaitParams, execute_page_wait);
core_wrap_async!(core_execute_storage_get, StorageGetParams, execute_storage_get);
core_wrap_async!(core_execute_storage_set, StorageSetParams, execute_storage_set);
core_wrap_async!(core_execute_storage_delete, StorageDeleteParams, execute_storage_delete);
core_wrap_async!(core_execute_host_call, HostCallParams, execute_host_call_from_registry);
core_wrap_async!(core_execute_page_hover, PageHoverParams, execute_page_hover);
core_wrap_async_empty!(core_execute_page_unhover, execute_page_unhover);
core_wrap_async!(core_execute_page_scroll, PageScrollParams, execute_page_scroll);
core_wrap_async!(core_execute_page_scroll_to, PageScrollToParams, execute_page_scroll_to);
core_wrap_async!(core_execute_page_dblclick, PageDblClickParams, execute_page_dblclick);
core_wrap_async!(core_execute_page_type, PageTypeParams, execute_page_type);
core_wrap_async!(core_execute_page_press, PagePressParams, execute_page_press);
core_wrap_async!(core_execute_page_select, PageSelectParams, execute_page_select);
core_wrap_async!(core_execute_page_check, PageCheckParams, execute_page_check);
core_wrap_async!(core_execute_fs_exists, FsPathParams, execute_fs_exists);
core_wrap_async!(core_execute_fs_stat, FsPathParams, execute_fs_stat);
core_wrap_async!(core_execute_fs_list, FsPathParams, execute_fs_list);
core_wrap_async!(core_execute_fs_mkdir, FsPathParams, execute_fs_mkdir);
core_wrap_async!(core_execute_fs_delete, FsPathParams, execute_fs_delete);
core_wrap_async!(core_execute_fs_copy, FsCopyParams, execute_fs_copy);
core_wrap_async!(core_execute_fs_move, FsCopyParams, execute_fs_move);
core_wrap_async!(core_execute_fs_read, FsPathParams, execute_fs_read);
core_wrap_async!(core_execute_fs_read_text, FsPathParams, execute_fs_read_text);
core_wrap_async!(core_execute_fs_read_base64, FsPathParams, execute_fs_read_base64);
core_wrap_async!(core_execute_fs_read_range, FsReadRangeParams, execute_fs_read_range);
core_wrap_async!(core_execute_fs_write, FsWriteParams, execute_fs_write);
core_wrap_async!(core_execute_fs_write_text, FsWriteParams, execute_fs_write_text);
core_wrap_async!(core_execute_fs_write_base64, FsWriteParams, execute_fs_write_base64);
core_wrap_async!(core_execute_fs_append, FsWriteParams, execute_fs_append);
core_wrap_async!(core_execute_fs_append_text, FsWriteParams, execute_fs_append_text);
core_wrap_async!(core_execute_fs_append_base64, FsWriteParams, execute_fs_append_base64);
core_wrap_async!(core_execute_fs_update, FsUpdateParams, execute_fs_update);
core_wrap_async!(core_execute_fs_hash, FsHashParams, execute_fs_hash);

core_wrap_async!(core_execute_mock_async, EmptyParams, execute_mock_async);
core_wrap_async!(core_execute_page_url, EmptyParams, execute_page_url);
core_wrap_async!(core_execute_page_title, EmptyParams, execute_page_title);
core_wrap_async!(core_execute_page_goto, PageGotoParams, execute_page_goto);
core_wrap_async!(core_execute_page_back, EmptyParams, execute_page_back);
core_wrap_async!(core_execute_page_forward, EmptyParams, execute_page_forward);
core_wrap_async!(core_execute_page_reload, EmptyParams, execute_page_reload);
core_wrap_async!(core_execute_page_click, PageClickParams, execute_page_click);
core_wrap_async!(core_execute_page_fill, PageFillParams, execute_page_fill);
core_wrap_async!(core_execute_page_append, PageAppendParams, execute_page_append);
core_wrap_async!(core_execute_page_find, PageFindParams, execute_page_find);
core_wrap_async!(core_execute_page_wait_for, PageWaitForParams, execute_page_wait_for);
core_wrap_async!(core_execute_page_extract, PageExtractParams, execute_page_extract);
core_wrap_async!(core_execute_page_screenshot, EmptyParams, execute_page_screenshot);
core_wrap_async!(core_execute_page_snapshot_text, DomSnapshotParams, execute_page_snapshot_text);
core_wrap_async!(core_execute_page_snapshot_data, DomSnapshotParams, execute_page_snapshot_data);
core_wrap_async!(core_execute_sidepanel_snapshot_text, DomSnapshotParams, execute_sidepanel_snapshot_text);
core_wrap_async!(core_execute_sidepanel_snapshot_data, DomSnapshotParams, execute_sidepanel_snapshot_data);
core_wrap_async!(core_execute_sidepanel_click, PageClickParams, execute_sidepanel_click);
core_wrap_async!(core_execute_sidepanel_fill, PageFillParams, execute_sidepanel_fill);
core_wrap_async!(core_execute_sidepanel_append, PageAppendParams, execute_sidepanel_append);
core_wrap_async_empty!(core_execute_sidepanel_url, execute_sidepanel_url);
core_wrap_async_empty!(core_execute_sidepanel_title, execute_sidepanel_title);

core_wrap_sync!(core_execute_dom_snapshot, DomSnapshotParams, execute_dom_snapshot);
core_wrap_sync!(core_execute_dom_format, DomFormatParams, execute_dom_format);

core_wrap_async_empty!(core_execute_storage_list, execute_storage_list);

// ─── Registry initialization ────────────────────────────────────

/// Initialize the handler registry with all web-available async APIs.
/// This function is idempotent — calling it multiple times is safe.
pub fn init_registry() {


    // Avoid double-registration
    if !web_js_core::handler_registry::is_empty() {
        return;
    }

    // ─── web.* ───────────────────────────────────────────────────
    web_js_core::web_api! {
        action: "mock_async",
        namespace: "web",
        name: "mock_async",
        doc: "Mock async action for testing.",
        params: [],
        returns: "null" => "None",
        param_struct: EmptyParams,
        handler: core_execute_mock_async,
    }

    web_js_core::web_api! {
        action: "sleep",
        namespace: "web",
        name: "sleep",
        doc: "Sleep for a given duration.",
        params: [
            duration: "number", "required", "Duration in milliseconds",
        ],
        returns: "null" => "None",
        param_struct: SleepParams,
        handler: core_execute_sleep,
        fields: ["duration"],
    }

    web_js_core::web_api! {
        action: "fetch",
        namespace: "web",
        name: "fetch",
        doc: "Perform an HTTP fetch request.",
        params: [
            url: "string", "required", "URL to fetch",
            method: "string", "optional", "HTTP method",
            headers: "object", "optional", "Request headers",
            body: "string", "optional", "Request body",
            timeout: "number", "optional", "Timeout in milliseconds",
        ],
        returns: "object" => "Response object with status, ok, and body",
        param_struct: FetchArgs,
        handler: core_execute_fetch_positional,
        fields: ["url", "options"],
    }

    // ─── page.* ──────────────────────────────────────────────────
    web_js_core::web_api! {
        action: "page_url",
        namespace: "page",
        name: "url",
        doc: "Get the current page URL.",
        params: [],
        returns: "string" => "Current URL",
        param_struct: EmptyParams,
        handler: core_execute_page_url,
    }

    web_js_core::web_api! {
        action: "page_title",
        namespace: "page",
        name: "title",
        doc: "Get the current page title.",
        params: [],
        returns: "string" => "Page title",
        param_struct: EmptyParams,
        handler: core_execute_page_title,
    }

    web_js_core::web_api! {
        action: "page_goto",
        namespace: "page",
        name: "goto",
        doc: "Navigate to a URL.",
        params: [
            url: "string", "required", "URL to navigate to",
        ],
        returns: "null" => "None",
        param_struct: PageGotoParams,
        handler: core_execute_page_goto,
        fields: ["url"],
    }

    web_js_core::web_api! {
        action: "page_back",
        namespace: "page",
        name: "back",
        doc: "Go back in browser history.",
        params: [],
        returns: "null" => "None",
        param_struct: EmptyParams,
        handler: core_execute_page_back,
    }

    web_js_core::web_api! {
        action: "page_forward",
        namespace: "page",
        name: "forward",
        doc: "Go forward in browser history.",
        params: [],
        returns: "null" => "None",
        param_struct: EmptyParams,
        handler: core_execute_page_forward,
    }

    web_js_core::web_api! {
        action: "page_reload",
        namespace: "page",
        name: "reload",
        doc: "Reload the current page.",
        params: [],
        returns: "null" => "None",
        param_struct: EmptyParams,
        handler: core_execute_page_reload,
    }

    web_js_core::web_api! {
        action: "page_click",
        namespace: "page",
        name: "click",
        doc: "Click an element by refId or label.",
        params: [
            ref_id: "string", "required", "Element refId",
            label: "string", "optional", "Element label",
        ],
        returns: "null" => "None",
        param_struct: PageClickParams,
        handler: core_execute_page_click,
        fields: ["refId"],
    }

    web_js_core::web_api! {
        action: "page_fill",
        namespace: "page",
        name: "fill",
        doc: "Fill an input element with a value.",
        params: [
            ref_id: "string", "required", "Element refId",
            label: "string", "optional", "Element label",
            value: "string", "required", "Value to fill",
        ],
        returns: "null" => "None",
        param_struct: PageFillParams,
        handler: core_execute_page_fill,
        fields: ["refId", "value"],
    }

    web_js_core::web_api! {
        action: "page_type",
        namespace: "page",
        name: "type",
        doc: "Type text into an input element.",
        params: [
            ref_id: "string", "required", "Element refId",
            label: "string", "optional", "Element label",
            text: "string", "required", "Text to type",
        ],
        returns: "boolean" => "Whether the type succeeded",
        param_struct: PageTypeParams,
        handler: core_execute_page_type,
        fields: ["refId", "text"],
    }

    web_js_core::web_api! {
        action: "page_append",
        namespace: "page",
        name: "append",
        doc: "Append text to an input element.",
        params: [
            ref_id: "string", "required", "Element refId",
            label: "string", "optional", "Element label",
            text: "string", "required", "Text to append",
        ],
        returns: "null" => "None",
        param_struct: PageAppendParams,
        handler: core_execute_page_append,
        fields: ["refId", "text"],
    }

    web_js_core::web_api! {
        action: "page_press",
        namespace: "page",
        name: "press",
        doc: "Press a key on the page.",
        params: [
            key: "string", "required", "Key to press",
        ],
        returns: "boolean" => "Whether the press succeeded",
        param_struct: PagePressParams,
        handler: core_execute_page_press,
        fields: ["key"],
    }

    web_js_core::web_api! {
        action: "page_select",
        namespace: "page",
        name: "select",
        doc: "Select an option in a select element.",
        params: [
            ref_id: "string", "required", "Element refId",
            value: "string", "required", "Option value",
        ],
        returns: "boolean" => "Whether the select succeeded",
        param_struct: PageSelectParams,
        handler: core_execute_page_select,
        fields: ["refId", "value"],
    }

    web_js_core::web_api! {
        action: "page_check",
        namespace: "page",
        name: "check",
        doc: "Check or uncheck a checkbox.",
        params: [
            ref_id: "string", "required", "Element refId",
            checked: "boolean", "optional", "Whether to check",
        ],
        returns: "boolean" => "Whether the check succeeded",
        param_struct: PageCheckParams,
        handler: core_execute_page_check,
        fields: ["refId", "checked"],
    }

    web_js_core::web_api! {
        action: "page_hover",
        namespace: "page",
        name: "hover",
        doc: "Hover over an element.",
        params: [
            ref_id: "string", "required", "Element refId",
        ],
        returns: "boolean" => "Whether the hover succeeded",
        param_struct: PageHoverParams,
        handler: core_execute_page_hover,
        fields: ["refId"],
    }

    web_js_core::web_api! {
        action: "page_unhover",
        namespace: "page",
        name: "unhover",
        doc: "Unhover from all elements.",
        params: [],
        returns: "boolean" => "Whether the unhover succeeded",
        param_struct: EmptyParams,
        handler: core_execute_page_unhover,
    }

    web_js_core::web_api! {
        action: "page_scroll",
        namespace: "page",
        name: "scroll",
        doc: "Scroll the page.",
        params: [
            direction: "string", "optional", "Scroll direction",
            amount: "number", "optional", "Scroll amount",
        ],
        returns: "boolean" => "Whether the scroll succeeded",
        param_struct: PageScrollParams,
        handler: core_execute_page_scroll,
    }

    web_js_core::web_api! {
        action: "page_scroll_to",
        namespace: "page",
        name: "scroll_to",
        doc: "Scroll to an element.",
        params: [
            ref_id: "string", "required", "Element refId",
        ],
        returns: "boolean" => "Whether the scroll succeeded",
        param_struct: PageScrollToParams,
        handler: core_execute_page_scroll_to,
        fields: ["refId"],
    }

    web_js_core::web_api! {
        action: "page_dblclick",
        namespace: "page",
        name: "dblclick",
        doc: "Double-click an element.",
        params: [
            ref_id: "string", "required", "Element refId",
            label: "string", "optional", "Element label",
        ],
        returns: "boolean" => "Whether the dblclick succeeded",
        param_struct: PageDblClickParams,
        handler: core_execute_page_dblclick,
        fields: ["refId"],
    }

    web_js_core::web_api! {
        action: "page_wait",
        namespace: "page",
        name: "wait",
        doc: "Wait for a given duration.",
        params: [
            duration: "number", "optional", "Duration in milliseconds",
        ],
        returns: "boolean" => "Whether the wait completed",
        param_struct: PageWaitParams,
        handler: core_execute_page_wait,
        fields: ["duration"],
    }

    web_js_core::web_api! {
        action: "page_find",
        namespace: "page",
        name: "find",
        doc: "Find elements matching a CSS selector.",
        params: [
            selector: "string", "required", "CSS selector",
        ],
        returns: "array" => "Array of matching elements",
        param_struct: PageFindParams,
        handler: core_execute_page_find,
        fields: ["selector"],
    }

    web_js_core::web_api! {
        action: "page_wait_for",
        namespace: "page",
        name: "wait_for",
        doc: "Wait for an element to appear.",
        params: [
            selector: "string", "required", "CSS selector",
            timeout: "number", "optional", "Timeout in milliseconds",
        ],
        returns: "boolean" => "Whether the element was found",
        param_struct: PageWaitForParams,
        handler: core_execute_page_wait_for,
        fields: ["selector", "timeout"],
    }

    web_js_core::web_api! {
        action: "page_extract",
        namespace: "page",
        name: "extract",
        doc: "Extract data from the page.",
        params: [
            fields: "array", "required", "Fields to extract",
        ],
        returns: "object" => "Extracted data",
        param_struct: PageExtractParams,
        handler: core_execute_page_extract,
        fields: ["fields"],
    }

    web_js_core::web_api! {
        action: "page_screenshot",
        namespace: "page",
        name: "screenshot",
        doc: "Take a screenshot of the page.",
        params: [],
        returns: "string" => "Screenshot data (not yet implemented)",
        param_struct: EmptyParams,
        handler: core_execute_page_screenshot,
    }

    web_js_core::web_api! {
        action: "page_snapshot",
        namespace: "page",
        name: "snapshot",
        doc: "Take a DOM snapshot of the page.",
        params: [
            interactive_only: "boolean", "optional", "Only interactive elements",
            max_nodes: "number", "optional", "Maximum nodes to collect",
        ],
        returns: "object" => "Snapshot data",
        param_struct: DomSnapshotParams,
        handler: core_execute_dom_snapshot,
    }

    web_js_core::web_api! {
        action: "page_snapshot_text",
        namespace: "page",
        name: "snapshot_text",
        doc: "Take a DOM snapshot and return text only.",
        params: [
            interactive_only: "boolean", "optional", "Only interactive elements",
            max_nodes: "number", "optional", "Maximum nodes to collect",
        ],
        returns: "string" => "Snapshot text",
        param_struct: DomSnapshotParams,
        handler: core_execute_page_snapshot_text,
    }

    web_js_core::web_api! {
        action: "page_snapshot_data",
        namespace: "page",
        name: "snapshot_data",
        doc: "Take a DOM snapshot and return data only.",
        params: [
            interactive_only: "boolean", "optional", "Only interactive elements",
            max_nodes: "number", "optional", "Maximum nodes to collect",
        ],
        returns: "object" => "Snapshot data",
        param_struct: DomSnapshotParams,
        handler: core_execute_page_snapshot_data,
    }

    // ─── dom.* ───────────────────────────────────────────────────
    web_js_core::web_api! {
        action: "dom_snapshot",
        namespace: "dom",
        name: "snapshot",
        doc: "Take a DOM snapshot.",
        params: [
            interactive_only: "boolean", "optional", "Only interactive elements",
            max_nodes: "number", "optional", "Maximum nodes to collect",
        ],
        returns: "object" => "Snapshot data",
        param_struct: DomSnapshotParams,
        handler: core_execute_dom_snapshot,
    }

    web_js_core::web_api! {
        action: "dom_format",
        namespace: "dom",
        name: "format",
        doc: "Format a DOM snapshot.",
        params: [
            snapshot: "object", "required", "Snapshot data",
            format: "string", "optional", "Output format",
        ],
        returns: "string" => "Formatted snapshot",
        param_struct: DomFormatParams,
        handler: core_execute_dom_format,
    }

    // ─── sidepanel.* ─────────────────────────────────────────────
    web_js_core::web_api! {
        action: "sidepanel_snapshot_text",
        namespace: "sidepanel",
        name: "snapshot_text",
        doc: "Take a sidepanel snapshot and return text.",
        params: [
            interactive_only: "boolean", "optional", "Only interactive elements",
            max_nodes: "number", "optional", "Maximum nodes to collect",
        ],
        returns: "string" => "Snapshot text",
        param_struct: DomSnapshotParams,
        handler: core_execute_sidepanel_snapshot_text,
    }

    web_js_core::web_api! {
        action: "sidepanel_snapshot_data",
        namespace: "sidepanel",
        name: "snapshot_data",
        doc: "Take a sidepanel snapshot and return data.",
        params: [
            interactive_only: "boolean", "optional", "Only interactive elements",
            max_nodes: "number", "optional", "Maximum nodes to collect",
        ],
        returns: "object" => "Snapshot data",
        param_struct: DomSnapshotParams,
        handler: core_execute_sidepanel_snapshot_data,
    }

    web_js_core::web_api! {
        action: "sidepanel_click",
        namespace: "sidepanel",
        name: "click",
        doc: "Click an element in the sidepanel.",
        params: [
            ref_id: "string", "required", "Element refId",
            label: "string", "optional", "Element label",
        ],
        returns: "null" => "None",
        param_struct: PageClickParams,
        handler: core_execute_sidepanel_click,
        fields: ["refId"],
    }

    web_js_core::web_api! {
        action: "sidepanel_dblclick",
        namespace: "sidepanel",
        name: "dblclick",
        doc: "Double-click an element in the sidepanel.",
        params: [
            ref_id: "string", "required", "Element refId",
            label: "string", "optional", "Element label",
        ],
        returns: "boolean" => "Whether the dblclick succeeded",
        param_struct: PageDblClickParams,
        handler: core_execute_page_dblclick,
        fields: ["refId"],
    }

    web_js_core::web_api! {
        action: "sidepanel_fill",
        namespace: "sidepanel",
        name: "fill",
        doc: "Fill an input in the sidepanel.",
        params: [
            ref_id: "string", "required", "Element refId",
            label: "string", "optional", "Element label",
            value: "string", "required", "Value to fill",
        ],
        returns: "null" => "None",
        param_struct: PageFillParams,
        handler: core_execute_sidepanel_fill,
        fields: ["refId", "value"],
    }

    web_js_core::web_api! {
        action: "sidepanel_type",
        namespace: "sidepanel",
        name: "type",
        doc: "Type text into an input in the sidepanel.",
        params: [
            ref_id: "string", "required", "Element refId",
            label: "string", "optional", "Element label",
            text: "string", "required", "Text to type",
        ],
        returns: "boolean" => "Whether the type succeeded",
        param_struct: PageTypeParams,
        handler: core_execute_page_type,
        fields: ["refId", "text"],
    }

    web_js_core::web_api! {
        action: "sidepanel_append",
        namespace: "sidepanel",
        name: "append",
        doc: "Append text to an input in the sidepanel.",
        params: [
            ref_id: "string", "required", "Element refId",
            label: "string", "optional", "Element label",
            text: "string", "required", "Text to append",
        ],
        returns: "null" => "None",
        param_struct: PageAppendParams,
        handler: core_execute_sidepanel_append,
        fields: ["refId", "text"],
    }

    web_js_core::web_api! {
        action: "sidepanel_press",
        namespace: "sidepanel",
        name: "press",
        doc: "Press a key in the sidepanel.",
        params: [
            key: "string", "required", "Key to press",
        ],
        returns: "boolean" => "Whether the press succeeded",
        param_struct: PagePressParams,
        handler: core_execute_page_press,
        fields: ["key"],
    }

    web_js_core::web_api! {
        action: "sidepanel_select",
        namespace: "sidepanel",
        name: "select",
        doc: "Select an option in the sidepanel.",
        params: [
            ref_id: "string", "required", "Element refId",
            value: "string", "required", "Option value",
        ],
        returns: "boolean" => "Whether the select succeeded",
        param_struct: PageSelectParams,
        handler: core_execute_page_select,
        fields: ["refId", "value"],
    }

    web_js_core::web_api! {
        action: "sidepanel_check",
        namespace: "sidepanel",
        name: "check",
        doc: "Check or uncheck a checkbox in the sidepanel.",
        params: [
            ref_id: "string", "required", "Element refId",
            checked: "boolean", "optional", "Whether to check",
        ],
        returns: "boolean" => "Whether the check succeeded",
        param_struct: PageCheckParams,
        handler: core_execute_page_check,
        fields: ["refId", "checked"],
    }

    web_js_core::web_api! {
        action: "sidepanel_hover",
        namespace: "sidepanel",
        name: "hover",
        doc: "Hover over an element in the sidepanel.",
        params: [
            ref_id: "string", "required", "Element refId",
        ],
        returns: "boolean" => "Whether the hover succeeded",
        param_struct: PageHoverParams,
        handler: core_execute_page_hover,
        fields: ["refId"],
    }

    web_js_core::web_api! {
        action: "sidepanel_unhover",
        namespace: "sidepanel",
        name: "unhover",
        doc: "Unhover from all elements in the sidepanel.",
        params: [],
        returns: "boolean" => "Whether the unhover succeeded",
        param_struct: EmptyParams,
        handler: core_execute_page_unhover,
    }

    web_js_core::web_api! {
        action: "sidepanel_scroll",
        namespace: "sidepanel",
        name: "scroll",
        doc: "Scroll the sidepanel.",
        params: [
            direction: "string", "optional", "Scroll direction",
            amount: "number", "optional", "Scroll amount",
        ],
        returns: "boolean" => "Whether the scroll succeeded",
        param_struct: PageScrollParams,
        handler: core_execute_page_scroll,
    }

    web_js_core::web_api! {
        action: "sidepanel_scroll_to",
        namespace: "sidepanel",
        name: "scroll_to",
        doc: "Scroll to an element in the sidepanel.",
        params: [
            ref_id: "string", "required", "Element refId",
        ],
        returns: "boolean" => "Whether the scroll succeeded",
        param_struct: PageScrollToParams,
        handler: core_execute_page_scroll_to,
        fields: ["refId"],
    }

    web_js_core::web_api! {
        action: "sidepanel_url",
        namespace: "sidepanel",
        name: "url",
        doc: "Get the sidepanel URL.",
        params: [],
        returns: "string" => "Current URL",
        param_struct: EmptyParams,
        handler: core_execute_sidepanel_url,
    }

    web_js_core::web_api! {
        action: "sidepanel_title",
        namespace: "sidepanel",
        name: "title",
        doc: "Get the sidepanel title.",
        params: [],
        returns: "string" => "Page title",
        param_struct: EmptyParams,
        handler: core_execute_sidepanel_title,
    }

    web_js_core::web_api! {
        action: "sidepanel_wait",
        namespace: "sidepanel",
        name: "wait",
        doc: "Wait for a duration in the sidepanel.",
        params: [
            duration: "number", "optional", "Duration in milliseconds",
        ],
        returns: "boolean" => "Whether the wait completed",
        param_struct: PageWaitParams,
        handler: core_execute_page_wait,
        fields: ["duration"],
    }

    // ─── storage.* ───────────────────────────────────────────────
    web_js_core::web_api! {
        action: "storage_get",
        namespace: "web.storage",
        name: "get",
        doc: "Get a value from localStorage.",
        params: [
            key: "string", "required", "Storage key",
        ],
        returns: "string" => "Stored value or null",
        param_struct: StorageGetParams,
        handler: core_execute_storage_get,
        fields: ["key"],
    }

    web_js_core::web_api! {
        action: "storage_set",
        namespace: "web.storage",
        name: "set",
        doc: "Set a value in localStorage.",
        params: [
            key: "string", "required", "Storage key",
            value: "string", "required", "Value to store",
        ],
        returns: "null" => "None",
        param_struct: StorageSetParams,
        handler: core_execute_storage_set,
        fields: ["key", "value"],
    }

    web_js_core::web_api! {
        action: "storage_delete",
        namespace: "web.storage",
        name: "delete",
        doc: "Delete a key from localStorage.",
        params: [
            key: "string", "required", "Storage key",
        ],
        returns: "null" => "None",
        param_struct: StorageDeleteParams,
        handler: core_execute_storage_delete,
        fields: ["key"],
    }

    web_js_core::web_api! {
        action: "storage_list",
        namespace: "web.storage",
        name: "list",
        doc: "List all keys in localStorage.",
        params: [],
        returns: "array" => "Array of keys",
        param_struct: EmptyParams,
        handler: core_execute_storage_list,
    }

    // ─── fs.* ────────────────────────────────────────────────────
    web_js_core::web_api! {
        action: "fs_exists",
        namespace: "fs",
        name: "exists",
        doc: "Check if a file or directory exists.",
        params: [
            path: "string", "required", "File path",
        ],
        returns: "boolean" => "Whether the path exists",
        param_struct: FsPathParams,
        handler: core_execute_fs_exists,
        fields: ["path"],
    }

    web_js_core::web_api! {
        action: "fs_stat",
        namespace: "fs",
        name: "stat",
        doc: "Get file or directory metadata.",
        params: [
            path: "string", "required", "File path",
        ],
        returns: "object" => "Metadata object",
        param_struct: FsPathParams,
        handler: core_execute_fs_stat,
        fields: ["path"],
    }

    web_js_core::web_api! {
        action: "fs_list",
        namespace: "fs",
        name: "list",
        doc: "List directory contents.",
        params: [
            path: "string", "required", "Directory path",
        ],
        returns: "array" => "Array of entries",
        param_struct: FsPathParams,
        handler: core_execute_fs_list,
        fields: ["path"],
    }

    web_js_core::web_api! {
        action: "fs_mkdir",
        namespace: "fs",
        name: "mkdir",
        doc: "Create a directory.",
        params: [
            path: "string", "required", "Directory path",
        ],
        returns: "boolean" => "Whether the directory was created",
        param_struct: FsPathParams,
        handler: core_execute_fs_mkdir,
        fields: ["path"],
    }

    web_js_core::web_api! {
        action: "fs_delete",
        namespace: "fs",
        name: "delete",
        doc: "Delete a file or directory.",
        params: [
            path: "string", "required", "File path",
        ],
        returns: "boolean" => "Whether the deletion succeeded",
        param_struct: FsPathParams,
        handler: core_execute_fs_delete,
        fields: ["path"],
    }

    web_js_core::web_api! {
        action: "fs_copy",
        namespace: "fs",
        name: "copy",
        doc: "Copy a file.",
        params: [
            from: "string", "required", "Source path",
            to: "string", "required", "Destination path",
        ],
        returns: "boolean" => "Whether the copy succeeded",
        param_struct: FsCopyParams,
        handler: core_execute_fs_copy,
        fields: ["from", "to"],
    }

    web_js_core::web_api! {
        action: "fs_move",
        namespace: "fs",
        name: "move",
        doc: "Move or rename a file.",
        params: [
            from: "string", "required", "Source path",
            to: "string", "required", "Destination path",
        ],
        returns: "boolean" => "Whether the move succeeded",
        param_struct: FsCopyParams,
        handler: core_execute_fs_move,
        fields: ["from", "to"],
    }

    web_js_core::web_api! {
        action: "fs_read",
        namespace: "fs",
        name: "read",
        doc: "Read a file as base64.",
        params: [
            path: "string", "required", "File path",
        ],
        returns: "string" => "Base64-encoded file contents",
        param_struct: FsPathParams,
        handler: core_execute_fs_read,
        fields: ["path"],
    }

    web_js_core::web_api! {
        action: "fs_read_text",
        namespace: "fs",
        name: "read_text",
        doc: "Read a file as text.",
        params: [
            path: "string", "required", "File path",
        ],
        returns: "string" => "File contents",
        param_struct: FsPathParams,
        handler: core_execute_fs_read_text,
        fields: ["path"],
    }

    web_js_core::web_api! {
        action: "fs_read_base64",
        namespace: "fs",
        name: "read_base64",
        doc: "Read a file as base64.",
        params: [
            path: "string", "required", "File path",
        ],
        returns: "string" => "Base64-encoded file contents",
        param_struct: FsPathParams,
        handler: core_execute_fs_read_base64,
        fields: ["path"],
    }

    web_js_core::web_api! {
        action: "fs_read_range",
        namespace: "fs",
        name: "read_range",
        doc: "Read a range of bytes from a file.",
        params: [
            path: "string", "required", "File path",
            offset: "number", "required", "Start offset",
            len: "number", "required", "Number of bytes to read",
        ],
        returns: "string" => "Base64-encoded bytes",
        param_struct: FsReadRangeParams,
        handler: core_execute_fs_read_range,
        fields: ["path", "offset", "len"],
    }

    web_js_core::web_api! {
        action: "fs_write",
        namespace: "fs",
        name: "write",
        doc: "Write base64 data to a file.",
        params: [
            path: "string", "required", "File path",
            data: "string", "required", "Base64-encoded data",
        ],
        returns: "boolean" => "Whether the write succeeded",
        param_struct: FsWriteParams,
        handler: core_execute_fs_write,
        fields: ["path", "data"],
    }

    web_js_core::web_api! {
        action: "fs_write_text",
        namespace: "fs",
        name: "write_text",
        doc: "Write text to a file.",
        params: [
            path: "string", "required", "File path",
            data: "string", "required", "Text data",
        ],
        returns: "boolean" => "Whether the write succeeded",
        param_struct: FsWriteParams,
        handler: core_execute_fs_write_text,
        fields: ["path", "data"],
    }

    web_js_core::web_api! {
        action: "fs_write_base64",
        namespace: "fs",
        name: "write_base64",
        doc: "Write base64 data to a file.",
        params: [
            path: "string", "required", "File path",
            data: "string", "required", "Base64-encoded data",
        ],
        returns: "boolean" => "Whether the write succeeded",
        param_struct: FsWriteParams,
        handler: core_execute_fs_write_base64,
        fields: ["path", "data"],
    }

    web_js_core::web_api! {
        action: "fs_append",
        namespace: "fs",
        name: "append",
        doc: "Append base64 data to a file.",
        params: [
            path: "string", "required", "File path",
            data: "string", "required", "Base64-encoded data",
        ],
        returns: "boolean" => "Whether the append succeeded",
        param_struct: FsWriteParams,
        handler: core_execute_fs_append,
        fields: ["path", "data"],
    }

    web_js_core::web_api! {
        action: "fs_append_text",
        namespace: "fs",
        name: "append_text",
        doc: "Append text to a file.",
        params: [
            path: "string", "required", "File path",
            data: "string", "required", "Text data",
        ],
        returns: "boolean" => "Whether the append succeeded",
        param_struct: FsWriteParams,
        handler: core_execute_fs_append_text,
        fields: ["path", "data"],
    }

    web_js_core::web_api! {
        action: "fs_append_base64",
        namespace: "fs",
        name: "append_base64",
        doc: "Append base64 data to a file.",
        params: [
            path: "string", "required", "File path",
            data: "string", "required", "Base64-encoded data",
        ],
        returns: "boolean" => "Whether the append succeeded",
        param_struct: FsWriteParams,
        handler: core_execute_fs_append_base64,
        fields: ["path", "data"],
    }

    web_js_core::web_api! {
        action: "fs_update",
        namespace: "fs",
        name: "update",
        doc: "Update a file at a given offset.",
        params: [
            path: "string", "required", "File path",
            offset: "number", "required", "Start offset",
            data: "string", "required", "Base64-encoded data",
        ],
        returns: "boolean" => "Whether the update succeeded",
        param_struct: FsUpdateParams,
        handler: core_execute_fs_update,
        fields: ["path", "offset", "data"],
    }

    web_js_core::web_api! {
        action: "fs_hash",
        namespace: "fs",
        name: "hash",
        doc: "Compute the hash of a file.",
        params: [
            path: "string", "required", "File path",
            algo: "string", "required", "Hash algorithm",
        ],
        returns: "string" => "Hex-encoded hash",
        param_struct: FsHashParams,
        handler: core_execute_fs_hash,
        fields: ["path", "algo"],
    }

    // ─── host.* ──────────────────────────────────────────────────
    web_js_core::web_api! {
        action: "host_call",
        namespace: "host",
        name: "call",
        doc: "Call a registered host handler.",
        params: [
            action: "string", "required", "Handler action name",
            params: "object", "optional", "Handler parameters",
        ],
        returns: "any" => "Handler result",
        param_struct: HostCallParams,
        handler: core_execute_host_call,
    }

    // ─── Extension-only APIs (unavailable in web context) ────────
    web_js_core::web_api_unavailable_batch! {
        ("page_tabs", "page", "tabs"),
        ("page_switch", "page", "switch", fields: ["tabId"]),
        ("page_new_tab", "page", "new_tab", fields: ["url"]),
        ("page_close", "page", "close", fields: ["tabId"]),
        ("page_active_tab", "page", "active_tab"),
        ("tab_query", "web.tab", "query"),
        ("tab_create", "web.tab", "create"),
        ("tab_activate", "web.tab", "activate", fields: ["tabId"]),
        ("tab_close", "web.tab", "close", fields: ["tabIds"]),
        ("tab_execute_script", "web.tab", "execute_script", fields: ["tabId", "details"]),
        ("tab_click", "web.tab", "click", fields: ["refId"]),
        ("tab_fill", "web.tab", "fill", fields: ["refId", "value"]),
        ("tab_snapshot", "web.tab", "snapshot", fields: ["tabId"]),
        ("tab_snapshot_text", "web.tab", "snapshot_text", fields: ["tabId"]),
        ("tab_snapshot_data", "web.tab", "snapshot_data", fields: ["tabId"]),
        ("tab_scroll_to", "web.tab", "scroll_to", fields: ["refId"]),
        ("tab_evaluate", "web.tab", "evaluate", fields: ["script"]),
        ("tab_type", "web.tab", "type", fields: ["refId", "text"]),
        ("tab_press", "web.tab", "press", fields: ["key"]),
        ("tab_select", "web.tab", "select", fields: ["refId", "value"]),
        ("tab_check", "web.tab", "check", fields: ["refId", "checked"]),
        ("tab_hover", "web.tab", "hover", fields: ["refId"]),
        ("tab_unhover", "web.tab", "unhover"),
        ("tab_scroll", "web.tab", "scroll", fields: ["direction", "amount"]),
        ("tab_dblclick", "web.tab", "dblclick", fields: ["refId"]),
        ("tab_back", "web.tab", "back"),
        ("tab_wait_for_load", "web.tab", "wait_for_load", fields: ["tabId", "timeout"]),
        ("tab_fetch", "web.tab", "fetch", fields: ["url"]),
        ("cookies_get", "web.cookies", "get", fields: ["name", "url"]),
        ("cookies_set", "web.cookies", "set"),
        ("cookies_delete", "web.cookies", "delete", fields: ["name", "url"]),
        ("cookies_list", "web.cookies", "list"),
        ("history_search", "web.history", "search"),
        ("history_delete", "web.history", "delete", fields: ["url"]),
        ("bookmarks_search", "web.bookmarks", "search"),
        ("bookmarks_create", "web.bookmarks", "create"),
        ("bookmarks_delete", "web.bookmarks", "delete", fields: ["id"]),
        ("notifications_create", "web.notifications", "create", fields: ["id", "options"]),
        ("notifications_clear", "web.notifications", "clear", fields: ["id"]),
        ("clipboard_read", "web.clipboard", "read"),
        ("clipboard_write", "web.clipboard", "write", fields: ["text"]),
        ("storage_get_many", "web.storage", "get_many"),
        ("storage_set_many", "web.storage", "set_many"),
        ("storage_delete_many", "web.storage", "delete_many", fields: ["keys"]),
        ("storage_get_all", "web.storage", "get_all"),
        ("storage_clear", "web.storage", "clear"),
        ("chrome_runtime_sendMessage", "chrome.runtime", "sendMessage", fields: ["message", "options"]),
        ("chrome_tabs_query", "chrome.tabs", "query"),
        ("chrome_tabs_create", "chrome.tabs", "create"),
        ("chrome_tabs_update", "chrome.tabs", "update"),
        ("chrome_tabs_remove", "chrome.tabs", "remove", fields: ["tabIds"]),
        ("chrome_tabs_get", "chrome.tabs", "get", fields: ["tabId"]),
        ("chrome_tabs_reload", "chrome.tabs", "reload"),
        ("chrome_tabs_sendMessage", "chrome.tabs", "sendMessage", fields: ["tabId", "message", "options"]),
        ("chrome_alarms_create", "chrome.alarms", "create", fields: ["name", "alarmInfo"]),
        ("chrome_alarms_clear", "chrome.alarms", "clear", fields: ["name"]),
        ("chrome_action_setBadgeText", "chrome.action", "setBadgeText"),
        ("chrome_action_setBadgeBackgroundColor", "chrome.action", "setBadgeBackgroundColor"),
        ("chrome_action_setTitle", "chrome.action", "setTitle"),
        ("chrome_action_setIcon", "chrome.action", "setIcon"),
        ("chrome_contextMenus_create", "chrome.contextMenus", "create"),
        ("chrome_contextMenus_remove", "chrome.contextMenus", "remove", fields: ["menuItemId"]),
        ("chrome_windows_getAll", "chrome.windows", "getAll"),
        ("chrome_windows_getCurrent", "chrome.windows", "getCurrent"),
        ("chrome_windows_create", "chrome.windows", "create"),
        ("chrome_windows_update", "chrome.windows", "update"),
        ("chrome_windows_remove", "chrome.windows", "remove", fields: ["windowId"]),
        ("chrome_sessions_getRecentlyClosed", "chrome.sessions", "getRecentlyClosed"),
        ("chrome_sessions_getDevices", "chrome.sessions", "getDevices"),
        ("chrome_sessions_restore", "chrome.sessions", "restore", fields: ["sessionId"]),
        ("chrome_sidePanel_setOptions", "chrome.sidePanel", "setOptions"),
        ("chrome_cookies_get", "chrome.cookies", "get"),
        ("chrome_cookies_set", "chrome.cookies", "set"),
        ("chrome_cookies_remove", "chrome.cookies", "remove"),
        ("chrome_cookies_getAll", "chrome.cookies", "getAll"),
        ("chrome_bookmarks_search", "chrome.bookmarks", "search"),
        ("chrome_bookmarks_create", "chrome.bookmarks", "create"),
        ("chrome_bookmarks_remove", "chrome.bookmarks", "remove", fields: ["id"]),
        ("chrome_history_search", "chrome.history", "search"),
        ("chrome_history_deleteUrl", "chrome.history", "deleteUrl", fields: ["url"]),
        ("chrome_notifications_create", "chrome.notifications", "create", fields: ["id", "options"]),
        ("chrome_notifications_clear", "chrome.notifications", "clear", fields: ["id"]),
        ("chrome_scripting_executeScript", "chrome.scripting", "executeScript"),
        ("runtime_inspect", "runtime", "inspect"),
        ("url_parse", "web.url", "parse"),
        ("url_encode", "web.url", "encode"),
        ("web_log", "web", "log")
    }
}

/// Dispatch a command via the handler registry, auto-initializing if needed.
pub async fn dispatch_command(cmd: &web_js_base::types::WasmAsyncCommand) -> Result<web_js_base::types::WasmAsyncResponse, String> {
    if web_js_core::handler_registry::is_empty() {
        init_registry();
    }

    let core_cmd = web_js_core::AsyncCommand {
        call_id: cmd.call_id,
        action: cmd.action.clone(),
        params: cmd.params.clone(),
    };

    let core_resp = web_js_core::handler_registry::dispatch_command(&core_cmd).await?;

    Ok(web_js_base::types::WasmAsyncResponse {
        ok: core_resp.ok,
        value: core_resp.value,
        error: core_resp.error.map(|e| web_js_base::types::WasmAsyncError {
            message: e.message,
            code: e.code,
        }),
    })
}

// ─── Tests ──────────────────────────────────────────────────────



