use serde_json;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use web_js_base::types::WasmAsyncError;
use web_js_base::types::WasmAsyncResponse;
use web_js_core::command_params::*;

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
    // not in the action argument (which is "call" from Action::Host("call")).
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
    let handler_params = params.get("params").cloned().unwrap_or(serde_json::Value::Object(serde_json::Map::new()));

    let window = match web_sys::window() {
        Some(w) => w,
        None => {
            return WasmAsyncResponse {
                ok: false,
                value: None,
                error: Some(WasmAsyncError {
                    message: "No window available".into(),
                    code: "E_HOST".into(),
                })
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
    let is_whitelisted = (0..keys.length())
        .any(|i| keys.get(i).as_string().as_deref() == Some(handler_name));
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
            }
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
                }
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

pub async fn execute_page_hover(params: PageHoverParams) -> WasmAsyncResponse {
    match get_element_by_ref_id(&params.ref_id) {
        Ok(element) => {
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
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(WasmAsyncError {
                message: e,
                code: "E_AGENT".into(),
            }),
        },
    }
}

pub async fn execute_page_unhover() -> WasmAsyncResponse {
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
    match get_element_by_ref_id(&params.ref_id) {
        Ok(element) => {
            element.scroll_into_view();
            WasmAsyncResponse {
                ok: true,
                value: Some(serde_json::Value::Bool(true)),
                error: None,
            }
        }
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(WasmAsyncError {
                message: e,
                code: "E_AGENT".into(),
            }),
        },
    }
}

pub async fn execute_page_dblclick(params: PageDblClickParams) -> WasmAsyncResponse {
    match get_element_by_ref_id(&params.ref_id) {
        Ok(element) => {
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
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(WasmAsyncError {
                message: e,
                code: "E_AGENT".into(),
            }),
        },
    }
}

pub async fn execute_page_type(params: PageTypeParams) -> WasmAsyncResponse {
    match get_element_by_ref_id(&params.ref_id) {
        Ok(element) => {
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
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(WasmAsyncError {
                message: e,
                code: "E_AGENT".into(),
            }),
        },
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
    match get_element_by_ref_id(&params.ref_id) {
        Ok(element) => {
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
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(WasmAsyncError {
                message: e,
                code: "E_AGENT".into(),
            }),
        },
    }
}

pub async fn execute_page_check(params: PageCheckParams) -> WasmAsyncResponse {
    match get_element_by_ref_id(&params.ref_id) {
        Ok(element) => {
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
        Err(e) => WasmAsyncResponse {
            ok: false,
            value: None,
            error: Some(WasmAsyncError {
                message: e,
                code: "E_AGENT".into(),
            }),
        },
    }
}

pub async fn execute_storage_list() -> WasmAsyncResponse {
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
