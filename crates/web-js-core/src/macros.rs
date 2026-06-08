/// Register an async web API with both documentation and a typed handler.
///
/// This macro performs two atomic operations:
/// 1. Registers API documentation in the doc registry.
/// 2. Registers an async handler in the handler registry.
///
/// The param_struct type is checked at compile time to ensure it implements
/// `serde::de::DeserializeOwned`.
///
/// NOTE: RustCore APIs registered via this macro currently set `example: None`.
/// To add examples to RustCore APIs, register them manually with `api_docs::register`
/// or extend the macro to accept an `example` field.
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

            let __action_for_entry = __action_clone.clone();
            let __handler = std::rc::Rc::new(move |cmd: $crate::AsyncCommand| {
                let action = __action_clone.clone();
                Box::pin(async move {
                    let params = cmd.parse_params::<$param_struct>()
                        .map_err(|e| format!("Invalid {} params: {}", action, e))?;
                    let resp = $handler(params).await;
                    Ok(resp)
                }) as std::pin::Pin<Box<dyn std::future::Future<Output = Result<$crate::AsyncResponse, String>>>>
            });

            // Register manifest entry with RustCore tool source
            let __entry = $crate::api_docs::ApiManifestEntry {
                namespace: ($namespace).into(),
                name: ($name).into(),
                action: Some(__action_for_entry),
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
                aliases: vec![],
                permission: None,
                example: None,
                prerequisites: None,
                notes: None,
                tags: None,
                related_apis: None,
            };
            $crate::api_docs::register_executable_entry(
                __entry,
                $crate::api_docs::ApiHandler::Rust(__handler),
            ).expect("failed to register executable entry");
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

            let __action_for_entry = __action_clone.clone();
            let __handler = std::rc::Rc::new(move |cmd: $crate::AsyncCommand| {
                let action = __action_clone.clone();
                Box::pin(async move {
                    let params = cmd.parse_params::<$param_struct>()
                        .map_err(|e| format!("Invalid {} params: {}", action, e))?;
                    let resp = $handler(params).await;
                    Ok(resp)
                }) as std::pin::Pin<Box<dyn std::future::Future<Output = Result<$crate::AsyncResponse, String>>>>
            });

            // Register manifest entry with RustCore tool source
            let __entry = $crate::api_docs::ApiManifestEntry {
                namespace: ($namespace).into(),
                name: ($name).into(),
                action: Some(__action_for_entry),
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
                aliases: vec![],
                permission: None,
                example: None,
                prerequisites: None,
                notes: None,
                tags: None,
                related_apis: None,
            };
            $crate::api_docs::register_executable_entry(
                __entry,
                $crate::api_docs::ApiHandler::Rust(__handler),
            ).expect("failed to register executable entry");
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
        aliases: [$($alias_ns:expr => $alias_name:expr),* $(,)?],
    ) => {
        {
            let __action = $action.to_string();
            let __action_clone = __action.clone();

            // Compile-time check: param_struct must implement DeserializeOwned
            const _: () = {
                const fn check_deserialize<T: serde::de::DeserializeOwned>() {}
                check_deserialize::<$param_struct>();
            };

            let __action_for_entry = __action_clone.clone();
            let __handler = std::rc::Rc::new(move |cmd: $crate::AsyncCommand| {
                let action = __action_clone.clone();
                Box::pin(async move {
                    let params = cmd.parse_params::<$param_struct>()
                        .map_err(|e| format!("Invalid {} params: {}", action, e))?;
                    let resp = $handler(params).await;
                    Ok(resp)
                }) as std::pin::Pin<Box<dyn std::future::Future<Output = Result<$crate::AsyncResponse, String>>>>
            });

            // Register manifest entry with RustCore tool source
            let __entry = $crate::api_docs::ApiManifestEntry {
                namespace: ($namespace).into(),
                name: ($name).into(),
                action: Some(__action_for_entry),
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
                aliases: vec![
                    $($crate::api_docs::ApiAlias {
                        namespace: ($alias_ns).into(),
                        name: ($alias_name).into(),
                        fields: None,
                    }),*
                ],
                permission: None,
                example: None,
                prerequisites: None,
                notes: None,
                tags: None,
                related_apis: None,
            };
            $crate::api_docs::register_executable_entry(
                __entry,
                $crate::api_docs::ApiHandler::Rust(__handler),
            ).expect("failed to register executable entry");
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
        aliases: [$($alias_ns:expr => $alias_name:expr),* $(,)?],
    ) => {
        {
            let __action = $action.to_string();
            let __action_clone = __action.clone();

            // Compile-time check: param_struct must implement DeserializeOwned
            const _: () = {
                const fn check_deserialize<T: serde::de::DeserializeOwned>() {}
                check_deserialize::<$param_struct>();
            };

            let __action_for_entry = __action_clone.clone();
            let __handler = std::rc::Rc::new(move |cmd: $crate::AsyncCommand| {
                let action = __action_clone.clone();
                Box::pin(async move {
                    let params = cmd.parse_params::<$param_struct>()
                        .map_err(|e| format!("Invalid {} params: {}", action, e))?;
                    let resp = $handler(params).await;
                    Ok(resp)
                }) as std::pin::Pin<Box<dyn std::future::Future<Output = Result<$crate::AsyncResponse, String>>>>
            });

            let __fields = Some(vec![$($field.to_string()),*]);

            // Register manifest entry with RustCore tool source
            let __entry = $crate::api_docs::ApiManifestEntry {
                namespace: ($namespace).into(),
                name: ($name).into(),
                action: Some(__action_for_entry),
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
                fields: __fields.clone(),
                aliases: vec![
                    $($crate::api_docs::ApiAlias {
                        namespace: ($alias_ns).into(),
                        name: ($alias_name).into(),
                        fields: __fields.clone(),
                    }),*
                ],
                permission: None,
                example: None,
                prerequisites: None,
                notes: None,
                tags: None,
                related_apis: None,
            };
            $crate::api_docs::register_executable_entry(
                __entry,
                $crate::api_docs::ApiHandler::Rust(__handler),
            ).expect("failed to register executable entry");
        }
    };
}
/// Register a sync web API with both documentation and an rquickjs callback.
///
/// This macro performs two atomic operations:
/// 1. Registers API documentation in the doc registry.
/// 2. Registers an rquickjs `Func::new` callback on the global object.
///
/// The optional `local_name` parameter specifies the rquickjs global name
/// for the handler. When omitted, it defaults to the action name. Use it
/// to keep the internal rquickjs function private (e.g. `__webJsSha256`)
/// while exposing a public action name in the manifest.
///
/// # Example
/// ```ignore
/// web_api_sync! {
///     ctx: ctx,
///     action: "crypto_sha256",
///     namespace: "crypto",
///     name: "sha256",
///     doc: "Computes the SHA-256 hash of a message.",
///     params: [
///         message: "string", "required", "Message to hash",
///     ],
///     returns: "string" => "Hex-encoded SHA-256 hash",
///     handler: execute_sha256,
///     local_name: "__webJsSha256",
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
        $crate::web_api_sync! {
            ctx: $ctx,
            action: $action,
            namespace: $namespace,
            name: $name,
            doc: $doc,
            params: [$($param_name: $param_type, $required, $param_desc),*],
            returns: $ret_type => $ret_desc,
            handler: $handler,
            local_name: $action,
        }
    };
    (
        ctx: $ctx:expr,
        action: $action:expr,
        namespace: $namespace:expr,
        name: $name:expr,
        doc: $doc:expr,
        params: [$($param_name:ident: $param_type:expr, $required:literal, $param_desc:expr),* $(,)?],
        returns: $ret_type:expr => $ret_desc:expr,
        handler: $handler:expr,
        local_name: $local_name:expr,
    ) => {
        {
            let __action = $action.to_string();
            let __local_name = $local_name.to_string();

            // Register API doc
            $crate::api_docs::register($crate::api_docs::JsApiDoc {
                namespace: ($namespace).into(),
                name: ($name).into(),
                action: Some(__action),
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
                local_name: Some(__local_name),
                transport: $crate::api_docs::ToolTransport::Sync,
                tool_source: $crate::api_docs::ToolSource::RustCore,
                fields: None,
                aliases: vec![],
                permission: None,
                example: None,
                prerequisites: None,
                notes: None,
                tags: None,
                related_apis: None,
            });

            // Register rquickjs callback with local_name
            $ctx.globals().set(
                $local_name,
                rquickjs::function::Func::new($handler),
            )?;
        }
    };
}
