use web_js_core::types::{AsyncError, AsyncResponse};
use web_js_core::command_params::*;

// ─── fs.* helpers ───────────────────────────────────────────────

fn fs_err_to_async(err: web_fs::FsError) -> AsyncError {
    AsyncError {
        message: err.wire_message(),
        code: err.wire_code().into(),
    }
}

pub async fn execute_fs_exists(
    params: FsPathParams,
) -> AsyncResponse {
    let exists = web_fs::exists(&params.path).await;
    AsyncResponse {
        ok: true,
        value: Some(serde_json::Value::Bool(exists)),
        error: None,
    }
}

pub async fn execute_fs_stat(
    params: FsPathParams,
) -> AsyncResponse {
    match web_fs::stat(&params.path).await {
        Ok(meta) => match serde_json::to_value(&meta) {
            Ok(v) => AsyncResponse {
                ok: true,
                value: Some(v),
                error: None,
            },
            Err(e) => AsyncResponse {
                ok: false,
                value: None,
                error: Some(AsyncError {
                    message: format!("Failed to serialize metadata: {}", e),
                    code: "E_IO".into(),
                }),
            },
        },
        Err(e) => AsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_async(e)),
        },
    }
}

pub async fn execute_fs_list(
    params: FsPathParams,
) -> AsyncResponse {
    match web_fs::list(&params.path).await {
        Ok(entries) => match serde_json::to_value(&entries) {
            Ok(v) => AsyncResponse {
                ok: true,
                value: Some(v),
                error: None,
            },
            Err(e) => AsyncResponse {
                ok: false,
                value: None,
                error: Some(AsyncError {
                    message: format!("Failed to serialize entries: {}", e),
                    code: "E_IO".into(),
                }),
            },
        },
        Err(e) => AsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_async(e)),
        },
    }
}

pub async fn execute_fs_mkdir(
    params: FsPathParams,
) -> AsyncResponse {
    match web_fs::mkdir(&params.path).await {
        Ok(_) => AsyncResponse {
            ok: true,
            value: Some(serde_json::Value::Bool(true)),
            error: None,
        },
        Err(e) => AsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_async(e)),
        },
    }
}

pub async fn execute_fs_delete(
    params: FsPathParams,
) -> AsyncResponse {
    match web_fs::delete(&params.path).await {
        Ok(_) => AsyncResponse {
            ok: true,
            value: Some(serde_json::Value::Bool(true)),
            error: None,
        },
        Err(e) => AsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_async(e)),
        },
    }
}

pub async fn execute_fs_copy(
    params: FsCopyParams,
) -> AsyncResponse {
    match web_fs::copy(&params.from, &params.to).await {
        Ok(_) => AsyncResponse {
            ok: true,
            value: Some(serde_json::Value::Bool(true)),
            error: None,
        },
        Err(e) => AsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_async(e)),
        },
    }
}

pub async fn execute_fs_move(
    params: FsCopyParams,
) -> AsyncResponse {
    match web_fs::rename(&params.from, &params.to).await {
        Ok(_) => AsyncResponse {
            ok: true,
            value: Some(serde_json::Value::Bool(true)),
            error: None,
        },
        Err(e) => AsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_async(e)),
        },
    }
}

pub async fn execute_fs_read(
    params: FsPathParams,
) -> AsyncResponse {
    match web_fs::read(&params.path).await {
        Ok(bytes) => AsyncResponse {
            ok: true,
            value: Some(serde_json::Value::String(
                data_encoding::BASE64.encode(&bytes),
            )),
            error: None,
        },
        Err(e) => AsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_async(e)),
        },
    }
}

pub async fn execute_fs_read_text(
    params: FsPathParams,
) -> AsyncResponse {
    match web_fs::read_text(&params.path).await {
        Ok(text) => AsyncResponse {
            ok: true,
            value: Some(serde_json::Value::String(text)),
            error: None,
        },
        Err(e) => AsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_async(e)),
        },
    }
}

pub async fn execute_fs_read_base64(
    params: FsPathParams,
) -> AsyncResponse {
    match web_fs::read_base64(&params.path).await {
        Ok(b64) => AsyncResponse {
            ok: true,
            value: Some(serde_json::Value::String(b64)),
            error: None,
        },
        Err(e) => AsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_async(e)),
        },
    }
}

pub async fn execute_fs_read_range(
    params: FsReadRangeParams,
) -> AsyncResponse {
    match web_fs::read_range(&params.path, params.offset, params.len).await {
        Ok(bytes) => AsyncResponse {
            ok: true,
            value: Some(serde_json::Value::String(
                data_encoding::BASE64.encode(&bytes),
            )),
            error: None,
        },
        Err(e) => AsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_async(e)),
        },
    }
}

pub async fn execute_fs_write(
    params: FsWriteParams,
) -> AsyncResponse {
    let bytes = match data_encoding::BASE64.decode(params.data.as_bytes()) {
        Ok(b) => b,
        Err(_) => {
            return AsyncResponse {
                ok: false,
                value: None,
                error: Some(AsyncError {
                    message: "Invalid base64 data".into(),
                    code: "E_INVALID_ENCODING".into(),
                }),
            };
        }
    };
    match web_fs::write(&params.path, &bytes).await {
        Ok(_) => AsyncResponse {
            ok: true,
            value: Some(serde_json::Value::Bool(true)),
            error: None,
        },
        Err(e) => AsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_async(e)),
        },
    }
}

pub async fn execute_fs_write_text(
    params: FsWriteParams,
) -> AsyncResponse {
    match web_fs::write_text(&params.path, &params.data).await {
        Ok(_) => AsyncResponse {
            ok: true,
            value: Some(serde_json::Value::Bool(true)),
            error: None,
        },
        Err(e) => AsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_async(e)),
        },
    }
}

pub async fn execute_fs_write_base64(
    params: FsWriteParams,
) -> AsyncResponse {
    match web_fs::write_base64(&params.path, &params.data).await {
        Ok(_) => AsyncResponse {
            ok: true,
            value: Some(serde_json::Value::Bool(true)),
            error: None,
        },
        Err(e) => AsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_async(e)),
        },
    }
}

pub async fn execute_fs_append(
    params: FsWriteParams,
) -> AsyncResponse {
    let bytes = match data_encoding::BASE64.decode(params.data.as_bytes()) {
        Ok(b) => b,
        Err(_) => {
            return AsyncResponse {
                ok: false,
                value: None,
                error: Some(AsyncError {
                    message: "Invalid base64 data".into(),
                    code: "E_INVALID_ENCODING".into(),
                }),
            };
        }
    };
    match web_fs::append(&params.path, &bytes).await {
        Ok(_) => AsyncResponse {
            ok: true,
            value: Some(serde_json::Value::Bool(true)),
            error: None,
        },
        Err(e) => AsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_async(e)),
        },
    }
}

pub async fn execute_fs_append_text(
    params: FsWriteParams,
) -> AsyncResponse {
    match web_fs::append_text(&params.path, &params.data).await {
        Ok(_) => AsyncResponse {
            ok: true,
            value: Some(serde_json::Value::Bool(true)),
            error: None,
        },
        Err(e) => AsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_async(e)),
        },
    }
}

pub async fn execute_fs_append_base64(
    params: FsWriteParams,
) -> AsyncResponse {
    match web_fs::append_base64(&params.path, &params.data).await {
        Ok(_) => AsyncResponse {
            ok: true,
            value: Some(serde_json::Value::Bool(true)),
            error: None,
        },
        Err(e) => AsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_async(e)),
        },
    }
}

pub async fn execute_fs_update(
    params: FsUpdateParams,
) -> AsyncResponse {
    let bytes = match data_encoding::BASE64.decode(params.data.as_bytes()) {
        Ok(b) => b,
        Err(_) => {
            return AsyncResponse {
                ok: false,
                value: None,
                error: Some(AsyncError {
                    message: "Invalid base64 data".into(),
                    code: "E_INVALID_ENCODING".into(),
                }),
            };
        }
    };
    match web_fs::update(&params.path, params.offset, &bytes).await {
        Ok(_) => AsyncResponse {
            ok: true,
            value: Some(serde_json::Value::Bool(true)),
            error: None,
        },
        Err(e) => AsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_async(e)),
        },
    }
}

pub async fn execute_fs_hash(
    params: FsHashParams,
) -> AsyncResponse {
    match web_fs::hash(&params.path, &params.algo).await {
        Ok(hex) => AsyncResponse {
            ok: true,
            value: Some(serde_json::Value::String(hex)),
            error: None,
        },
        Err(e) => AsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_async(e)),
        },
    }
}

// ─── Registry initialisation ────────────────────────────────────

/// Register all fs.* APIs in the handler registry.
/// Must be called once per session (typically in `ExtensionSession::new`).
pub fn init_fs_registry() {
    use web_js_core::web_api;

    web_api! {
        action: "fs_exists",
        namespace: "fs",
        name: "exists",
        doc: "Check if a file or directory exists.",
        params: [
            path: "string", "required", "Path to check",
        ],
        returns: "boolean" => "Whether the path exists",
        param_struct: FsPathParams,
        handler: execute_fs_exists,
        fields: ["path"],
    }

    web_api! {
        action: "fs_stat",
        namespace: "fs",
        name: "stat",
        doc: "Get metadata for a file or directory.",
        params: [
            path: "string", "required", "Path to stat",
        ],
        returns: "object" => "Metadata object",
        param_struct: FsPathParams,
        handler: execute_fs_stat,
        fields: ["path"],
    }

    web_api! {
        action: "fs_list",
        namespace: "fs",
        name: "list",
        doc: "List entries in a directory.",
        params: [
            path: "string", "required", "Directory path",
        ],
        returns: "object[]" => "Array of entry objects",
        param_struct: FsPathParams,
        handler: execute_fs_list,
        fields: ["path"],
    }

    web_api! {
        action: "fs_mkdir",
        namespace: "fs",
        name: "mkdir",
        doc: "Create a directory.",
        params: [
            path: "string", "required", "Directory path to create",
        ],
        returns: "boolean" => "Whether creation succeeded",
        param_struct: FsPathParams,
        handler: execute_fs_mkdir,
        fields: ["path"],
    }

    web_api! {
        action: "fs_delete",
        namespace: "fs",
        name: "delete",
        doc: "Delete a file or directory.",
        params: [
            path: "string", "required", "Path to delete",
        ],
        returns: "boolean" => "Whether deletion succeeded",
        param_struct: FsPathParams,
        handler: execute_fs_delete,
        fields: ["path"],
    }

    web_api! {
        action: "fs_copy",
        namespace: "fs",
        name: "copy",
        doc: "Copy a file or directory.",
        params: [
            from: "string", "required", "Source path",
            to: "string", "required", "Destination path",
        ],
        returns: "boolean" => "Whether copy succeeded",
        param_struct: FsCopyParams,
        handler: execute_fs_copy,
        fields: ["from", "to"],
    }

    web_api! {
        action: "fs_move",
        namespace: "fs",
        name: "move",
        doc: "Move (rename) a file or directory.",
        params: [
            from: "string", "required", "Source path",
            to: "string", "required", "Destination path",
        ],
        returns: "boolean" => "Whether move succeeded",
        param_struct: FsCopyParams,
        handler: execute_fs_move,
        fields: ["from", "to"],
    }

    web_api! {
        action: "fs_read",
        namespace: "fs",
        name: "read",
        doc: "Read a file as base64-encoded bytes.",
        params: [
            path: "string", "required", "File path",
        ],
        returns: "string" => "Base64-encoded file contents",
        param_struct: FsPathParams,
        handler: execute_fs_read,
        fields: ["path"],
    }

    web_api! {
        action: "fs_read_text",
        namespace: "fs",
        name: "read_text",
        doc: "Read a file as UTF-8 text.",
        params: [
            path: "string", "required", "File path",
        ],
        returns: "string" => "File contents as text",
        param_struct: FsPathParams,
        handler: execute_fs_read_text,
        fields: ["path"],
    }

    web_api! {
        action: "fs_read_base64",
        namespace: "fs",
        name: "read_base64",
        doc: "Read a file as base64-encoded string.",
        params: [
            path: "string", "required", "File path",
        ],
        returns: "string" => "Base64-encoded file contents",
        param_struct: FsPathParams,
        handler: execute_fs_read_base64,
        fields: ["path"],
    }

    web_api! {
        action: "fs_read_range",
        namespace: "fs",
        name: "read_range",
        doc: "Read a byte range from a file as base64.",
        params: [
            path: "string", "required", "File path",
            offset: "number", "required", "Start byte offset",
            len: "number", "required", "Number of bytes to read",
        ],
        returns: "string" => "Base64-encoded bytes",
        param_struct: FsReadRangeParams,
        handler: execute_fs_read_range,
        fields: ["path", "offset", "len"],
    }

    web_api! {
        action: "fs_write",
        namespace: "fs",
        name: "write",
        doc: "Write base64-encoded data to a file.",
        params: [
            path: "string", "required", "File path",
            data: "string", "required", "Base64-encoded data",
        ],
        returns: "boolean" => "Whether write succeeded",
        param_struct: FsWriteParams,
        handler: execute_fs_write,
        fields: ["path", "data"],
    }

    web_api! {
        action: "fs_write_text",
        namespace: "fs",
        name: "write_text",
        doc: "Write UTF-8 text to a file.",
        params: [
            path: "string", "required", "File path",
            data: "string", "required", "Text data",
        ],
        returns: "boolean" => "Whether write succeeded",
        param_struct: FsWriteParams,
        handler: execute_fs_write_text,
        fields: ["path", "data"],
    }

    web_api! {
        action: "fs_write_base64",
        namespace: "fs",
        name: "write_base64",
        doc: "Write base64-encoded data to a file.",
        params: [
            path: "string", "required", "File path",
            data: "string", "required", "Base64-encoded data",
        ],
        returns: "boolean" => "Whether write succeeded",
        param_struct: FsWriteParams,
        handler: execute_fs_write_base64,
        fields: ["path", "data"],
    }

    web_api! {
        action: "fs_append",
        namespace: "fs",
        name: "append",
        doc: "Append base64-encoded data to a file.",
        params: [
            path: "string", "required", "File path",
            data: "string", "required", "Base64-encoded data",
        ],
        returns: "boolean" => "Whether append succeeded",
        param_struct: FsWriteParams,
        handler: execute_fs_append,
        fields: ["path", "data"],
    }

    web_api! {
        action: "fs_append_text",
        namespace: "fs",
        name: "append_text",
        doc: "Append UTF-8 text to a file.",
        params: [
            path: "string", "required", "File path",
            data: "string", "required", "Text data",
        ],
        returns: "boolean" => "Whether append succeeded",
        param_struct: FsWriteParams,
        handler: execute_fs_append_text,
        fields: ["path", "data"],
    }

    web_api! {
        action: "fs_append_base64",
        namespace: "fs",
        name: "append_base64",
        doc: "Append base64-encoded data to a file.",
        params: [
            path: "string", "required", "File path",
            data: "string", "required", "Base64-encoded data",
        ],
        returns: "boolean" => "Whether append succeeded",
        param_struct: FsWriteParams,
        handler: execute_fs_append_base64,
        fields: ["path", "data"],
    }

    web_api! {
        action: "fs_update",
        namespace: "fs",
        name: "update",
        doc: "Update a byte range in a file with base64 data.",
        params: [
            path: "string", "required", "File path",
            offset: "number", "required", "Start byte offset",
            data: "string", "required", "Base64-encoded data",
        ],
        returns: "boolean" => "Whether update succeeded",
        param_struct: FsUpdateParams,
        handler: execute_fs_update,
        fields: ["path", "offset", "data"],
    }

    web_api! {
        action: "fs_hash",
        namespace: "fs",
        name: "hash",
        doc: "Compute a hash of a file.",
        params: [
            path: "string", "required", "File path",
            algo: "string", "required", "Hash algorithm (e.g. sha256)",
        ],
        returns: "string" => "Hex-encoded hash",
        param_struct: FsHashParams,
        handler: execute_fs_hash,
        fields: ["path", "algo"],
    }
}

/// Register all extension-only APIs in the doc registry.
///
/// These APIs are not handled locally (except fs_*); they are relayed to the
/// main-thread runner via `__extension_js_relay`.  Registering them here
/// ensures `generate_js_bindings_code()` produces JS bindings so the APIs
/// are visible in the extension JS environment.
///
/// Must be called once per session (typically in `ExtensionSession::new`).
pub fn init_extension_registry() {
    // Extension-only APIs that need generic JS bindings generated from the doc registry.
    // Custom wrappers in prelude.js take precedence (checked via typeof === 'undefined').
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
        ("tab_evaluate", "web.tab", "evaluate", fields: ["tabId", "script"]),
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
        ("tab_fetch", "web.tab", "fetch", fields: ["tabId", "url"]),
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
        ("web_log", "web", "log"),
        // Common APIs handled by the extension runner (need JS bindings)
        ("sleep", "web", "sleep", fields: ["duration"]),
        ("fetch", "web", "fetch", fields: ["url"]),
        ("mock_async", "web", "mock_async"),
        ("storage_get", "web.storage", "get", fields: ["key"]),
        ("storage_set", "web.storage", "set", fields: ["key", "value"]),
        ("storage_delete", "web.storage", "delete", fields: ["key"]),
        ("storage_list", "web.storage", "list"),
        ("page_click", "page", "click", fields: ["refId"]),
        ("page_fill", "page", "fill", fields: ["refId", "value"]),
        ("page_type", "page", "type", fields: ["refId", "text"]),
        ("page_append", "page", "append", fields: ["refId", "text"]),
        ("page_scroll", "page", "scroll", fields: ["direction", "amount"]),
        ("page_scroll_to", "page", "scroll_to", fields: ["refId"]),
        ("page_snapshot", "page", "snapshot"),
        ("page_snapshot_text", "page", "snapshot_text"),
        ("page_snapshot_data", "page", "snapshot_data"),
        ("page_url", "page", "url"),
        ("page_title", "page", "title"),
        ("page_goto", "page", "goto", fields: ["url"]),
        ("page_reload", "page", "reload"),
        ("page_back", "page", "back"),
        ("page_forward", "page", "forward"),
        ("page_wait", "page", "wait", fields: ["duration"]),
        ("page_wait_for", "page", "wait_for", fields: ["refId", "timeout"]),
        ("page_hover", "page", "hover", fields: ["refId"]),
        ("page_unhover", "page", "unhover"),
        ("page_dblclick", "page", "dblclick", fields: ["refId"]),
        ("page_select", "page", "select", fields: ["refId", "value"]),
        ("page_check", "page", "check", fields: ["refId", "checked"]),
        ("page_press", "page", "press", fields: ["key"]),
        ("page_find", "page", "find", fields: ["selector", "timeout"]),
        ("page_extract", "page", "extract", fields: ["selector", "attribute"]),

        ("sidepanel_url", "sidepanel", "url"),
        ("sidepanel_title", "sidepanel", "title"),
        ("sidepanel_click", "sidepanel", "click", fields: ["refId"]),
        ("sidepanel_fill", "sidepanel", "fill", fields: ["refId", "value"]),
        ("sidepanel_type", "sidepanel", "type", fields: ["refId", "text"]),
        ("sidepanel_append", "sidepanel", "append", fields: ["refId", "text"]),
        ("sidepanel_scroll", "sidepanel", "scroll", fields: ["direction", "amount"]),
        ("sidepanel_scroll_to", "sidepanel", "scroll_to", fields: ["refId"]),
        ("sidepanel_snapshot", "sidepanel", "snapshot"),
        ("sidepanel_snapshot_text", "sidepanel", "snapshot_text"),
        ("sidepanel_snapshot_data", "sidepanel", "snapshot_data"),
        ("sidepanel_wait", "sidepanel", "wait", fields: ["duration"]),
        ("sidepanel_hover", "sidepanel", "hover", fields: ["refId"]),
        ("sidepanel_unhover", "sidepanel", "unhover"),
        ("sidepanel_dblclick", "sidepanel", "dblclick", fields: ["refId"]),
        ("sidepanel_select", "sidepanel", "select", fields: ["refId", "value"]),
        ("sidepanel_check", "sidepanel", "check", fields: ["refId", "checked"]),
        ("sidepanel_press", "sidepanel", "press", fields: ["key"]),
        ("dom_snapshot", "dom", "snapshot"),
        ("dom_format", "dom", "format"),
        ("host_call", "host", "call", fields: ["action", "params"])
    }
}

