use web_js_core::command_params::*;
use web_js_core::types::{AsyncError, AsyncResponse};

// ─── fs.* helpers ───────────────────────────────────────────────

fn fs_err_to_async(err: web_fs::FsError) -> AsyncError {
    AsyncError::new(err.wire_message(), err.wire_code())
}

pub async fn execute_fs_exists(params: FsPathParams) -> AsyncResponse {
    let exists = web_fs::exists(&params.path).await;
    AsyncResponse {
        ok: true,
        value: Some(serde_json::Value::Bool(exists)),
        error: None,
    }
}

pub async fn execute_fs_stat(params: FsPathParams) -> AsyncResponse {
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
                error: Some(AsyncError::new(
                    format!("Failed to serialize metadata: {}", e),
                    "E_IO",
                )),
            },
        },
        Err(e) => AsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_async(e)),
        },
    }
}

pub async fn execute_fs_list(params: FsPathParams) -> AsyncResponse {
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
                error: Some(AsyncError::new(
                    format!("Failed to serialize entries: {}", e),
                    "E_IO",
                )),
            },
        },
        Err(e) => AsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_async(e)),
        },
    }
}

pub async fn execute_fs_mkdir(params: FsPathParams) -> AsyncResponse {
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

pub async fn execute_fs_delete(params: FsPathParams) -> AsyncResponse {
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

pub async fn execute_fs_copy(params: FsCopyParams) -> AsyncResponse {
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

pub async fn execute_fs_move(params: FsCopyParams) -> AsyncResponse {
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

pub async fn execute_fs_read(params: FsPathParams) -> AsyncResponse {
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

pub async fn execute_fs_read_text(params: FsPathParams) -> AsyncResponse {
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

pub async fn execute_fs_read_base64(params: FsPathParams) -> AsyncResponse {
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

pub async fn execute_fs_read_range(params: FsReadRangeParams) -> AsyncResponse {
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

pub async fn execute_fs_write(params: FsWriteParams) -> AsyncResponse {
    let bytes = match data_encoding::BASE64.decode(params.data.as_bytes()) {
        Ok(b) => b,
        Err(_) => {
            return AsyncResponse {
                ok: false,
                value: None,
                error: Some(AsyncError::new(
                    "Invalid base64 data",
                    "E_INVALID_ENCODING",
                )),
            };
        }
    };
    match web_fs::write(&params.path, &bytes).await {
        Ok(_) => AsyncResponse {
            ok: true,
            value: Some(serde_json::json!({
                "path": params.path,
                "bytes_written": bytes.len() as u64,
            })),
            error: None,
        },
        Err(e) => AsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_async(e)),
        },
    }
}

pub async fn execute_fs_write_text(params: FsWriteParams) -> AsyncResponse {
    match web_fs::write_text(&params.path, &params.data).await {
        Ok(_) => AsyncResponse {
            ok: true,
            value: Some(serde_json::json!({
                "path": params.path.clone(),
                "bytes_written": params.data.len() as u64,
            })),
            error: None,
        },
        Err(e) => AsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_async(e)),
        },
    }
}

pub async fn execute_fs_write_base64(params: FsWriteParams) -> AsyncResponse {
    crate::vfs_write_cache::cache_write(&params.path, &params.data);
    let decoded = match data_encoding::BASE64.decode(params.data.as_bytes()) {
        Ok(b) => b,
        Err(_) => {
            return AsyncResponse {
                ok: false,
                value: None,
                error: Some(AsyncError::new(
                    "Invalid base64 data",
                    "E_INVALID_ENCODING",
                )),
            };
        }
    };
    match web_fs::write_base64(&params.path, &params.data).await {
        Ok(_) => AsyncResponse {
            ok: true,
            value: Some(serde_json::json!({
                "path": params.path.clone(),
                "bytes_written": decoded.len() as u64,
            })),
            error: None,
        },
        Err(e) => AsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_async(e)),
        },
    }
}

pub async fn execute_fs_append(params: FsWriteParams) -> AsyncResponse {
    let bytes = match data_encoding::BASE64.decode(params.data.as_bytes()) {
        Ok(b) => b,
        Err(_) => {
            return AsyncResponse {
                ok: false,
                value: None,
                error: Some(AsyncError::new(
                    "Invalid base64 data",
                    "E_INVALID_ENCODING",
                )),
            };
        }
    };
    match web_fs::append(&params.path, &bytes).await {
        Ok(_) => AsyncResponse {
            ok: true,
            value: Some(serde_json::json!({
                "path": params.path.clone(),
                "bytes_written": bytes.len() as u64,
            })),
            error: None,
        },
        Err(e) => AsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_async(e)),
        },
    }
}

pub async fn execute_fs_append_text(params: FsWriteParams) -> AsyncResponse {
    match web_fs::append_text(&params.path, &params.data).await {
        Ok(_) => AsyncResponse {
            ok: true,
            value: Some(serde_json::json!({
                "path": params.path.clone(),
                "bytes_written": params.data.len() as u64,
            })),
            error: None,
        },
        Err(e) => AsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_async(e)),
        },
    }
}

pub async fn execute_fs_append_base64(params: FsWriteParams) -> AsyncResponse {
    let decoded = match data_encoding::BASE64.decode(params.data.as_bytes()) {
        Ok(b) => b,
        Err(_) => {
            return AsyncResponse {
                ok: false,
                value: None,
                error: Some(AsyncError::new(
                    "Invalid base64 data",
                    "E_INVALID_ENCODING",
                )),
            };
        }
    };
    match web_fs::append_base64(&params.path, &params.data).await {
        Ok(_) => AsyncResponse {
            ok: true,
            value: Some(serde_json::json!({
                "path": params.path.clone(),
                "bytes_written": decoded.len() as u64,
            })),
            error: None,
        },
        Err(e) => AsyncResponse {
            ok: false,
            value: None,
            error: Some(fs_err_to_async(e)),
        },
    }
}

pub async fn execute_fs_update(params: FsUpdateParams) -> AsyncResponse {
    let bytes = match data_encoding::BASE64.decode(params.data.as_bytes()) {
        Ok(b) => b,
        Err(_) => {
            return AsyncResponse {
                ok: false,
                value: None,
                error: Some(AsyncError::new(
                    "Invalid base64 data",
                    "E_INVALID_ENCODING",
                )),
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

pub async fn execute_fs_hash(params: FsHashParams) -> AsyncResponse {
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
/// Idempotent: safe to call from `ExtensionSession::new` and `reset` because
/// the executable registry outlives a single QuickJS context reset.
pub fn init_fs_registry() {
    use web_js_core::web_api;

    if web_js_core::api_docs::has_handler("fs_exists") {
        return;
    }

    let was_frozen = web_js_core::api_docs::is_manifest_frozen();
    if was_frozen {
        web_js_core::api_docs::unfreeze_manifest();
    }

    web_api! {
        action: "fs_exists",
        namespace: "fs",
        name: "exists",
        doc: "Check if a file or directory exists. Paths may be absolute (e.g. \"/foo\") or relative (resolved against root, e.g. \"foo\" resolves to \"/foo\").",
        params: [
            path: "string", "required", "Absolute or relative path (relative resolves against root)",
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
        doc: "Get metadata for a file or directory. Paths may be absolute or relative (relative resolves against root).",
        params: [
            path: "string", "required", "Absolute or relative path (relative resolves against root)",
        ],
        returns: "{ path: string, name: string, kind: \"file\" | \"directory\", size: number, mime?: string, created_at?: number, modified_at?: number }" => "Metadata object",
        param_struct: FsPathParams,
        handler: execute_fs_stat,
        fields: ["path"],
    }

    web_api! {
        action: "fs_list",
        namespace: "fs",
        name: "list",
        doc: "List entries in a directory. Paths may be absolute or relative (relative resolves against root).",
        params: [
            path: "string", "required", "Absolute or relative directory path (relative resolves against root)",
        ],
        returns: "{ name: string, kind: \"file\" | \"directory\" }[]" => "Array of entry objects",
        param_struct: FsPathParams,
        handler: execute_fs_list,
        fields: ["path"],
    }

    web_api! {
        action: "fs_mkdir",
        namespace: "fs",
        name: "mkdir",
        doc: "Create a directory (idempotent, auto-creates parents). Paths may be absolute or relative (relative resolves against root).",
        params: [
            path: "string", "required", "Absolute or relative directory path (relative resolves against root)",
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
        doc: "Delete a file or directory (recursive). Paths may be absolute or relative (relative resolves against root).",
        params: [
            path: "string", "required", "Absolute or relative path (relative resolves against root)",
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
        doc: "Copy a file. Destination auto-creates parent directories. Paths may be absolute or relative (relative resolves against root).",
        params: [
            from: "string", "required", "Source path (absolute or relative; relative resolves against root)",
            to: "string", "required", "Destination path (absolute or relative; relative resolves against root)",
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
        doc: "Move (rename) a file. Destination auto-creates parent directories. Paths may be absolute or relative (relative resolves against root).",
        params: [
            from: "string", "required", "Source path (absolute or relative; relative resolves against root)",
            to: "string", "required", "Destination path (absolute or relative; relative resolves against root)",
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
        doc: "Read a file as base64-encoded bytes. Returns E_NOT_FOUND if the file does not exist. Paths may be absolute or relative (relative resolves against root).",
        params: [
            path: "string", "required", "Absolute or relative file path (relative resolves against root)",
        ],
        returns: "string" => "Base64-encoded file contents",
        param_struct: FsPathParams,
        handler: execute_fs_read,
        fields: ["path"],
    }

    web_api! {
        action: "fs_read_text",
        namespace: "fs",
        name: "readText",
        doc: "Read a file as UTF-8 text. Returns E_NOT_FOUND if the file does not exist. Paths may be absolute or relative (relative resolves against root).",
        params: [
            path: "string", "required", "Absolute or relative file path (relative resolves against root)",
        ],
        returns: "string" => "File contents as text",
        param_struct: FsPathParams,
        handler: execute_fs_read_text,
        fields: ["path"],
        aliases: ["fs" => "read_text"],
    }

    web_api! {
        action: "fs_read_base64",
        namespace: "fs",
        name: "readBase64",
        doc: "Read a file as base64-encoded string. Returns E_NOT_FOUND if the file does not exist. Paths may be absolute or relative (relative resolves against root).",
        params: [
            path: "string", "required", "Absolute or relative file path (relative resolves against root)",
        ],
        returns: "string" => "Base64-encoded file contents",
        param_struct: FsPathParams,
        handler: execute_fs_read_base64,
        fields: ["path"],
        aliases: ["fs" => "read_base64"],
    }

    web_api! {
        action: "fs_read_range",
        namespace: "fs",
        name: "readRange",
        doc: "Read a byte range from a file as base64. Returns E_NOT_FOUND if the file does not exist. Paths may be absolute or relative (relative resolves against root).",
        params: [
            path: "string", "required", "Absolute or relative file path (relative resolves against root)",
            offset: "number", "required", "Start byte offset",
            len: "number", "required", "Number of bytes to read",
        ],
        returns: "string" => "Base64-encoded bytes",
        param_struct: FsReadRangeParams,
        handler: execute_fs_read_range,
        fields: ["path", "offset", "len"],
        aliases: ["fs" => "read_range"],
    }

    web_api! {
        action: "fs_write",
        namespace: "fs",
        name: "write",
        doc: "Write base64-encoded data to a file. Auto-creates the file and any missing parent directories; overwrites if exists. Paths may be absolute or relative (relative resolves against root).",
        params: [
            path: "string", "required", "Absolute or relative file path (relative resolves against root)",
            data: "string", "required", "Base64-encoded data",
        ],
        returns: "{ path: string, bytes_written: number }" => "{ path, bytes_written }",
        param_struct: FsWriteParams,
        handler: execute_fs_write,
        fields: ["path", "data"],
    }

    web_api! {
        action: "fs_write_text",
        namespace: "fs",
        name: "writeText",
        doc: "Write UTF-8 text to a file. Auto-creates the file and any missing parent directories; overwrites if exists. Paths may be absolute or relative (relative resolves against root).",
        params: [
            path: "string", "required", "Absolute or relative file path (relative resolves against root)",
            data: "string", "required", "Text data",
        ],
        returns: "{ path: string, bytes_written: number }" => "{ path, bytes_written }",
        param_struct: FsWriteParams,
        handler: execute_fs_write_text,
        fields: ["path", "data"],
        aliases: ["fs" => "write_text"],
    }

    web_api! {
        action: "fs_write_base64",
        namespace: "fs",
        name: "writeBase64",
        doc: "Write base64-encoded data to a file. Auto-creates the file and any missing parent directories; overwrites if exists. Paths may be absolute or relative (relative resolves against root).",
        params: [
            path: "string", "required", "Absolute or relative file path (relative resolves against root)",
            data: "string", "required", "Base64-encoded data",
        ],
        returns: "{ path: string, bytes_written: number }" => "{ path, bytes_written }",
        param_struct: FsWriteParams,
        handler: execute_fs_write_base64,
        fields: ["path", "data"],
        aliases: ["fs" => "write_base64"],
    }

    web_api! {
        action: "fs_append",
        namespace: "fs",
        name: "append",
        doc: "Append base64-encoded data to a file. Auto-creates the file and any missing parent directories if missing. Paths may be absolute or relative (relative resolves against root).",
        params: [
            path: "string", "required", "Absolute or relative file path (relative resolves against root)",
            data: "string", "required", "Base64-encoded data",
        ],
        returns: "{ path: string, bytes_written: number }" => "{ path, bytes_written }",
        param_struct: FsWriteParams,
        handler: execute_fs_append,
        fields: ["path", "data"],
    }

    web_api! {
        action: "fs_append_text",
        namespace: "fs",
        name: "appendText",
        doc: "Append UTF-8 text to a file. Auto-creates the file and any missing parent directories if missing. Paths may be absolute or relative (relative resolves against root).",
        params: [
            path: "string", "required", "Absolute or relative file path (relative resolves against root)",
            data: "string", "required", "Text data",
        ],
        returns: "{ path: string, bytes_written: number }" => "{ path, bytes_written }",
        param_struct: FsWriteParams,
        handler: execute_fs_append_text,
        fields: ["path", "data"],
        aliases: ["fs" => "append_text"],
    }

    web_api! {
        action: "fs_append_base64",
        namespace: "fs",
        name: "appendBase64",
        doc: "Append base64-encoded data to a file. Auto-creates the file and any missing parent directories if missing. Paths may be absolute or relative (relative resolves against root).",
        params: [
            path: "string", "required", "Absolute or relative file path (relative resolves against root)",
            data: "string", "required", "Base64-encoded data",
        ],
        returns: "{ path: string, bytes_written: number }" => "{ path, bytes_written }",
        param_struct: FsWriteParams,
        handler: execute_fs_append_base64,
        fields: ["path", "data"],
        aliases: ["fs" => "append_base64"],
    }

    web_api! {
        action: "fs_update",
        namespace: "fs",
        name: "update",
        doc: "Overwrite bytes at offset in an existing file. Returns E_NOT_FOUND if the file does not exist. Paths may be absolute or relative (relative resolves against root).",
        params: [
            path: "string", "required", "Absolute or relative file path (relative resolves against root)",
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
        doc: "Compute SHA-1 or SHA-256 hash of an existing file. Returns E_NOT_FOUND if the file does not exist. Paths may be absolute or relative (relative resolves against root).",
        params: [
            path: "string", "required", "Absolute or relative file path (relative resolves against root)",
            algo: "string", "required", "Hash algorithm (\"sha256\" or \"sha1\")",
        ],
        returns: "string" => "Hex-encoded hash",
        param_struct: FsHashParams,
        handler: execute_fs_hash,
        fields: ["path", "algo"],
    }

    if was_frozen {
        web_js_core::api_docs::freeze_manifest()
            .expect("Failed to re-freeze manifest after browser API registration");
    }
}
