/// Register an async web API with both documentation and a typed handler.
///
/// This macro performs two atomic operations:
/// 1. Registers API documentation in the doc registry.
/// 2. Registers an async handler in the handler registry.
///
/// The param_struct type is checked at compile time to ensure it implements
/// `serde::de::DeserializeOwned`.
///
/// # Example
/// ```ignore
/// web_api! {
///     action: "page_click",
///     namespace: "page",
///     name: "click",
///     doc: "Clicks an element.",
///     params: [
///         ref_id: "string", "required", "Element refId",
///     ],
///     returns: "boolean" => "Whether the click succeeded",
///     param_struct: PageClickParams,
///     handler: execute_page_click,
/// }
/// ```
#[macro_export]
macro_rules! web_api {
    (
        action: $action:expr,
        namespace: $namespace:expr,
        name: $name:expr,
        doc: $doc:expr,
        params: [$($param_name:ident: $param_type:expr, $required:literal, $param_desc:expr),* $(,)?],
        returns: $ret_type:expr => $ret_desc:expr,
        param_struct: $param_struct:ty,
        handler: $handler:path,
    ) => {
        {
            let __action = $action.to_string();
            let __action_clone = __action.clone();

            // Compile-time check: param_struct must implement DeserializeOwned
            const _: () = {
                const fn check_deserialize<T: serde::de::DeserializeOwned>() {}
                check_deserialize::<$param_struct>();
            };

            // Register API doc
            $crate::api_docs::register($crate::api_docs::JsApiDoc {
                namespace: ($namespace).into(),
                name: ($name).into(),
                action: Some(__action_clone.clone()),
                description: ($doc).into(),
                params: vec![
                    $($crate::api_docs::ParamDoc {
                        name: stringify!($param_name).into(),
                        js_type: ($param_type).into(),
                        required: $required == "required",
                        description: ($param_desc).into(),
                    }),*
                ],
                returns: $crate::api_docs::ReturnDoc {
                    js_type: ($ret_type).into(),
                    description: ($ret_desc).into(),
                },
                public_name: format!("{}.{}", $namespace, $name),
                local_name: None,
                transport: $crate::api_docs::ToolTransport::Async,
                tool_source: $crate::api_docs::ToolSource::RustCore,
                fields: None,
            });

            // Register handler
            $crate::handler_registry::register_handler(
                __action.as_str(),
                Box::new(move |cmd: $crate::AsyncCommand| {
                    let action = __action_clone.clone();
                    Box::pin(async move {
                        let params = cmd.parse_params::<$param_struct>()
                            .map_err(|e| format!("Invalid {} params: {}", action, e))?;
                        let resp = $handler(params).await;
                        Ok(resp)
                    })
                })
            );
        }
    };
    (
        action: $action:expr,
        namespace: $namespace:expr,
        name: $name:expr,
        doc: $doc:expr,
        params: [$($param_name:ident: $param_type:expr, $required:literal, $param_desc:expr),* $(,)?],
        returns: $ret_type:expr => $ret_desc:expr,
        param_struct: $param_struct:ty,
        handler: $handler:path,
        fields: [$($field:expr),* $(,)?],
    ) => {
        {
            let __action = $action.to_string();
            let __action_clone = __action.clone();

            // Compile-time check: param_struct must implement DeserializeOwned
            const _: () = {
                const fn check_deserialize<T: serde::de::DeserializeOwned>() {}
                check_deserialize::<$param_struct>();
            };

            // Register API doc
            $crate::api_docs::register($crate::api_docs::JsApiDoc {
                namespace: ($namespace).into(),
                name: ($name).into(),
                action: Some(__action_clone.clone()),
                description: ($doc).into(),
                params: vec![
                    $($crate::api_docs::ParamDoc {
                        name: stringify!($param_name).into(),
                        js_type: ($param_type).into(),
                        required: $required == "required",
                        description: ($param_desc).into(),
                    }),*
                ],
                returns: $crate::api_docs::ReturnDoc {
                    js_type: ($ret_type).into(),
                    description: ($ret_desc).into(),
                },
                public_name: format!("{}.{}", $namespace, $name),
                local_name: None,
                transport: $crate::api_docs::ToolTransport::Async,
                tool_source: $crate::api_docs::ToolSource::RustCore,
                fields: Some(vec![$($field.to_string()),*]),
            });

            // Register handler
            $crate::handler_registry::register_handler(
                __action.as_str(),
                Box::new(move |cmd: $crate::AsyncCommand| {
                    let action = __action_clone.clone();
                    Box::pin(async move {
                        let params = cmd.parse_params::<$param_struct>()
                            .map_err(|e| format!("Invalid {} params: {}", action, e))?;
                        let resp = $handler(params).await;
                        Ok(resp)
                    })
                })
            );
        }
    };
}

/// Register a sync web API with both documentation and an rquickjs callback.
///
/// This macro performs two atomic operations:
/// 1. Registers API documentation in the doc registry.
/// 2. Registers an rquickjs `Func::new` callback on the global object.
///
/// # Example
/// ```ignore
/// web_api_sync! {
///     ctx: ctx,
///     action: "fetch",
///     namespace: "web",
///     name: "fetch",
///     doc: "Performs an HTTP fetch.",
///     params: [
///         url: "string", "required", "URL to fetch",
///     ],
///     returns: "object" => "Response object",
///     handler: execute_fetch,
/// }
/// ```
#[macro_export]
macro_rules! web_api_sync {
    (
        ctx: $ctx:expr,
        action: $action:expr,
        namespace: $namespace:expr,
        name: $name:expr,
        doc: $doc:expr,
        params: [$($param_name:ident: $param_type:expr, $required:literal, $param_desc:expr),* $(,)?],
        returns: $ret_type:expr => $ret_desc:expr,
        handler: $handler:expr,
    ) => {
        {
            let __action = $action.to_string();
            let __action_clone = __action.clone();

            // Register API doc
            $crate::api_docs::register($crate::api_docs::JsApiDoc {
                namespace: ($namespace).into(),
                name: ($name).into(),
                action: Some(__action_clone),
                description: ($doc).into(),
                params: vec![
                    $($crate::api_docs::ParamDoc {
                        name: stringify!($param_name).into(),
                        js_type: ($param_type).into(),
                        required: $required == "required",
                        description: ($param_desc).into(),
                    }),*
                ],
                returns: $crate::api_docs::ReturnDoc {
                    js_type: ($ret_type).into(),
                    description: ($ret_desc).into(),
                },
                public_name: format!("{}.{}", $namespace, $name),
                local_name: None,
                transport: $crate::api_docs::ToolTransport::Sync,
                tool_source: $crate::api_docs::ToolSource::RustCore,
                fields: None,
            });

            // Register rquickjs callback
            $ctx.globals().set(
                __action,
                rquickjs::function::Func::new($handler),
            )?;
        }
    };
}

/// Register an action that is unavailable in the current context.
///
/// Any dispatch to this action will immediately return an error indicating
/// that the action is not available. Used for extension-only APIs in web context.
///
/// When namespace and name are provided, also registers a doc entry so that
/// JS bindings can be generated from the registry.
///
/// # Example
/// ```ignore
/// web_api_unavailable!("fs_read");
/// web_api_unavailable!("tab_query", "web.tab", "query");
/// ```
#[macro_export]
macro_rules! web_api_unavailable {
    ($action:expr) => {
        {
            let __action = $action.to_string();
            let __action_clone = __action.clone();
            $crate::handler_registry::register_handler(
                &__action,
                Box::new(move |_cmd: $crate::AsyncCommand| {
                    let action = __action_clone.clone();
                    Box::pin(async move {
                        Err($crate::handler_registry::unavailable_error(&action))
                    })
                })
            );
        }
    };
    ($action:expr, $namespace:expr, $name:expr) => {
        {
            let __action = ($action).to_string();
            let __action_for_handler = __action.clone();
            let __action_for_doc = __action.clone();
            let __namespace = ($namespace).to_string();
            let __name = ($name).to_string();
            $crate::handler_registry::register_handler(
                &__action,
                Box::new(move |_cmd: $crate::AsyncCommand| {
                    let action = __action_for_handler.clone();
                    Box::pin(async move {
                        Err($crate::handler_registry::unavailable_error(&action))
                    })
                })
            );
            $crate::api_docs::register($crate::api_docs::JsApiDoc {
                namespace: __namespace.clone(),
                name: __name.clone(),
                action: Some(__action),
                description: format!("{} is not available in this context.", __action_for_doc).into(),
                params: vec![],
                returns: $crate::api_docs::ReturnDoc {
                    js_type: "null".into(),
                    description: "None".into(),
                },
                public_name: format!("{}.{}", __namespace, __name),
                local_name: None,
                transport: $crate::api_docs::ToolTransport::Async,
                tool_source: $crate::api_docs::ToolSource::Extension,
                fields: None,
            });
        }
    };
    ($action:expr, $namespace:expr, $name:expr, fields: [$($field:expr),* $(,)?]) => {
        {
            let __action = ($action).to_string();
            let __action_for_handler = __action.clone();
            let __action_for_doc = __action.clone();
            let __namespace = ($namespace).to_string();
            let __name = ($name).to_string();
            $crate::handler_registry::register_handler(
                &__action,
                Box::new(move |_cmd: $crate::AsyncCommand| {
                    let action = __action_for_handler.clone();
                    Box::pin(async move {
                        Err($crate::handler_registry::unavailable_error(&action))
                    })
                })
            );
            $crate::api_docs::register($crate::api_docs::JsApiDoc {
                namespace: __namespace.clone(),
                name: __name.clone(),
                action: Some(__action),
                description: format!("{} is not available in this context.", __action_for_doc).into(),
                params: vec![],
                returns: $crate::api_docs::ReturnDoc {
                    js_type: "null".into(),
                    description: "None".into(),
                },
                public_name: format!("{}.{}", __namespace, __name),
                local_name: None,
                transport: $crate::api_docs::ToolTransport::Async,
                tool_source: $crate::api_docs::ToolSource::Extension,
                fields: Some(vec![$($field.to_string()),*]),
            });
        }
    };
}

/// Internal helper for batch macro — do not use directly.
#[macro_export]
macro_rules! __web_api_unavailable_one {
    ($action:expr, $namespace:expr, $name:expr) => {
        $crate::web_api_unavailable!($action, $namespace, $name);
    };
    ($action:expr, $namespace:expr, $name:expr, fields: [$($field:expr),* $(,)?]) => {
        $crate::web_api_unavailable!($action, $namespace, $name, fields: [$($field),*]);
    };
}

/// Batch-register multiple unavailable actions.
///
/// # Example
/// ```ignore
/// web_api_unavailable_batch! {
///     ("tab_query", "web.tab", "query"),
///     ("tab_activate", "web.tab", "activate", fields: ["tabId"]),
/// }
/// ```
#[macro_export]
macro_rules! web_api_unavailable_batch {
    ($($entry:tt),* $(,)?) => {
        $(
            $crate::__web_api_unavailable_one!$entry;
        )*
    };
}
