use crate::js_value::{format_js_value, js_value_to_json};
use crate::state::HostState;
use rquickjs::{
    function::{Func, Rest},
    Ctx, Object, Value,
};
use std::cell::RefCell;
use std::rc::Rc;

pub(crate) fn register_host_globals<'js>(
    ctx: Ctx<'js>,
    host_state: Rc<RefCell<HostState>>,
    allow_user_eval: bool,
) -> rquickjs::Result<()> {
    let hs = host_state.clone();
    ctx.globals().set(
        "print",
        Func::new(
            move |_ctx: Ctx<'js>, args: Rest<Value<'js>>| -> rquickjs::Result<()> {
                let parts: Vec<String> = args.0.iter().map(|v| format_js_value(v)).collect();
                let line = parts.join(" ");
                hs.borrow_mut().stdout.push(line.clone());
                #[cfg(target_arch = "wasm32")]
                web_sys::console::log_1(&wasm_bindgen::JsValue::from_str(&line));
                #[cfg(not(target_arch = "wasm32"))]
                println!("{}", line);
                Ok(())
            },
        ),
    )?;

    let hs = host_state.clone();
    ctx.globals().set(
        "__webJsStderr",
        Func::new(
            move |_ctx: Ctx<'js>, args: Rest<Value<'js>>| -> rquickjs::Result<()> {
                let parts: Vec<String> = args.0.iter().map(|v| format_js_value(v)).collect();
                let line = parts.join(" ");
                hs.borrow_mut().stderr.push(line);
                Ok(())
            },
        ),
    )?;

    let hs = host_state.clone();
    ctx.globals().set(
        "input",
        Func::new(
            move |_ctx: Ctx<'js>, _args: Rest<Value<'js>>| -> rquickjs::Result<String> {
                let hs = hs.borrow();
                let full_stdin = hs.stdin_lines.join("\n");
                Ok(full_stdin)
            },
        ),
    )?;

    let hs = host_state.clone();
    ctx.globals().set(
        "read",
        Func::new(
            move |_ctx: Ctx<'js>, _args: Rest<Value<'js>>| -> rquickjs::Result<Value<'js>> {
                let mut hs = hs.borrow_mut();
                if hs.stdin_cursor < hs.stdin_lines.len() {
                    let line = hs.stdin_lines[hs.stdin_cursor].clone();
                    hs.stdin_cursor += 1;
                    Ok(rquickjs::String::from_str(_ctx.clone(), line.as_str())?.into_value())
                } else {
                    Ok(rquickjs::Null.into_value(_ctx.clone()))
                }
            },
        ),
    )?;

    let hs = host_state.clone();
    ctx.globals().set(
        "emit",
        Func::new(
            move |_ctx: Ctx<'js>, args: Rest<Value<'js>>| -> rquickjs::Result<()> {
                if !args.0.is_empty() {
                    let formatted = format_js_value(&args.0[0]);
                    let cmd = serde_json::json!({
                        "action": "emit",
                        "args": { "value": formatted }
                    });
                    hs.borrow_mut().commands.push(cmd);
                }
                Ok(())
            },
        ),
    )?;

    let hs = host_state.clone();
    ctx.globals().set(
        "__webJsTriggerAsync",
        Func::new(
            move |ctx: Ctx<'js>, args: Rest<Value<'js>>| -> rquickjs::Result<()> {
                let action_str = args
                    .0
                    .first()
                    .and_then(|v| v.as_string())
                    .and_then(|s| s.to_string().ok())
                    .unwrap_or_default();
                let params = args
                    .0
                    .get(1)
                    .map(|v| js_value_to_json(ctx.clone(), v).unwrap_or(serde_json::Value::Null))
                    .unwrap_or(serde_json::Value::Null);
                let resolve = args
                    .0
                    .get(2)
                    .cloned()
                    .unwrap_or_else(|| Value::new_undefined(ctx.clone()));
                let reject = args
                    .0
                    .get(3)
                    .cloned()
                    .unwrap_or_else(|| Value::new_undefined(ctx.clone()));
                let stack = args
                    .0
                    .get(4)
                    .and_then(|v| v.as_string())
                    .and_then(|s| s.to_string().ok())
                    .or_else(|| {
                        ctx.eval::<rquickjs::String, _>("(new Error()).stack")
                            .ok()
                            .and_then(|s| s.to_string().ok())
                    });

                let mut hs = hs.borrow_mut();
                hs.async_call_counter += 1;
                let call_id = hs.async_call_counter;
                tracing::trace!(call_id, action = %action_str, "trigger_async");

                let command = crate::types::AsyncCommand {
                    call_id,
                    action: action_str.clone(),
                    params,
                    run_id: None,
                    source_stack: stack.clone(),
                };
                hs.pending_async_commands.push(command);

                // Store resolve/reject in global __webJsPending[call_id]
                let pending = ctx.globals().get::<_, Object>("__webJsPending")?;
                let entry = Object::new(ctx.clone())?;
                entry.set("resolve", resolve)?;
                entry.set("reject", reject)?;
                entry.set("action", action_str)?;
                if let Some(stack) = stack {
                    entry.set("stack", stack)?;
                }
                pending.set(call_id.to_string(), entry)?;

                Ok(())
            },
        ),
    )?;

    if allow_user_eval {
        ctx.globals().set(
            "eval",
            Func::new(
                move |ctx: Ctx<'js>, args: Rest<Value<'js>>| -> rquickjs::Result<Value<'js>> {
                    let source = args
                        .0
                        .first()
                        .and_then(|v| v.as_string())
                        .and_then(|s| s.to_string().ok())
                        .unwrap_or_default();
                    let mut eval_opts = rquickjs::context::EvalOptions::default();
                    eval_opts.global = true;
                    eval_opts.strict = false;
                    ctx.eval_with_options::<Value, _>(source, eval_opts)
                },
            ),
        )?;
    } else {
        ctx.globals().set(
            "eval",
            Func::new(
                move |_ctx: Ctx<'js>, _args: Rest<Value<'js>>| -> rquickjs::Result<Value<'js>> {
                    Err(rquickjs::Error::new_from_js("eval", "disabled"))
                },
            ),
        )?;
    }

    // Build console object directly from Rust to avoid JS-eval issues in WASM.
    let console = Object::new(ctx.clone())?;
    let print_fn = ctx.globals().get::<_, Value>("print")?;
    let stderr_fn = ctx.globals().get::<_, Value>("__webJsStderr")?;
    console.set("log", print_fn.clone())?;
    console.set("error", stderr_fn.clone())?;
    console.set("warn", stderr_fn.clone())?;
    ctx.globals().set("console", console)?;

    ctx.globals()
        .set("__webJsPending", Object::new(ctx.clone())?)?;
    ctx.globals()
        .set("__webJsCellResult$", Value::new_undefined(ctx.clone()))?;
    ctx.globals()
        .set("__webJsCellError$", Value::new_undefined(ctx.clone()))?;
    ctx.globals().set("__webJsExecutionCount$", 0)?;

    // Override Error constructor to avoid WASM crash in build_backtrace.
    // QuickJS's backtrace capture is incompatible with wasm32's stack layout.
    // ctx.eval::<Value, _>(r#"
    // (function() {
    //     const origProto = Error.prototype;
    //     const origName = Error.name;
    //     Error = function(message) {
    //         return undefined;
    //     };
    //     Error.prototype = origProto;
    // })();
    // "#)?;

    // NOTE: Error override removed to debug ReferenceError issues.
    // QuickJS's backtrace capture is incompatible with wasm32's stack layout.
    // We need a safer approach that doesn't break ReferenceError.
    // ctx.eval::<Value, _>(r#"
    // Error = function(message) { return undefined; };
    // "#)?;

    // Timer support: bridge setTimeout/setInterval to the host "sleep" action.
    // The WASM sandbox has no real event loop, so these are absent from globalThis;
    // without them, agent cells using `await new Promise(r => setTimeout(r, N))`
    // throw an opaque empty-message TypeError. Each timer schedules a "sleep"
    // async command; when the host resumes it, the stored callback fires.
    let hs = host_state.clone();
    ctx.globals().set(
        "setTimeout",
        Func::new(
            move |ctx: Ctx<'js>, args: Rest<Value<'js>>| -> rquickjs::Result<u32> {
                let cb = args
                    .0
                    .first()
                    .cloned()
                    .unwrap_or_else(|| Value::new_undefined(ctx.clone()));
                if cb.is_undefined() || cb.as_function().is_none() {
                    return Err(rquickjs::Error::new_from_js_message(
                        "setTimeout",
                        "callback",
                        "first argument must be a function",
                    ));
                }
                let ms = args
                    .0
                    .get(1)
                    .and_then(|v| v.as_float())
                    .unwrap_or(0.0)
                    .max(0.0);

                let mut hs = hs.borrow_mut();
                hs.async_call_counter += 1;
                let call_id = hs.async_call_counter;
                let command = crate::types::AsyncCommand {
                    call_id,
                    action: "sleep".to_string(),
                    params: serde_json::json!({ "duration": ms }),
                    run_id: None,
                    source_stack: None,
                };
                hs.pending_async_commands.push(command);

                // Store the callback (wrapped to ignore the resume value) in __webJsPending.
                let pending = ctx.globals().get::<_, Object>("__webJsPending")?;
                let entry = Object::new(ctx.clone())?;
                // Wrap: the resolve receives the sleep result (null); call cb ignoring it.
                let factory = ctx.eval::<rquickjs::function::Function<'js>, _>(
                    "(function(cb) { return function() { cb(); }; })",
                )?;
                let bound = factory.call::<_, Value>((cb,))?;
                entry.set("resolve", bound)?;
                let noop = ctx.eval::<rquickjs::function::Function<'js>, _>("(function() {})")?;
                entry.set("reject", noop)?;
                entry.set("action", "sleep")?;
                pending.set(call_id.to_string(), entry)?;

                Ok(call_id)
            },
        ),
    )?;

    let hs = host_state.clone();
    ctx.globals().set(
        "clearTimeout",
        Func::new(
            move |ctx: Ctx<'js>, args: Rest<Value<'js>>| -> rquickjs::Result<()> {
                if let Some(id_val) = args.0.first() {
                    if let Some(id) = id_val.as_int() {
                        let pending = ctx.globals().get::<_, Object>("__webJsPending")?;
                        let id_str = id.to_string();
                        if pending
                            .get::<_, Value>(id_str.as_str())
                            .map(|v| !v.is_undefined())
                            .unwrap_or(false)
                        {
                            let _ = pending.remove(id_str.as_str());
                        }
                        hs.borrow_mut()
                            .pending_async_commands
                            .retain(|c| c.call_id != id as u32);
                    }
                }
                Ok(())
            },
        ),
    )?;

    let hs = host_state.clone();
    ctx.globals().set(
        "setInterval",
        Func::new(
            move |ctx: Ctx<'js>, args: Rest<Value<'js>>| -> rquickjs::Result<u32> {
                let cb = args.0.first().cloned().unwrap_or_else(|| Value::new_undefined(ctx.clone()));
                if cb.is_undefined() || cb.as_function().is_none() {
                    return Err(rquickjs::Error::new_from_js_message(
                        "setInterval",
                        "callback",
                        "first argument must be a function",
                    ));
                }
                let ms = args.0.get(1).and_then(|v| v.as_float()).unwrap_or(0.0).max(0.0);
                let duration_json = serde_json::json!({ "duration": ms });

                let mut hs = hs.borrow_mut();
                hs.async_call_counter += 1;
                let call_id = hs.async_call_counter;
                let command = crate::types::AsyncCommand {
                    call_id,
                    action: "sleep".to_string(),
                    params: duration_json.clone(),
                    run_id: None,
                    source_stack: None,
                };
                hs.pending_async_commands.push(command);

                // Self-rescheduling wrapper: after calling cb, schedule a new sleep.
                let pending = ctx.globals().get::<_, Object>("__webJsPending")?;
                let entry = Object::new(ctx.clone())?;
                let duration_lit = serde_json::to_string(&serde_json::json!({ "duration": ms }))
                    .unwrap_or_else(|_| "{\"duration\":0}".to_string());
                let wrapper = ctx.eval::<rquickjs::function::Function<'js>, _>(format!(
                    r#"(function(cb) {{
                        return function() {{
                            cb();
                            try {{ __webJsTriggerAsync("sleep", {duration}, arguments.callee, function(){{}}); }} catch(e) {{}}
                        }};
                    }})"#,
                    duration = duration_lit
                ))?;
                let bound = wrapper.call::<_, Value>((cb,))?;
                entry.set("resolve", bound)?;
                let noop = ctx.eval::<rquickjs::function::Function<'js>, _>(
                    "(function() {})",
                )?;
                entry.set("reject", noop)?;
                entry.set("action", "sleep")?;
                pending.set(call_id.to_string(), entry)?;

                Ok(call_id)
            },
        ),
    )?;

    let hs = host_state.clone();
    ctx.globals().set(
        "clearInterval",
        Func::new(
            move |ctx: Ctx<'js>, args: Rest<Value<'js>>| -> rquickjs::Result<()> {
                if let Some(id_val) = args.0.first() {
                    if let Some(id) = id_val.as_int() {
                        let pending = ctx.globals().get::<_, Object>("__webJsPending")?;
                        let id_str = id.to_string();
                        if pending
                            .get::<_, Value>(id_str.as_str())
                            .map(|v| !v.is_undefined())
                            .unwrap_or(false)
                        {
                            let _ = pending.remove(id_str.as_str());
                        }
                        hs.borrow_mut()
                            .pending_async_commands
                            .retain(|c| c.call_id != id as u32);
                    }
                }
                Ok(())
            },
        ),
    )?;
    Ok(())
}
