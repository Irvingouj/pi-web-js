use crate::state::HostState;
use crate::utils::{format_js_value, js_value_to_json};
use rquickjs::{
    function::{Func, Rest},
    Ctx, Object, Value,
};
use std::cell::RefCell;
use std::rc::Rc;

pub(crate) fn register_host_globals<'js>(
    ctx: Ctx<'js>,
    host_state: Rc<RefCell<HostState>>,
) -> rquickjs::Result<()> {
    let hs = host_state.clone();
    ctx.globals().set(
        "print",
        Func::new(
            move |_ctx: Ctx<'js>, args: Rest<Value<'js>>| -> rquickjs::Result<()> {
                let parts: Vec<String> = args.0.iter().map(|v| format_js_value(v)).collect();
                let line = parts.join(" ");
                hs.borrow_mut().stdout.push(line.clone());
                web_sys::console::log_1(&wasm_bindgen::JsValue::from_str(&line));
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
                    .0.first()
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

                let mut hs = hs.borrow_mut();
                hs.async_call_counter += 1;
                let call_id = hs.async_call_counter;

                let command = crate::types::AsyncCommand {
                    call_id,
                    action: action_str,
                    params,
                };
                hs.pending_async_commands.push(command);

                // Store resolve/reject in global __webJsPending[call_id]
                let pending = ctx.globals().get::<_, Object>("__webJsPending")?;
                let entry = Object::new(ctx.clone())?;
                entry.set("resolve", resolve)?;
                entry.set("reject", reject)?;
                pending.set(call_id.to_string(), entry)?;

                Ok(())
            },
        ),
    )?;

    // Disable eval for security.
    ctx.globals().set(
        "eval",
        Func::new(
            move |_ctx: Ctx<'js>, _args: Rest<Value<'js>>| -> rquickjs::Result<Value<'js>> {
                Err(rquickjs::Error::new_from_js("eval", "disabled"))
            },
        ),
    )?;

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

    Ok(())
}
