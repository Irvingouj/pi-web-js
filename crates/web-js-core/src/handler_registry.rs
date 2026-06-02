use std::cell::RefCell;
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;

use crate::types::{AsyncCommand, AsyncResponse};

pub type Handler = Box<
    dyn Fn(AsyncCommand) -> Pin<Box<dyn Future<Output = Result<AsyncResponse, String>>>>
>;

const HOST_PREFIX: &str = "host_";

thread_local! {
    static HANDLER_REGISTRY: RefCell<HashMap<String, Handler>> = RefCell::new(HashMap::new());
}

/// Register a handler for the given action name.
/// Returns `true` if the action was newly registered, `false` if it overwrote an existing handler.
pub fn register_handler(name: &str, handler: Handler) -> bool {
    HANDLER_REGISTRY.with(|reg| {
        let mut reg = reg.borrow_mut();
        let is_new = !reg.contains_key(name);
        reg.insert(name.to_string(), handler);
        is_new
    })
}

/// Shared error message for unavailable actions.
pub fn unavailable_error(action: &str) -> String {
    format!("{} is not available in this context", action)
}

pub fn clear_handlers() {
    HANDLER_REGISTRY.with(|reg| reg.borrow_mut().clear());
}

pub fn is_empty() -> bool {
    HANDLER_REGISTRY.with(|reg| reg.borrow().is_empty())
}

/// Return a snapshot of all registered handler action names.
pub fn list_handlers() -> Vec<String> {
    HANDLER_REGISTRY.with(|reg| reg.borrow().keys().cloned().collect())
}

pub async fn dispatch_command(cmd: &AsyncCommand) -> Result<AsyncResponse, String> {
    // Host-prefixed actions (e.g. host_greet) are emitted by the JS prelude when
    // calling native APIs. They are rewritten to host_call so the extension sidepanel
    // can route them through its single host_call handler. See prelude.js architecture.
    if let Some(stripped) = cmd.action.strip_prefix(HOST_PREFIX) {
        if !stripped.is_empty() && cmd.action != "host_call" {
            return dispatch_host_call(cmd, stripped).await;
        }
    }

    let future_opt = HANDLER_REGISTRY.with(|reg| {
        reg.borrow().get(&cmd.action).map(|h| h(cmd.clone()))
    });

    match future_opt {
        Some(fut) => fut.await,
        None => Err(unavailable_error(&cmd.action)),
    }
}

async fn dispatch_host_call(
    cmd: &AsyncCommand,
    host_action: &str,
) -> Result<AsyncResponse, String> {
    let mut params = cmd.params.clone();
    let Some(obj) = params.as_object_mut() else {
        return Err(format!(
            "host_ action requires object params, got {:?}",
            cmd.params
        ));
    };
    obj.insert(
        "action".to_string(),
        serde_json::Value::String(host_action.to_string()),
    );
    let host_cmd = AsyncCommand {
        call_id: cmd.call_id,
        action: "host_call".to_string(),
        params,
    };
    // Look up host_call handler directly to avoid recursion
    let future_opt = HANDLER_REGISTRY.with(|reg| {
        reg.borrow().get("host_call").map(|h| h(host_cmd))
    });
    match future_opt {
        Some(fut) => fut.await,
        None => Err("host_call handler not registered".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::AsyncCommand;

    // wasm32-unknown-unknown target has no std async runtime; this minimal block_on
    // is test-only and safe because the test futures are trivial (no wake needed).
    fn block_on<F: Future>(f: F) -> F::Output {
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
    fn test_register_and_dispatch() {
        clear_handlers();

        register_handler("test_action", Box::new(|_cmd| {
            Box::pin(async move {
                Ok(AsyncResponse {
                    ok: true,
                    value: Some(serde_json::json!("test_result")),
                    error: None,
                })
            })
        }));

        let cmd = AsyncCommand {
            call_id: 1,
            action: "test_action".to_string(),
            params: serde_json::json!({}),
        };

        let result = block_on(dispatch_command(&cmd));
        assert!(result.is_ok());
        let resp = result.unwrap();
        assert!(resp.ok);
        assert_eq!(resp.value, Some(serde_json::json!("test_result")));

        clear_handlers();
    }

    #[test]
    fn test_unknown_action() {
        clear_handlers();

        let cmd = AsyncCommand {
            call_id: 1,
            action: "unknown".to_string(),
            params: serde_json::json!({}),
        };

        let result = block_on(dispatch_command(&cmd));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unknown is not available"));

        clear_handlers();
    }

    #[test]
    fn test_is_empty_and_clear() {
        clear_handlers();
        assert!(is_empty());

        register_handler("test", Box::new(|_cmd| {
            Box::pin(async move {
                Ok(AsyncResponse {
                    ok: true,
                    value: None,
                    error: None,
                })
            })
        }));

        assert!(!is_empty());
        clear_handlers();
        assert!(is_empty());
    }

    #[test]
    fn test_register_handler_duplicate_detection() {
        clear_handlers();

        assert!(register_handler("dup_test", Box::new(|_cmd| {
            Box::pin(async move {
                Ok(AsyncResponse {
                    ok: true,
                    value: Some(serde_json::json!(1)),
                    error: None,
                })
            })
        })));
        assert!(!register_handler("dup_test", Box::new(|_cmd| {
            Box::pin(async move {
                Ok(AsyncResponse {
                    ok: true,
                    value: Some(serde_json::json!(2)),
                    error: None,
                })
            })
        })));

        let cmd = AsyncCommand { call_id: 1, action: "dup_test".to_string(), params: serde_json::json!({}) };
        let result = block_on(dispatch_command(&cmd));
        assert!(result.unwrap().value == Some(serde_json::json!(2)));

        clear_handlers();
    }

    #[test]
    fn test_host_call_escape_hatch_no_recursion() {
        clear_handlers();

        // Register a host_call handler that just echoes back the action
        register_handler("host_call", Box::new(|cmd| {
            Box::pin(async move {
                let action = cmd.params.get("action")
                    .and_then(|v| v.as_str())
                    .unwrap_or("none");
                Ok(AsyncResponse {
                    ok: true,
                    value: Some(serde_json::json!(action)),
                    error: None,
                })
            })
        }));

        // Dispatch a host_greet command — should hit the escape hatch
        let cmd = AsyncCommand {
            call_id: 1,
            action: "host_greet".to_string(),
            params: serde_json::json!({"name": "Alice"}),
        };

        let result = block_on(dispatch_command(&cmd));
        assert!(result.is_ok());
        let resp = result.unwrap();
        assert!(resp.ok);
        assert_eq!(resp.value, Some(serde_json::json!("greet")));

        clear_handlers();
    }

    #[test]
    fn test_host_call_direct_no_recursion() {
        clear_handlers();

        register_handler("host_call", Box::new(|_cmd| {
            Box::pin(async move {
                Ok(AsyncResponse {
                    ok: true,
                    value: Some(serde_json::json!("direct")),
                    error: None,
                })
            })
        }));

        // Direct host_call should NOT hit the escape hatch
        let cmd = AsyncCommand {
            call_id: 1,
            action: "host_call".to_string(),
            params: serde_json::json!({}),
        };

        let result = block_on(dispatch_command(&cmd));
        assert!(result.is_ok());
        let resp = result.unwrap();
        assert_eq!(resp.value, Some(serde_json::json!("direct")));

        clear_handlers();
    }

    #[test]
    fn test_host_call_non_object_params_errors() {
        clear_handlers();

        register_handler("host_call", Box::new(|_cmd| {
            Box::pin(async move {
                Ok(AsyncResponse {
                    ok: true,
                    value: None,
                    error: None,
                })
            })
        }));

        // Array params should error, not silently drop the action field
        let cmd = AsyncCommand {
            call_id: 1,
            action: "host_greet".to_string(),
            params: serde_json::json!(["alice"]),
        };

        let result = block_on(dispatch_command(&cmd));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("requires object params"), "Expected object-params error, got: {}", err);

        // Scalar params should also error
        let cmd2 = AsyncCommand {
            call_id: 2,
            action: "host_greet".to_string(),
            params: serde_json::json!("alice"),
        };

        let result2 = block_on(dispatch_command(&cmd2));
        assert!(result2.is_err());
        let err2 = result2.unwrap_err();
        assert!(err2.contains("requires object params"), "Expected object-params error, got: {}", err2);

        clear_handlers();
    }

    #[test]
    fn test_web_api_macro_registers_doc_and_handler() {
        use crate::command_params::SleepParams;

        clear_handlers();
        crate::api_docs::REGISTRY.with(|reg| reg.borrow_mut().clear());

        async fn test_sleep_handler(_params: SleepParams) -> AsyncResponse {
            AsyncResponse {
                ok: true,
                value: None,
                error: None,
            }
        }

        crate::web_api! {
            action: "test_sleep",
            namespace: "web",
            name: "sleep",
            doc: "Test sleep API.",
            params: [
                duration: "number", "required", "Duration in ms",
            ],
            returns: "null" => "None",
            param_struct: SleepParams,
            handler: test_sleep_handler,
        }

        // Verify handler is registered
        let cmd = AsyncCommand {
            call_id: 1,
            action: "test_sleep".to_string(),
            params: serde_json::json!({"duration": 100}),
        };
        let result = block_on(dispatch_command(&cmd));
        assert!(result.is_ok());
        assert!(result.unwrap().ok);

        // Verify doc is registered via generate_json
        let json = crate::api_docs::generate_json();
        assert!(json.contains("test_sleep"));
        assert!(json.contains("web.sleep"));
        assert!(json.contains("Async"));

        clear_handlers();
        crate::api_docs::REGISTRY.with(|reg| reg.borrow_mut().clear());
    }

    #[test]
    fn test_web_api_unavailable_macro() {
        clear_handlers();

        crate::web_api_unavailable!("test_unavailable");

        let cmd = AsyncCommand {
            call_id: 1,
            action: "test_unavailable".to_string(),
            params: serde_json::json!({}),
        };

        let result = block_on(dispatch_command(&cmd));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("test_unavailable is not available"));

        clear_handlers();
    }

    #[test]
    fn test_every_handler_has_matching_doc() {
        clear_handlers();
        crate::api_docs::clear_docs();

        async fn h1(_params: crate::command_params::SleepParams) -> AsyncResponse {
            AsyncResponse { ok: true, value: None, error: None }
        }
        async fn h2(_params: crate::command_params::SleepParams) -> AsyncResponse {
            AsyncResponse { ok: true, value: None, error: None }
        }

        crate::web_api! {
            action: "test_action_1",
            namespace: "test",
            name: "action1",
            doc: "Test action 1.",
            params: [duration: "number", "required", "Duration"],
            returns: "null" => "None",
            param_struct: crate::command_params::SleepParams,
            handler: h1,
        }
        crate::web_api! {
            action: "test_action_2",
            namespace: "test",
            name: "action2",
            doc: "Test action 2.",
            params: [duration: "number", "required", "Duration"],
            returns: "null" => "None",
            param_struct: crate::command_params::SleepParams,
            handler: h2,
        }

        let handlers = list_handlers();
        let docs = crate::api_docs::list_docs();
        let doc_actions: Vec<String> = docs.iter().filter_map(|d| d.action.clone()).collect();

        for h in &handlers {
            assert!(
                doc_actions.contains(h),
                "Handler '{}' has no matching doc entry",
                h
            );
        }

        clear_handlers();
        crate::api_docs::clear_docs();
    }

    #[test]
    fn test_every_doc_has_matching_handler() {
        clear_handlers();
        crate::api_docs::clear_docs();

        async fn h1(_params: crate::command_params::SleepParams) -> AsyncResponse {
            AsyncResponse { ok: true, value: None, error: None }
        }

        crate::web_api! {
            action: "test_action_1",
            namespace: "test",
            name: "action1",
            doc: "Test action 1.",
            params: [duration: "number", "required", "Duration"],
            returns: "null" => "None",
            param_struct: crate::command_params::SleepParams,
            handler: h1,
        }

        let handlers = list_handlers();
        let docs = crate::api_docs::list_docs();

        for doc in &docs {
            if let Some(ref action) = doc.action {
                assert!(
                    handlers.contains(action),
                    "Doc action '{}' has no matching handler",
                    action
                );
            }
        }

        clear_handlers();
        crate::api_docs::clear_docs();
    }
}
