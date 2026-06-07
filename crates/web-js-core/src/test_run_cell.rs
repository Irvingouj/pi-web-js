#[cfg(test)]
mod tests {
    use crate::types::CellStatus;
    use crate::JsSession;

    #[test]
    fn test_run_cell_print() {
        let mut session = JsSession::new();
        let result = session.run_cell("print(1)", "");
        println!("{:?}", result);
        assert!(result.error.is_none());
    }

    /// Regression: single async call still works with multi-slot bridge.
    #[test]
    fn test_single_async() {
        let mut session = JsSession::new();

        let setup = session.run_cell_unwrapped(
            r#"
            function myAsync(x) {
                return new Promise((resolve, reject) => {
                    __webJsTriggerAsync("test_action", {value: x}, resolve, reject);
                });
            }
        "#,
            "",
        );
        assert!(setup.error.is_none());

        let result = session.run_cell("await myAsync(42)", "");
        assert_eq!(result.status, CellStatus::AsyncPending);
        assert_eq!(result.pending_commands.len(), 1);

        let call_id = result.pending_commands[0].call_id;

        let response = crate::types::AsyncResponse {
            ok: true,
            value: Some(serde_json::json!("result_42")),
            error: None,
        };
        let json = serde_json::to_string(&response).unwrap();
        let resumed = session.resume_cell(call_id, &json);
        assert_eq!(resumed.status, CellStatus::Done);
        assert!(resumed.error.is_none());
    }

    /// Regression: async resume must not eval()-inject payloads (snapshot strings can break JS).
    #[test]
    fn test_resume_async_payload_with_quotes_and_parens() {
        let mut session = JsSession::new();

        let setup = session.run_cell_unwrapped(
            r#"
            function myAsync() {
                return new Promise((resolve, reject) => {
                    __webJsTriggerAsync("tab_snapshot", {tabId: 1}, resolve, reject);
                });
            }
        "#,
            "",
        );
        assert!(setup.error.is_none(), "{:?}", setup.error);

        let result = session.run_cell("await myAsync()", "");
        assert_eq!(result.status, CellStatus::AsyncPending);
        let call_id = result.pending_commands[0].call_id;

        let nasty = r#"URL: https://example.com/
- link "Click me" [ref=1]
"); delete __webJsPending[999]; //"#;
        let response = crate::types::AsyncResponse {
            ok: true,
            value: Some(serde_json::json!(nasty)),
            error: None,
        };
        let json = serde_json::to_string(&response).unwrap();
        let resumed = session.resume_cell(call_id, &json);
        assert_eq!(resumed.status, CellStatus::Done, "{:?}", resumed.error);
        assert!(resumed.error.is_none(), "{:?}", resumed.error);
    }

    /// Async reject surfaces action + code in the error message.
    #[test]
    fn test_resume_async_reject_includes_action_context() {
        let mut session = JsSession::new();

        let setup = session.run_cell_unwrapped(
            r#"
            function myAsync() {
                return new Promise((resolve, reject) => {
                    __webJsTriggerAsync("tab_snapshot", {tabId: 1}, resolve, reject);
                });
            }
        "#,
            "",
        );
        assert!(setup.error.is_none());

        let result = session.run_cell("await myAsync()", "");
        let call_id = result.pending_commands[0].call_id;

        let response = crate::types::AsyncResponse {
            ok: false,
            value: None,
            error: Some(crate::types::AsyncError {
                message: "Cannot execute script in tab 1".into(),
                code: "E_SCRIPTING".into(),
            }),
        };
        let json = serde_json::to_string(&response).unwrap();
        let resumed = session.resume_cell(call_id, &json);
        assert!(resumed.error.is_some());
        let err = resumed.error.unwrap();
        match &err {
            crate::types::CellError::Runtime {
                name,
                message,
                action,
                code,
                ..
            } => {
                assert_eq!(action.as_deref(), Some("tab_snapshot"), "{err:?}");
                assert_eq!(code.as_deref(), Some("E_SCRIPTING"), "{err:?}");
                assert!(message.contains("Cannot execute script"), "{message}");
                assert!(!message.contains("<no message>"), "{message}");
                assert!(!message.contains("<no details available>"), "{message}");
                let display = crate::format_cell_error_text(&err);
                assert!(
                    display.contains("[tab_snapshot] (E_SCRIPTING)"),
                    "{display}"
                );
                assert!(display.contains("Cannot execute script"), "{display}");
                assert!(
                    name.is_none() || name.as_deref() == Some("Error"),
                    "{name:?}"
                );
            }
            other => panic!("expected runtime error, got {other:?}"),
        }
    }

    /// Promise.all with 2 async calls produces 2 pending commands.
    #[test]
    fn test_promise_all_two_commands() {
        let mut session = JsSession::new();

        session.run_cell_unwrapped(
            r#"
            function myAsync(x) {
                return new Promise((resolve, reject) => {
                    __webJsTriggerAsync("test_action", {value: x}, resolve, reject);
                });
            }
        "#,
            "",
        );

        let result = session.run_cell("await Promise.all([myAsync(1), myAsync(2)])", "");
        assert_eq!(result.status, CellStatus::AsyncPending);
        assert_eq!(result.pending_commands.len(), 2);

        let id1 = result.pending_commands[0].call_id;
        let id2 = result.pending_commands[1].call_id;
        assert_ne!(id1, id2);
    }

    /// Resume both Promise.all commands and verify correct results.
    #[test]
    fn test_resume_promise_all() {
        let mut session = JsSession::new();

        session.run_cell_unwrapped(
            r#"
            function myAsync(x) {
                return new Promise((resolve, reject) => {
                    __webJsTriggerAsync("test_action", {value: x}, resolve, reject);
                });
            }
            var __combined;
        "#,
            "",
        );

        let result = session.run_cell(
            "__combined = await Promise.all([myAsync(10), myAsync(20)])",
            "",
        );
        assert_eq!(result.pending_commands.len(), 2);

        let id1 = result.pending_commands[0].call_id;
        let id2 = result.pending_commands[1].call_id;

        // Resume first (still pending after -- Promise.all waits for second)
        let resp1 = crate::types::AsyncResponse {
            ok: true,
            value: Some(serde_json::json!("first")),
            error: None,
        };
        let r1 = session.resume_cell(id1, &serde_json::to_string(&resp1).unwrap());
        assert_eq!(r1.status, CellStatus::AsyncPending);

        // Resume second (Promise.all completes)
        let resp2 = crate::types::AsyncResponse {
            ok: true,
            value: Some(serde_json::json!("second")),
            error: None,
        };
        let r2 = session.resume_cell(id2, &serde_json::to_string(&resp2).unwrap());
        assert_eq!(r2.status, CellStatus::Done);
        assert!(r2.error.is_none());

        // Verify the combined result via print (run_cell wraps result in Promise)
        let check = session.run_cell("print(JSON.stringify(__combined))", "");
        assert!(check.error.is_none());
        assert_eq!(check.stdout[0], r#"["first","second"]"#);
    }

    /// Resume in reverse order -- Promise.all still preserves original order.
    #[test]
    fn test_resume_promise_all_reverse_order() {
        let mut session = JsSession::new();

        session.run_cell_unwrapped(
            r#"
            function myAsync(x) {
                return new Promise((resolve, reject) => {
                    __webJsTriggerAsync("test_action", {value: x}, resolve, reject);
                });
            }
            var __combined;
        "#,
            "",
        );

        let result = session.run_cell(
            "__combined = await Promise.all([myAsync('a'), myAsync('b')])",
            "",
        );
        let id1 = result.pending_commands[0].call_id;
        let id2 = result.pending_commands[1].call_id;

        // Resume second first (reverse order)
        let resp2 = crate::types::AsyncResponse {
            ok: true,
            value: Some(serde_json::json!("B")),
            error: None,
        };
        let r2 = session.resume_cell(id2, &serde_json::to_string(&resp2).unwrap());
        assert_eq!(r2.status, CellStatus::AsyncPending);

        // Then resume first
        let resp1 = crate::types::AsyncResponse {
            ok: true,
            value: Some(serde_json::json!("A")),
            error: None,
        };
        let r1 = session.resume_cell(id1, &serde_json::to_string(&resp1).unwrap());
        assert_eq!(r1.status, CellStatus::Done);

        // Promise.all preserves input order: ["A", "B"] not ["B", "A"]
        let check = session.run_cell("print(JSON.stringify(__combined))", "");
        assert_eq!(check.stdout[0], r#"["A","B"]"#);
    }

    /// Resolving one async triggers a chained async call.
    #[test]
    fn test_chained_async() {
        let mut session = JsSession::new();

        session.run_cell_unwrapped(
            r#"
            function myAsync(x) {
                return new Promise((resolve, reject) => {
                    __webJsTriggerAsync("test_action", {value: x}, resolve, reject);
                });
            }
            var __chained;
        "#,
            "",
        );

        let result = session.run_cell(
            "__chained = await myAsync(1).then(x => myAsync(x + '_chained'))",
            "",
        );
        assert_eq!(result.pending_commands.len(), 1);
        let id1 = result.pending_commands[0].call_id;

        // Resolve first -> .then() triggers second async
        let resp1 = crate::types::AsyncResponse {
            ok: true,
            value: Some(serde_json::json!("hello")),
            error: None,
        };
        let r1 = session.resume_cell(id1, &serde_json::to_string(&resp1).unwrap());
        assert_eq!(r1.status, CellStatus::AsyncPending);
        assert_eq!(r1.pending_commands.len(), 1);

        let id2 = r1.pending_commands[0].call_id;
        // Resolve second
        let resp2 = crate::types::AsyncResponse {
            ok: true,
            value: Some(serde_json::json!("hello_chained_done")),
            error: None,
        };
        let r2 = session.resume_cell(id2, &serde_json::to_string(&resp2).unwrap());
        assert_eq!(r2.status, CellStatus::Done);

        // Final result
        let check = session.run_cell("print(JSON.stringify(__chained))", "");
        assert_eq!(check.stdout[0], r#""hello_chained_done""#);
    }

    /// Two sequential async calls with print between them — stdout accumulates.
    #[test]
    fn test_sequential_async_with_print() {
        let mut session = JsSession::new();

        session.run_cell_unwrapped(
            r#"
            function myAsync(x) {
                return new Promise((resolve, reject) => {
                    __webJsTriggerAsync("test_action", {value: x}, resolve, reject);
                });
            }
        "#,
            "",
        );

        let result = session.run_cell(
            r#"
            await myAsync(1)
            print("after first")
            await myAsync(2)
            print("after second")
        "#,
            "",
        );
        assert_eq!(result.status, CellStatus::AsyncPending);
        assert_eq!(result.pending_commands.len(), 1);
        assert_eq!(result.stdout, Vec::<String>::new());

        let id1 = result.pending_commands[0].call_id;
        let resp1 = crate::types::AsyncResponse {
            ok: true,
            value: Some(serde_json::json!("first_result")),
            error: None,
        };
        let r1 = session.resume_cell(id1, &serde_json::to_string(&resp1).unwrap());
        assert_eq!(r1.status, CellStatus::AsyncPending);
        assert_eq!(r1.pending_commands.len(), 1);
        assert_eq!(r1.stdout, vec!["after first"]);

        let id2 = r1.pending_commands[0].call_id;
        let resp2 = crate::types::AsyncResponse {
            ok: true,
            value: Some(serde_json::json!("second_result")),
            error: None,
        };
        let r2 = session.resume_cell(id2, &serde_json::to_string(&resp2).unwrap());
        assert_eq!(r2.status, CellStatus::Done);
        assert_eq!(r2.stdout, vec!["after first", "after second"]);
    }

    /// Rejection via Promise.all rejects the whole thing.
    #[test]
    fn test_promise_all_reject() {
        let mut session = JsSession::new();

        session.run_cell_unwrapped(
            r#"
            function myAsync(x) {
                return new Promise((resolve, reject) => {
                    __webJsTriggerAsync("test_action", {value: x}, resolve, reject);
                });
            }
            var __caught = null;
        "#,
            "",
        );

        let result = session.run_cell(
            r#"
            try {
                await Promise.all([myAsync(1), myAsync(2)]);
            } catch(e) {
                __caught = e.message;
                __caughtAction = e.action;
                __caughtCode = e.code;
            }
        "#,
            "",
        );
        assert_eq!(result.pending_commands.len(), 2);

        let id1 = result.pending_commands[0].call_id;
        let id2 = result.pending_commands[1].call_id;

        // Reject first
        let resp1 = crate::types::AsyncResponse {
            ok: false,
            value: None,
            error: Some(crate::types::AsyncError {
                message: "boom".into(),
                code: "E_TEST".into(),
            }),
        };
        let _r1 = session.resume_cell(id1, &serde_json::to_string(&resp1).unwrap());
        // After rejection, Promise.all rejects immediately. But second promise still pending in __webJsPending.
        // Resume second too (even though Promise.all already rejected)
        let resp2 = crate::types::AsyncResponse {
            ok: true,
            value: Some(serde_json::json!("ok")),
            error: None,
        };
        let r2 = session.resume_cell(id2, &serde_json::to_string(&resp2).unwrap());
        assert_eq!(r2.status, CellStatus::Done);

        let check = session.run_cell(
            "print(__caught + '|' + __caughtAction + '|' + __caughtCode)",
            "",
        );
        assert_eq!(check.stdout[0], "boom|test_action|E_TEST");
    }

    /// String-based action dispatch works (registry path)
    #[test]
    fn test_string_action_dispatch() {
        let mut session = JsSession::new();

        // Define async helper that uses a registered action string
        let setup = session.run_cell_unwrapped(
            r#"
            function testRegistry(x) {
                return new Promise((resolve, reject) => {
                    __webJsTriggerAsync("mock_async", {value: x}, resolve, reject);
                });
            }
        "#,
            "",
        );
        assert!(setup.error.is_none());

        let result = session.run_cell("await testRegistry(42)", "");
        assert_eq!(result.status, CellStatus::AsyncPending);
        assert_eq!(result.pending_commands.len(), 1);
        // Action is now a plain string, not an enum variant
        assert_eq!(result.pending_commands[0].action, "mock_async");

        // Resume -- mock_async returns null
        let call_id = result.pending_commands[0].call_id;
        let response = crate::types::AsyncResponse {
            ok: true,
            value: Some(serde_json::Value::Null),
            error: None,
        };
        let resumed = session.resume_cell(call_id, &serde_json::to_string(&response).unwrap());
        assert_eq!(resumed.status, CellStatus::Done);
    }

    /// host.call with __proto__ should be blocked at the prelude level
    /// (This tests that dangerous action strings flow through safely)
    #[test]
    fn test_dangerous_action_string_safe() {
        let mut session = JsSession::new();

        // Trigger async with a dangerous-looking action name
        let result = session.run_cell(
            r#"
            await new Promise((resolve, reject) => {
                __webJsTriggerAsync("__proto__", {}, resolve, reject);
            });
        "#,
            "",
        );

        assert_eq!(result.status, CellStatus::AsyncPending);
        assert_eq!(result.pending_commands[0].action, "__proto__");

        // The action string flows through safely -- blocking happens at host.dispatch
        // Resume with error to simulate the host rejecting it
        let call_id = result.pending_commands[0].call_id;
        let response = crate::types::AsyncResponse {
            ok: false,
            value: None,
            error: Some(crate::types::AsyncError {
                message: "Action '__proto__' is not allowed".into(),
                code: "E_BLOCKED_ACTION".into(),
            }),
        };
        let resumed = session.resume_cell(call_id, &serde_json::to_string(&response).unwrap());
        assert!(resumed.error.is_some(), "{:?}", resumed.error);
        match resumed.error.unwrap() {
            crate::types::CellError::Runtime {
                action,
                code,
                message,
                ..
            } => {
                assert_eq!(action.as_deref(), Some("__proto__"));
                assert_eq!(code.as_deref(), Some("E_BLOCKED_ACTION"));
                assert!(message.contains("not allowed"), "{message}");
            }
            other => panic!("expected runtime error, got {other:?}"),
        }
    }

    /// Unknown action string gets safe error from host
    #[test]
    fn test_unknown_action_string() {
        let mut session = JsSession::new();

        let result = session.run_cell(
            r#"
            await new Promise((resolve, reject) => {
                __webJsTriggerAsync("nonexistent_api", {}, resolve, reject);
            });
        "#,
            "",
        );

        assert_eq!(result.status, CellStatus::AsyncPending);
        assert_eq!(result.pending_commands[0].action, "nonexistent_api");

        // Host rejects unknown action
        let call_id = result.pending_commands[0].call_id;
        let response = crate::types::AsyncResponse {
            ok: false,
            value: None,
            error: Some(crate::types::AsyncError {
                message: "Unknown action: nonexistent_api".into(),
                code: "E_UNKNOWN_ACTION".into(),
            }),
        };
        let resumed = session.resume_cell(call_id, &serde_json::to_string(&response).unwrap());
        assert!(resumed.error.is_some(), "{:?}", resumed.error);
        match resumed.error.unwrap() {
            crate::types::CellError::Runtime {
                action,
                code,
                message,
                ..
            } => {
                assert_eq!(action.as_deref(), Some("nonexistent_api"));
                assert_eq!(code.as_deref(), Some("E_UNKNOWN_ACTION"));
                assert!(message.contains("Unknown action"), "{message}");
            }
            other => panic!("expected runtime error, got {other:?}"),
        }
    }

    /// Promise.race resolves when the first promise completes, without waiting for the other.
    #[test]
    fn test_promise_race() {
        let mut session = JsSession::new();

        session.run_cell_unwrapped(
            r#"
            function myAsync(x) {
                return new Promise((resolve, reject) => {
                    __webJsTriggerAsync("test_action", {value: x}, resolve, reject);
                });
            }
            var __raceResult;
        "#,
            "",
        );

        let result = session.run_cell(
            "__raceResult = await Promise.race([myAsync('fast'), myAsync('slow')])",
            "",
        );
        assert_eq!(result.status, CellStatus::AsyncPending);
        assert_eq!(result.pending_commands.len(), 2);

        let id_fast = result.pending_commands[0].call_id;
        let id_slow = result.pending_commands[1].call_id;

        // Resolve only the first ("fast") -- Promise.race should complete immediately
        let resp = crate::types::AsyncResponse {
            ok: true,
            value: Some(serde_json::json!("fast_won")),
            error: None,
        };
        let r1 = session.resume_cell(id_fast, &serde_json::to_string(&resp).unwrap());
        // Promise.race resolves after the first one -- but second promise is still in __webJsPending
        // The cell is still pending because there's still an unresolved promise
        assert_eq!(r1.status, CellStatus::AsyncPending);

        // Resolve the second to clean up
        let resp2 = crate::types::AsyncResponse {
            ok: true,
            value: Some(serde_json::json!("slow_done")),
            error: None,
        };
        let r2 = session.resume_cell(id_slow, &serde_json::to_string(&resp2).unwrap());
        assert_eq!(r2.status, CellStatus::Done);

        // Verify race result is from the fast one
        let check = session.run_cell("print(JSON.stringify(__raceResult))", "");
        assert_eq!(check.stdout[0], r#""fast_won""#);
    }

    /// Non-awaited async calls are still collected as pending commands.
    /// The cell result is the synchronous return value, but pending commands exist.
    #[test]
    fn test_fire_and_forget_pending() {
        let mut session = JsSession::new();

        session.run_cell_unwrapped(
            r#"
            function myAsync(x) {
                return new Promise((resolve, reject) => {
                    __webJsTriggerAsync("test_action", {value: x}, resolve, reject);
                });
            }
        "#,
            "",
        );

        // Start an async call but DON'T await it, return a synchronous value
        let result = session.run_cell("globalThis.p = myAsync(99); 'sync_result'", "");
        // The cell should be AsyncPending because there's a pending async command
        // (even though the eval returned 'sync_result')
        assert_eq!(result.status, CellStatus::AsyncPending);
        assert_eq!(result.pending_commands.len(), 1);
        assert_eq!(result.pending_commands[0].action, "test_action");

        // Resolve the fire-and-forget promise
        let call_id = result.pending_commands[0].call_id;
        let response = crate::types::AsyncResponse {
            ok: true,
            value: Some(serde_json::json!("resolved")),
            error: None,
        };
        let resumed = session.resume_cell(call_id, &serde_json::to_string(&response).unwrap());
        assert_eq!(resumed.status, CellStatus::Done);

        // The promise resolved (p holds a Promise object; verify via await)
        let check = session.run_cell("print(JSON.stringify(await globalThis.p))", "");
        assert_eq!(check.stdout[0], r#""resolved""#);
    }

    #[test]
    fn test_reset_clears_state() {
        let mut session = JsSession::new();
        let result = session.run_cell("x = 10", "");
        assert!(result.error.is_none());
        assert_eq!(result.status, CellStatus::Done);

        // Verify x is set
        let result = session.run_cell("print(x)", "");
        println!("Before reset, print(x) result: {:?}", result);
        assert!(result.error.is_none());
        assert_eq!(result.stdout, vec!["10"]);

        session.reset();

        // x should be undefined after reset
        let result = session.run_cell("print('hello')", "");
        println!("After reset, print('hello') result: {:?}", result);
        assert!(
            result.error.is_none(),
            "print('hello') should work after reset"
        );
        assert_eq!(result.stdout, vec!["hello"]);

        let result = session.run_cell("print(x)", "");
        println!("After reset, print(x) result: {:?}", result);
        assert!(
            result.error.is_some(),
            "Expected error because x is undefined after reset"
        );
    }

    #[test]
    fn test_browser_dom_globals_are_not_injected_into_quickjs() {
        let mut session = JsSession::new();

        let result = session.run_cell("typeof document + ',' + typeof window", "");

        assert!(result.error.is_none());
        assert_eq!(result.result, Some("undefined,undefined".to_string()));

        let result = session.run_cell("document.title", "");
        let error = result
            .error
            .as_ref()
            .expect("direct document access should fail in QuickJS");
        assert!(
            format!("{:?}", error).contains("document"),
            "error should mention document, got {error:?}"
        );
    }

    #[test]
    fn test_promise_value() {
        let mut session = JsSession::new();
        let result = session.run_cell("1 + 1", "");
        assert!(result.error.is_none());
        assert_eq!(result.result, Some("2".to_string()));
    }

    #[test]
    fn test_promise_resolve_then() {
        let mut session = JsSession::new();
        let result = session.run_cell("Promise.resolve(2).then(v => print(v))", "");
        println!("Promise.resolve(2).then result: {:?}", result);
        assert!(result.error.is_none());
        assert_eq!(result.stdout, vec!["2"]);
    }

    #[test]
    fn test_promise_resolve_2() {
        let mut session = JsSession::new();
        let result = session.run_cell("Promise.resolve(2)", "");
        println!("Promise.resolve(2) result: {:?}", result);
        assert!(result.error.is_none());
    }

    #[test]
    fn test_await_promise_resolve() {
        let mut session = JsSession::new();
        let result = session.run_cell("const v = await Promise.resolve(2); print(String(v))", "");
        assert!(result.error.is_none(), "{:?}", result.error);
        assert_eq!(result.stdout, vec!["2"]);
    }

    #[test]
    fn test_await_promise_resolve_with_print() {
        let mut session = JsSession::new();
        let result = session.run_cell(
            "const tab = await Promise.resolve({id: 123}); print('created: ' + typeof tab.id)",
            "",
        );
        println!("await Promise.resolve with print result: {:?}", result);
        assert!(result.error.is_none());
        assert_eq!(result.stdout, vec!["created: number"]);
    }

    #[test]
    fn test_let_redeclaration_on_second_identical_cell_run() {
        let mut session = JsSession::new();
        let code = r#"let result = 1; result"#;
        let first = session.run_cell(code, "");
        assert!(first.error.is_none(), "{:?}", first.error);
        let second = session.run_cell(code, "");
        println!("second identical let cell: {:?}", second);
        assert!(
            second.error.is_none(),
            "second run should not fail on let redeclaration: {:?}",
            second.error
        );
    }

    #[test]
    fn test_page_goto_extract_cell_runs_twice() {
        use crate::api_docs::{
            clear_docs, clear_handlers, generate_js_bindings_code, register, register_handler,
            ApiHandler, JsApiDoc, ReturnDoc, ToolSource, ToolTransport,
        };
        use std::future::Future;
        use std::pin::Pin;
        use std::rc::Rc;

        clear_docs();
        clear_handlers();

        for (name, action, fields) in [
            ("goto", "page_goto", None),
            ("extract", "page_extract", Some(vec!["fields".to_string()])),
        ] {
            register(JsApiDoc {
                namespace: "page".into(),
                name: name.into(),
                action: Some(action.into()),
                description: "test".into(),
                params: vec![],
                returns: ReturnDoc {
                    js_type: "object".into(),
                    description: "ok".into(),
                },
                public_name: format!("page.{name}"),
                local_name: None,
                transport: ToolTransport::Async,
                tool_source: ToolSource::Extension,
                fields: fields.clone(),
                aliases: vec![],
                permission: None,
                example: None,
            });
            let action_name = action.to_string();
            let _ = register_handler(
                action,
                ApiHandler::Rust(Rc::new(move |_cmd| {
                    let action_name = action_name.clone();
                    Box::pin(async move {
                        let value = if action_name == "page_extract" {
                            Some(serde_json::json!({
                                "title": "Example",
                                "url": "https://example.com/"
                            }))
                        } else {
                            None
                        };
                        Ok(crate::types::AsyncResponse {
                            ok: true,
                            value,
                            error: None,
                        })
                    })
                        as Pin<
                            Box<dyn Future<Output = Result<crate::types::AsyncResponse, String>>>,
                        >
                })),
            );
        }

        let mut session = JsSession::new();
        let setup = session.run_cell_unwrapped(&generate_js_bindings_code(), "");
        assert!(setup.error.is_none(), "{:?}", setup.error);

        let code = r#"await page.goto("https://example.com");
let result = await page.extract(["title", "url"]);
console.log(result)"#;

        for run in 1..=2 {
            let mut result = session.run_cell(code, "");
            while result.status == CellStatus::AsyncPending {
                assert!(
                    !result.pending_commands.is_empty(),
                    "run {run} stuck pending without commands"
                );
                let pending = result.pending_commands.clone();
                for cmd in pending {
                    let response = crate::types::AsyncResponse {
                        ok: true,
                        value: if cmd.action == "page_extract" {
                            Some(serde_json::json!({
                                "title": "Example",
                                "url": "https://example.com/"
                            }))
                        } else {
                            None
                        },
                        error: None,
                    };
                    result = session
                        .resume_cell(cmd.call_id, &serde_json::to_string(&response).unwrap());
                }
            }
            assert!(
                result.error.is_none(),
                "run {run} failed: {:?}",
                result.error
            );
            assert!(
                result
                    .stdout
                    .iter()
                    .any(|line| line.contains("example.com")),
                "run {run} stdout missing extract output: {:?}",
                result.stdout
            );
        }

        clear_handlers();
        clear_docs();
    }

    #[test]
    fn test_syntax_error_does_not_poison_next_cell() {
        let mut session = JsSession::new();
        let first = session.run_cell("if (", "");
        println!("first syntax result: {:?}", first);
        assert!(first.error.is_some());

        let second = session.run_cell("1 + 1", "");
        println!("second result: {:?}", second);
        assert!(second.error.is_none());
        assert_eq!(second.result, Some("2".to_string()));
    }

    #[test]
    fn test_async_error_message_escaping_does_not_poison_next_cell() {
        let mut session = JsSession::new();

        let setup = session.run_cell_unwrapped(
            r#"
            function myAsync() {
                return new Promise((resolve, reject) => {
                    __webJsTriggerAsync("test_action", {}, resolve, reject);
                });
            }
        "#,
            "",
        );
        assert!(setup.error.is_none());

        let result = session.run_cell("await myAsync()", "");
        assert_eq!(result.status, CellStatus::AsyncPending);

        let response = crate::types::AsyncResponse {
            ok: false,
            value: None,
            error: Some(crate::types::AsyncError {
                message: "quoted \" newline\n slash \\ separator \u{2028}".to_string(),
                code: "E_TEST".to_string(),
            }),
        };
        let resumed = session.resume_cell(
            result.pending_commands[0].call_id,
            &serde_json::to_string(&response).unwrap(),
        );
        assert!(resumed.error.is_some());

        let next = session.run_cell("1 + 1", "");
        assert!(next.error.is_none());
        assert_eq!(next.result, Some("2".to_string()));
    }

    #[test]
    fn test_chrome_cookies_get_parity_binding_preserves_pending_params() {
        use crate::api_docs::{
            clear_docs, clear_handlers, generate_js_bindings_code, register, register_handler,
            ApiHandler, JsApiDoc, ReturnDoc, ToolSource, ToolTransport,
        };
        use std::future::Future;
        use std::pin::Pin;
        use std::rc::Rc;

        clear_docs();
        clear_handlers();

        register(JsApiDoc {
            namespace: "chrome.cookies".into(),
            name: "get".into(),
            action: Some("chrome_cookies_get".into()),
            description: "Get a cookie.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "object".into(),
                description: "Cookie object.".into(),
            },
            public_name: "chrome.cookies.get".into(),
            local_name: None,
            transport: ToolTransport::Async,
            tool_source: ToolSource::Extension,
            fields: None,
            aliases: vec![],
            permission: None,
            example: None,
        });
        let _ = register_handler(
            "chrome_cookies_get",
            ApiHandler::Rust(Rc::new(|_cmd| {
                Box::pin(async move {
                    Ok(crate::types::AsyncResponse {
                        ok: true,
                        value: None,
                        error: None,
                    })
                })
                    as Pin<Box<dyn Future<Output = Result<crate::types::AsyncResponse, String>>>>
            })),
        );

        let mut session = JsSession::new();
        let bindings = generate_js_bindings_code();
        assert!(
            bindings.contains("parity:true"),
            "chrome_cookies_get binding should use native parity"
        );
        let setup = session.run_cell_unwrapped(&bindings, "");
        assert!(setup.error.is_none(), "{:?}", setup.error);

        let result = session.run_cell(
            r#"await chrome.cookies.get({ url: "https://extension-js.test/fixture", name: "web_js_contract" })"#,
            "",
        );
        assert_eq!(result.status, CellStatus::AsyncPending, "{:?}", result);
        assert_eq!(result.pending_commands.len(), 1);
        assert_eq!(result.pending_commands[0].action, "chrome_cookies_get");
        assert_eq!(
            result.pending_commands[0].params,
            serde_json::json!([{
                "url": "https://extension-js.test/fixture",
                "name": "web_js_contract"
            }]),
            "parity makeAsync binding must preserve cookie details in pending params"
        );

        clear_handlers();
        clear_docs();
    }

    #[test]
    fn test_page_extract_array_positional_binding() {
        use crate::api_docs::{
            clear_docs, clear_handlers, generate_js_bindings_code, register, register_handler,
            ApiHandler, JsApiDoc, ReturnDoc, ToolSource, ToolTransport,
        };
        use std::future::Future;
        use std::pin::Pin;
        use std::rc::Rc;

        clear_docs();
        clear_handlers();

        register(JsApiDoc {
            namespace: "page".into(),
            name: "extract".into(),
            action: Some("page_extract".into()),
            description: "Extract page data.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "object".into(),
                description: "Extracted fields.".into(),
            },
            public_name: "page.extract".into(),
            local_name: None,
            transport: ToolTransport::Async,
            tool_source: ToolSource::Extension,
            fields: Some(vec!["fields".into()]),
            aliases: vec![],
            permission: None,
            example: None,
        });
        let _ = register_handler(
            "page_extract",
            ApiHandler::Rust(Rc::new(|_cmd| {
                Box::pin(async move {
                    Ok(crate::types::AsyncResponse {
                        ok: true,
                        value: None,
                        error: None,
                    })
                })
                    as Pin<Box<dyn Future<Output = Result<crate::types::AsyncResponse, String>>>>
            })),
        );

        let mut session = JsSession::new();
        let setup = session.run_cell_unwrapped(&generate_js_bindings_code(), "");
        assert!(setup.error.is_none(), "{:?}", setup.error);

        let result = session.run_cell(r#"await page.extract(["title", "url"])"#, "");
        assert_eq!(result.status, CellStatus::AsyncPending, "{:?}", result);
        assert_eq!(result.pending_commands.len(), 1);
        assert_eq!(result.pending_commands[0].action, "page_extract");
        assert_eq!(
            result.pending_commands[0].params,
            serde_json::json!({ "fields": ["title", "url"] }),
            "page.extract array positional call must map to fields array"
        );

        let invalid = session.run_cell(r#"await page.extract(["title", 1])"#, "");
        assert!(
            invalid.error.is_some(),
            "mixed-type fields array must reject: {:?}",
            invalid
        );

        clear_handlers();
        clear_docs();
    }

    #[test]
    fn test_parity_async_params_preserve_cookie_details() {
        let mut session = JsSession::new();
        let setup = session.run_cell_unwrapped(
            r#"
            function cookieGet(details) {
                return new Promise((resolve, reject) => {
                    __webJsTriggerAsync("chrome_cookies_get", [details], resolve, reject);
                });
            }
        "#,
            "",
        );
        assert!(setup.error.is_none(), "{:?}", setup.error);

        let result = session.run_cell(
            r#"await cookieGet({ url: "https://extension-js.test/fixture", name: "web_js_contract" })"#,
            "",
        );
        assert_eq!(result.status, CellStatus::AsyncPending, "{:?}", result);
        assert_eq!(result.pending_commands.len(), 1);
        assert_eq!(result.pending_commands[0].action, "chrome_cookies_get");
        assert_eq!(
            result.pending_commands[0].params,
            serde_json::json!([{
                "url": "https://extension-js.test/fixture",
                "name": "web_js_contract"
            }])
        );
    }

    #[test]
    fn test_chrome_tabs_create_pending() {
        use crate::api_docs::{
            register, register_handler, ApiHandler, JsApiDoc, ReturnDoc, ToolSource, ToolTransport,
        };
        use std::future::Future;
        use std::pin::Pin;
        use std::rc::Rc;

        register(JsApiDoc {
            namespace: "chrome.tabs".into(),
            name: "create".into(),
            action: Some("chrome_tabs_create".into()),
            description: "Create a tab.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "object".into(),
                description: "Tab object.".into(),
            },
            public_name: "chrome.tabs.create".into(),
            local_name: None,
            transport: ToolTransport::Async,
            tool_source: ToolSource::Extension,
            fields: None,
            aliases: vec![],
            permission: None,
            example: None,
        });
        let _ = register_handler(
            "chrome_tabs_create",
            ApiHandler::Rust(Rc::new(|_cmd| {
                Box::pin(async move {
                    Ok(crate::types::AsyncResponse {
                        ok: true,
                        value: None,
                        error: None,
                    })
                })
                    as Pin<Box<dyn Future<Output = Result<crate::types::AsyncResponse, String>>>>
            })),
        );

        let mut session = JsSession::new();
        let bindings = crate::api_docs::generate_js_bindings_code();
        let setup = session.run_cell_unwrapped(&bindings, "");
        assert!(setup.error.is_none(), "{:?}", setup.error);
        let result = session.run_cell(
            "const tab = await chrome.tabs.create({url: \"https://example.com\"})",
            "",
        );
        println!("chrome.tabs.create result: {:?}", result);
        assert_eq!(result.status, CellStatus::AsyncPending);
        assert_eq!(result.pending_commands.len(), 1);
        assert_eq!(result.pending_commands[0].action, "chrome_tabs_create");

        crate::api_docs::clear_docs();
        crate::api_docs::clear_handlers();
    }

    #[test]
    fn test_contract_file_loads() {
        let mut session = JsSession::new();
        let contract_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../web/tests/e2e/extension/contract/all-apis-extension-contract.js");
        let contract_code = std::fs::read_to_string(&contract_path)
            .unwrap_or_else(|e| panic!("Failed to read contract file: {}", e));
        let result = session.run_cell(&contract_code, "");
        println!("Contract file load result: {:?}", result);
        println!("Contract file stdout: {:?}", result.stdout);
        println!("Contract file stderr: {:?}", result.stderr);
        println!("Contract file status: {:?}", result.status);
        println!(
            "Contract file pending commands: {:?}",
            result.pending_commands.len()
        );
        assert_eq!(result.status, CellStatus::Done);
        assert!(result.error.is_none());
    }

    #[test]
    fn test_bare_await_sleep_cell_after_wrap() {
        let mut session = JsSession::new();

        let setup = session.run_cell_unwrapped(
            r#"
            function sleepMs(ms) {
                return new Promise((resolve, reject) => {
                    __webJsTriggerAsync("sleep", { duration: ms }, resolve, reject);
                });
            }
            globalThis.web = { sleep: sleepMs };
        "#,
            "",
        );
        assert!(setup.error.is_none(), "{:?}", setup.error);

        let code = "await web.sleep(1)\nprint(\"done\")";
        let result = session.run_cell(code, "");
        assert_eq!(
            result.status,
            CellStatus::AsyncPending,
            "{:?}",
            result.error
        );
        assert_eq!(result.pending_commands.len(), 1);
        assert_eq!(result.pending_commands[0].action, "sleep");

        let call_id = result.pending_commands[0].call_id;
        let response = crate::types::AsyncResponse {
            ok: true,
            value: Some(serde_json::Value::Null),
            error: None,
        };
        let json = serde_json::to_string(&response).unwrap();
        let resumed = session.resume_cell(call_id, &json);
        assert_eq!(resumed.status, CellStatus::Done, "{:?}", resumed.error);
        assert!(resumed.error.is_none(), "{:?}", resumed.error);
        assert!(
            resumed.stdout.iter().any(|line| line.contains("done")),
            "{:?}",
            resumed.stdout
        );
    }

    #[test]
    fn test_const_cell_can_be_rerun_after_isolation_wrap() {
        let mut session = JsSession::new();
        let code = "const x = 1; x";
        let first = session.run_cell(code, "");
        assert!(first.error.is_none(), "{:?}", first.error);
        let second = session.run_cell(code, "");
        assert!(
            second.error.is_none(),
            "wrapped const cells should be re-runnable: {:?}",
            second.error
        );
    }

    #[test]
    fn test_const_redeclare_error_message() {
        let mut session = JsSession::new();
        let first = session.run_cell_unwrapped("const x = 1", "");
        assert!(first.error.is_none(), "{:?}", first.error);

        let second = session.run_cell_unwrapped("const x = 2", "");
        println!("second error: {:?}", second.error);
        assert!(
            second.error.is_some(),
            "Expected error for redeclaring const"
        );
        let err = second.error.unwrap();
        match &err {
            crate::types::CellError::Compile { name, message, .. } => {
                assert_eq!(name.as_deref(), Some("SyntaxError"), "{err:?}");
                assert!(
                    message.contains("redeclaration") || message.contains("already been declared"),
                    "{message}"
                );
            }
            other => panic!("expected compile error, got {other:?}"),
        }
        let msg = crate::format_cell_error_text(&err);
        println!("error message: {}", msg);
        assert!(
            msg.contains("redeclaration") || msg.contains("already been declared"),
            "Expected redeclaration error in: {}",
            msg
        );
        assert!(
            !msg.contains("<no message>"),
            "Message must not contain '<no message>': {}",
            msg
        );
        assert!(
            !msg.ends_with(": )"),
            "Message must not be corrupted: {}",
            msg
        );
    }

    #[test]
    fn test_let_redeclare_global_without_wrap_is_compile_error() {
        let mut session = JsSession::new();
        let first = session.run_cell_unwrapped("let result = 1", "");
        assert!(first.error.is_none(), "{:?}", first.error);

        let second = session.run_cell_unwrapped("let result = 2", "");
        assert!(
            second.error.is_some(),
            "Expected redeclaration error: {:?}",
            second.error
        );
        let err = second.error.unwrap();
        match &err {
            crate::types::CellError::Compile { name, message, .. } => {
                assert_eq!(name.as_deref(), Some("SyntaxError"), "{err:?}");
                assert!(
                    message.contains("redeclaration") || message.contains("already been declared"),
                    "{message}"
                );
            }
            other => panic!("expected compile error, got {other:?}"),
        }
        let display = crate::format_cell_error_text(&err);
        assert!(
            !display.ends_with(": )"),
            "display must not be corrupted: {display}"
        );
    }

    #[test]
    fn test_thrown_syntax_error_is_runtime_not_compile() {
        let mut session = JsSession::new();
        let result = session.run_cell(r#"throw new SyntaxError("bad token")"#, "");
        assert!(result.error.is_some(), "{:?}", result.error);
        match result.error.unwrap() {
            crate::types::CellError::Runtime { name, message, .. } => {
                assert_eq!(name.as_deref(), Some("SyntaxError"));
                assert_eq!(message, "bad token");
            }
            other => panic!("thrown SyntaxError should be runtime, got {other:?}"),
        }
    }

    #[test]
    fn test_syntax_error_classification_parity_eval_and_throw() {
        let mut session = JsSession::new();

        let eval_err = session.run_cell("const +++", "");
        assert!(eval_err.error.is_some(), "{:?}", eval_err.error);
        let thrown = session.run_cell(r#"throw new SyntaxError("bad token")"#, "");
        assert!(thrown.error.is_some(), "{:?}", thrown.error);

        let eval_msg = crate::format_cell_error_text(eval_err.error.as_ref().unwrap());
        let thrown_msg = crate::format_cell_error_text(thrown.error.as_ref().unwrap());
        assert!(eval_msg.contains("SyntaxError"), "{eval_msg}");
        assert!(
            thrown_msg.contains("SyntaxError: bad token"),
            "{thrown_msg}"
        );
        assert!(!eval_msg.ends_with(": )"), "{eval_msg}");
        assert!(!thrown_msg.ends_with(": )"), "{thrown_msg}");
    }

    #[test]
    fn test_fuel_exhausted_interrupt_message() {
        let mut session = JsSession::build().fuel_limit(50).finish();
        let result = session.run_cell("while (true) {}", "");
        assert!(result.error.is_some(), "{:?}", result.error);
        assert!(
            matches!(result.error, Some(crate::types::CellError::FuelExhausted)),
            "{:?}",
            result.error
        );
    }

    #[test]
    fn test_const_assignment_caught_error() {
        let mut session = JsSession::new();
        let result = session.run_cell_unwrapped(
            r#"
            const x = 1;
            var __caught;
            try {
                x = 2;
            } catch(e) {
                __caught = e.message;
            }
            __caught
        "#,
            "",
        );
        println!("caught assignment result: {:?}", result);
        assert!(result.error.is_none(), "{:?}", result.error);
        let msg = result.result.expect("expected caught message");
        assert!(
            !msg.is_empty(),
            "Caught error message must not be empty: {}",
            msg
        );
        assert!(
            msg.contains("constant") || msg.contains("read-only") || msg.contains("immutable"),
            "Expected 'constant' or similar in caught error message: {}",
            msg
        );
    }

    #[test]
    fn test_const_assignment_uncaught_error() {
        let mut session = JsSession::new();
        let result = session.run_cell_unwrapped(
            r#"
            const x = 1;
            x = 2;
        "#,
            "",
        );
        println!("uncaught assignment result: {:?}", result);
        assert!(
            result.error.is_some(),
            "Expected uncaught error for assignment to const"
        );
        let msg = format!("{}", result.error.unwrap());
        assert!(
            msg.contains("read-only") || msg.contains("constant") || msg.contains("immutable"),
            "Expected read-only/constant in: {}",
            msg
        );
    }

    #[test]
    fn test_empty_error_message() {
        let mut session = JsSession::new();
        let result = session.run_cell(r#"throw new Error()"#, "");
        println!("empty error result: {:?}", result);
        assert!(
            result.error.is_some(),
            "Expected error for throw new Error()"
        );
        let err = result.error.unwrap();
        let msg = format!("{}", err);
        println!("empty error: {}", msg);
        assert!(
            !msg.contains("<no message>"),
            "Should not contain '<no message>': {}",
            msg
        );
        assert!(
            !msg.contains("<no details available>"),
            "Should not contain '<no details available>': {}",
            msg
        );
    }

    /// Bare SyntaxError must not be rewritten to `<no details available>`.
    #[test]
    fn test_bare_syntax_error_not_rewritten() {
        let mut session = JsSession::new();
        let result = session.run_cell(r#"throw new SyntaxError()"#, "");
        println!("bare syntax error result: {:?}", result);
        assert!(
            result.error.is_some(),
            "Expected error for throw new SyntaxError()"
        );
        let err = result.error.unwrap();
        let msg = format!("{}", err);
        println!("bare syntax error: {}", msg);
        assert!(
            !msg.contains("<no details available>"),
            "Bare SyntaxError must not be rewritten to '<no details available>': {}",
            msg
        );
        assert!(
            !msg.contains("<no message>"),
            "Message must not contain '<no message>': {}",
            msg
        );
        // Should still mention SyntaxError somewhere
        assert!(
            msg.contains("SyntaxError"),
            "Message should mention SyntaxError: {}",
            msg
        );
    }

    #[test]
    fn test_undefined_error() {
        let mut session = JsSession::new();
        let result = session.run_cell(r#"throw undefined"#, "");
        println!("undefined error result: {:?}", result);
        if let Some(err) = &result.error {
            let msg = format!("{}", err);
            println!("undefined error: {}", msg);
            assert!(
                !msg.contains("<no message>"),
                "Message must not contain '<no message>': {}",
                msg
            );
            assert!(
                !msg.contains("<no details available>"),
                "Message must not contain '<no details available>': {}",
                msg
            );
        } else {
            panic!("Expected error for throw undefined");
        }
    }

    #[test]
    fn test_fuel_exhausted_after_await_on_resume() {
        let mut session = JsSession::build().fuel_limit(200).finish();
        let setup = session.run_cell_unwrapped(
            r#"
            function myAsync() {
                return new Promise((resolve, reject) => {
                    __webJsTriggerAsync("test_action", {}, resolve, reject);
                });
            }
        "#,
            "",
        );
        assert!(setup.error.is_none());
        let result = session.run_cell("await myAsync(); while (true) {}", "");
        assert_eq!(result.status, CellStatus::AsyncPending);
        let call_id = result.pending_commands[0].call_id;
        let response = crate::types::AsyncResponse {
            ok: true,
            value: Some(serde_json::json!(null)),
            error: None,
        };
        let resumed = session.resume_cell(call_id, &serde_json::to_string(&response).unwrap());
        assert!(
            matches!(resumed.error, Some(crate::types::CellError::FuelExhausted)),
            "{:?}",
            resumed.error
        );
        assert!(resumed.fuel_exhausted);
    }

    #[test]
    fn test_eval_syntax_error_is_compile_kind() {
        let mut session = JsSession::new();
        let result = session.run_cell("const +++", "");
        assert!(result.error.is_some(), "{:?}", result.error);
        assert!(
            matches!(result.error, Some(crate::types::CellError::Compile { .. })),
            "{:?}",
            result.error
        );
    }

    #[test]
    fn test_invalid_resume_json_is_internal() {
        let mut session = JsSession::new();
        let result = session.resume_cell(999, "not-json");
        assert!(
            matches!(result.error, Some(crate::types::CellError::Internal { .. })),
            "{:?}",
            result.error
        );
    }
}
