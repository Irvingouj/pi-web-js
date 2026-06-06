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

        let setup = session.run_cell(
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

    /// Promise.all with 2 async calls produces 2 pending commands.
    #[test]
    fn test_promise_all_two_commands() {
        let mut session = JsSession::new();

        session.run_cell(
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

        session.run_cell(
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

        session.run_cell(
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

        session.run_cell(
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

        session.run_cell(
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

        session.run_cell(
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

        // Check caught error
        let check = session.run_cell("print(__caught)", "");
        assert_eq!(check.stdout[0], "boom");
    }

    /// String-based action dispatch works (registry path)
    #[test]
    fn test_string_action_dispatch() {
        let mut session = JsSession::new();

        // Define async helper that uses a registered action string
        let setup = session.run_cell(
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
            new Promise((resolve, reject) => {
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
        // The cell should handle the rejection gracefully
        assert!(resumed.error.is_some() || resumed.status == CellStatus::Done);
    }

    /// Unknown action string gets safe error from host
    #[test]
    fn test_unknown_action_string() {
        let mut session = JsSession::new();

        let result = session.run_cell(
            r#"
            new Promise((resolve, reject) => {
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
        assert!(resumed.error.is_some() || resumed.status == CellStatus::Done);
    }

    /// Promise.race resolves when the first promise completes, without waiting for the other.
    #[test]
    fn test_promise_race() {
        let mut session = JsSession::new();

        session.run_cell(
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

        session.run_cell(
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
        let result = session.run_cell("var p = myAsync(99); 'sync_result'", "");
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
        let check = session.run_cell("print(JSON.stringify(await p))", "");
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
        println!("1+1 result: {:?}", result);
        assert!(result.error.is_none());
        // Promise unwrapping extracts the actual value
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
        let result = session.run_cell("await Promise.resolve(2)", "");
        println!("await Promise.resolve(2) result: {:?}", result);
        assert!(result.error.is_none());
        assert_eq!(result.result, Some("2".to_string()));
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

        let setup = session.run_cell(
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
    fn test_chrome_tabs_create_pending() {
        let mut session = JsSession::new();
        let result = session.run_cell(
            "const tab = await chrome.tabs.create({url: \"https://example.com\"})",
            "",
        );
        println!("chrome.tabs.create result: {:?}", result);
        assert_eq!(result.status, CellStatus::AsyncPending);
        assert_eq!(result.pending_commands.len(), 1);
        assert_eq!(result.pending_commands[0].action, "chrome_tabs_create");
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
}
