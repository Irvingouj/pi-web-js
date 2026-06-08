use rquickjs::{Ctx, Function, Object, String as JsString, Value};

fn append_agent_guidance(message: &str, error: &crate::types::AsyncError) -> String {
    let mut out = message.to_string();
    if let Some(hint) = &error.hint {
        out.push_str("\n\nHint: ");
        out.push_str(hint);
    }
    if let Some(steps) = &error.recovery {
        if !steps.is_empty() {
            out.push_str("\n\nRecovery:");
            for (idx, step) in steps.iter().enumerate() {
                out.push_str(&format!("\n  {}. {}", idx + 1, step));
            }
        }
    }
    out
}

/// Resolve or reject a pending async call without embedding payloads in eval().
pub(crate) fn resume_async_pending<'js>(
    ctx: &Ctx<'js>,
    call_id: u32,
    response: &crate::types::AsyncResponse,
) -> rquickjs::Result<()> {
    use rquickjs::Error;

    let pending: Object = ctx.globals().get("__webJsPending")?;
    let key = call_id.to_string();
    let entry: Object = pending.get(key.as_str()).map_err(|_| {
        Error::new_from_js_message(
            "resume",
            "pending",
            format!("no pending async entry for call_id {}", call_id),
        )
    })?;

    let action = entry
        .get::<_, JsString>("action")
        .ok()
        .and_then(|s| s.to_string().ok())
        .unwrap_or_else(|| "unknown".to_string());

    let resolve: Function = entry.get("resolve")?;
    let reject: Function = entry.get("reject")?;

    let resume_result = if response.ok {
        let value_json =
            serde_json::to_string(response.value.as_ref().unwrap_or(&serde_json::Value::Null))
                .map_err(|e| {
                    rquickjs::Error::new_from_js_message("json", "stringify", e.to_string())
                })?;
        let js_value = ctx.json_parse(value_json)?;
        tracing::trace!(call_id, action = %action, "async_pending_resolved");
        resolve.call::<_, ()>((js_value,))
    } else {
        let err = response.error.as_ref();
        let (code, message) = err
            .map(|e| (e.code.as_str(), e.message.as_str()))
            .unwrap_or(("E_UNKNOWN", "unknown async error"));
        let display_message = err
            .map(|e| append_agent_guidance(message, e))
            .unwrap_or_else(|| message.to_string());
        tracing::error!(call_id, action = %action, code = %code, message = %message, "async_pending_rejected");
        let msg_json = serde_json::to_string(&display_message).map_err(|e| {
            rquickjs::Error::new_from_js_message("json", "stringify", e.to_string())
        })?;
        let action_json = serde_json::to_string(&action).map_err(|e| {
            rquickjs::Error::new_from_js_message("json", "stringify", e.to_string())
        })?;
        let code_json = serde_json::to_string(code).map_err(|e| {
            rquickjs::Error::new_from_js_message("json", "stringify", e.to_string())
        })?;
        let hint_json = serde_json::to_string(err.and_then(|e| e.hint.as_deref()).unwrap_or(""))
            .map_err(|e| rquickjs::Error::new_from_js_message("json", "stringify", e.to_string()))?;
        let recovery_json = serde_json::to_string(
            err.and_then(|e| e.recovery.as_ref()).unwrap_or(&Vec::new()),
        )
        .map_err(|e| rquickjs::Error::new_from_js_message("json", "stringify", e.to_string()))?;
        let category_json = serde_json::to_string(
            err.and_then(|e| e.category.as_deref()).unwrap_or(""),
        )
        .map_err(|e| rquickjs::Error::new_from_js_message("json", "stringify", e.to_string()))?;
        let details_json = serde_json::to_string(
            err.and_then(|e| e.details.as_ref())
                .unwrap_or(&serde_json::Value::Null),
        )
        .map_err(|e| rquickjs::Error::new_from_js_message("json", "stringify", e.to_string()))?;
        let error_obj = ctx.eval::<Value, _>(format!(
            "(function() {{ var e = new Error({msg_json}); e.action = {action_json}; e.code = {code_json}; e.hint = {hint_json}; e.recovery = {recovery_json}; var cat = {category_json}; if (cat) e.category = cat; var det = {details_json}; if (det !== null) e.details = det; return e; }})()"
        ))?;
        reject.call::<_, ()>((error_obj,))
    };

    resume_result?;

    ctx.eval::<(), _>(format!(
        "Reflect.deleteProperty(__webJsPending, '{}');",
        call_id
    ))?;

    Ok(())
}
