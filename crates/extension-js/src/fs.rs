use serde::{Deserialize, Serialize};
use tsify::Tsify;

// ─── Parameter DTOs ───────────────────────────────────────────────

#[derive(Tsify, Serialize, Deserialize)]
#[tsify(from_wasm_abi)]
pub struct FsPathParams {
    pub path: String,
}

#[derive(Tsify, Serialize, Deserialize)]
#[tsify(from_wasm_abi)]
pub struct FsCopyParams {
    pub from: String,
    pub to: String,
}

#[derive(Tsify, Serialize, Deserialize)]
#[tsify(from_wasm_abi)]
pub struct FsWriteParams {
    pub path: String,
    pub data: String,
}

#[derive(Tsify, Serialize, Deserialize)]
#[tsify(from_wasm_abi)]
pub struct FsReadRangeParams {
    pub path: String,
    pub offset: u64,
    pub len: u64,
}

#[derive(Tsify, Serialize, Deserialize)]
#[tsify(from_wasm_abi)]
pub struct FsReadRangeDataParams {
    pub path: String,
    pub offset: u64,
    pub data: String,
}

#[derive(Tsify, Serialize, Deserialize)]
#[tsify(from_wasm_abi)]
pub struct FsHashParams {
    pub path: String,
    pub algo: String,
}

// ─── Return DTOs ────────────────────────────────────────────────────

#[derive(Tsify, Serialize, Deserialize)]
#[tsify(into_wasm_abi)]
pub struct FsExistsResult {
    pub exists: bool,
}

#[derive(Tsify, Serialize, Deserialize)]
#[tsify(into_wasm_abi)]
pub struct FsBoolResult {
    pub ok: bool,
}

#[derive(Tsify, Serialize, Deserialize)]
#[tsify(into_wasm_abi)]
pub struct FsStringResult {
    pub data: String,
}

#[derive(Tsify, Serialize, Deserialize)]
#[tsify(into_wasm_abi)]
pub struct FsListEntry {
    pub name: String,
    pub kind: String,
}

#[derive(Tsify, Serialize, Deserialize)]
#[tsify(into_wasm_abi)]
pub struct FsListResult {
    pub entries: Vec<FsListEntry>,
}

#[derive(Tsify, Serialize, Deserialize)]
#[tsify(into_wasm_abi)]
pub struct FsStatResult {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub size: u64,
    pub mime: Option<String>,
    pub created_at: Option<u64>,
    pub modified_at: Option<u64>,
}

#[derive(Tsify, Serialize, Deserialize)]
#[tsify(into_wasm_abi)]
pub struct FsHashResult {
    pub hash: String,
}

// ─── Macro ────────────────────────────────────────────────────────

#[macro_export]
macro_rules! impl_extension_session_fs {
    () => {
        #[wasm_bindgen]
        impl ExtensionSession {
            // ─── Path-only methods ───────────────────────────────────────────
            #[wasm_bindgen(js_name = fsExists)]
            pub async fn fs_exists(&self, params: $crate::fs::FsPathParams) -> Result<$crate::fs::FsExistsResult, String> {
                let exists = web_fs::exists(&params.path).await;
                Ok($crate::fs::FsExistsResult { exists })
            }

            #[wasm_bindgen(js_name = fsStat)]
            pub async fn fs_stat(&self, params: $crate::fs::FsPathParams) -> Result<$crate::fs::FsStatResult, String> {
                let meta = web_fs::stat(&params.path).await
                    .map_err(|e| e.wire_message())?;
                Ok($crate::fs::FsStatResult {
                    path: meta.path,
                    name: meta.name,
                    kind: match meta.kind {
                        web_fs::EntryKind::File => "file".to_string(),
                        web_fs::EntryKind::Directory => "directory".to_string(),
                    },
                    size: meta.size,
                    mime: meta.mime,
                    created_at: meta.created_at,
                    modified_at: meta.modified_at,
                })
            }

            #[wasm_bindgen(js_name = fsList)]
            pub async fn fs_list(&self, params: $crate::fs::FsPathParams) -> Result<$crate::fs::FsListResult, String> {
                let entries = web_fs::list(&params.path).await
                    .map_err(|e| e.wire_message())?;
                Ok($crate::fs::FsListResult {
                    entries: entries.into_iter().map(|e| $crate::fs::FsListEntry {
                        name: e.name,
                        kind: match e.kind {
                            web_fs::EntryKind::File => "file".to_string(),
                            web_fs::EntryKind::Directory => "directory".to_string(),
                        },
                    }).collect(),
                })
            }

            #[wasm_bindgen(js_name = fsMkdir)]
            pub async fn fs_mkdir(&self, params: $crate::fs::FsPathParams) -> Result<$crate::fs::FsBoolResult, String> {
                web_fs::mkdir(&params.path).await
                    .map_err(|e| e.wire_message())?;
                Ok($crate::fs::FsBoolResult { ok: true })
            }

            #[wasm_bindgen(js_name = fsDelete)]
            pub async fn fs_delete(&self, params: $crate::fs::FsPathParams) -> Result<$crate::fs::FsBoolResult, String> {
                web_fs::delete(&params.path).await
                    .map_err(|e| e.wire_message())?;
                Ok($crate::fs::FsBoolResult { ok: true })
            }

            #[wasm_bindgen(js_name = fsRead)]
            pub async fn fs_read(&self, params: $crate::fs::FsPathParams) -> Result<$crate::fs::FsStringResult, String> {
                let bytes = web_fs::read(&params.path).await
                    .map_err(|e| e.wire_message())?;
                Ok($crate::fs::FsStringResult {
                    data: data_encoding::BASE64.encode(&bytes),
                })
            }

            #[wasm_bindgen(js_name = fsReadText)]
            pub async fn fs_read_text(&self, params: $crate::fs::FsPathParams) -> Result<$crate::fs::FsStringResult, String> {
                let text = web_fs::read_text(&params.path).await
                    .map_err(|e| e.wire_message())?;
                Ok($crate::fs::FsStringResult { data: text })
            }

            #[wasm_bindgen(js_name = fsReadBase64)]
            pub async fn fs_read_base64(&self, params: $crate::fs::FsPathParams) -> Result<$crate::fs::FsStringResult, String> {
                let b64 = web_fs::read_base64(&params.path).await
                    .map_err(|e| e.wire_message())?;
                Ok($crate::fs::FsStringResult { data: b64 })
            }

            // ─── Two-path methods ────────────────────────────────────────────
            #[wasm_bindgen(js_name = fsCopy)]
            pub async fn fs_copy(&self, params: $crate::fs::FsCopyParams) -> Result<$crate::fs::FsBoolResult, String> {
                web_fs::copy(&params.from, &params.to).await
                    .map_err(|e| e.wire_message())?;
                Ok($crate::fs::FsBoolResult { ok: true })
            }

            #[wasm_bindgen(js_name = fsMove)]
            pub async fn fs_move(&self, params: $crate::fs::FsCopyParams) -> Result<$crate::fs::FsBoolResult, String> {
                web_fs::rename(&params.from, &params.to).await
                    .map_err(|e| e.wire_message())?;
                Ok($crate::fs::FsBoolResult { ok: true })
            }

            // ─── Path + data methods ─────────────────────────────────────────
            #[wasm_bindgen(js_name = fsWrite)]
            pub async fn fs_write(&self, params: $crate::fs::FsWriteParams) -> Result<$crate::fs::FsBoolResult, String> {
                let bytes = data_encoding::BASE64.decode(params.data.as_bytes())
                    .map_err(|_| "Invalid base64".to_string())?;
                web_fs::write(&params.path, &bytes).await
                    .map_err(|e| e.wire_message())?;
                Ok($crate::fs::FsBoolResult { ok: true })
            }

            #[wasm_bindgen(js_name = fsWriteText)]
            pub async fn fs_write_text(&self, params: $crate::fs::FsWriteParams) -> Result<$crate::fs::FsBoolResult, String> {
                web_fs::write_text(&params.path, &params.data).await
                    .map_err(|e| e.wire_message())?;
                Ok($crate::fs::FsBoolResult { ok: true })
            }

            #[wasm_bindgen(js_name = fsWriteBase64)]
            pub async fn fs_write_base64(&self, params: $crate::fs::FsWriteParams) -> Result<$crate::fs::FsBoolResult, String> {
                web_fs::write_base64(&params.path, &params.data).await
                    .map_err(|e| e.wire_message())?;
                Ok($crate::fs::FsBoolResult { ok: true })
            }

            #[wasm_bindgen(js_name = fsAppend)]
            pub async fn fs_append(&self, params: $crate::fs::FsWriteParams) -> Result<$crate::fs::FsBoolResult, String> {
                let bytes = data_encoding::BASE64.decode(params.data.as_bytes())
                    .map_err(|_| "Invalid base64".to_string())?;
                web_fs::append(&params.path, &bytes).await
                    .map_err(|e| e.wire_message())?;
                Ok($crate::fs::FsBoolResult { ok: true })
            }

            #[wasm_bindgen(js_name = fsAppendText)]
            pub async fn fs_append_text(&self, params: $crate::fs::FsWriteParams) -> Result<$crate::fs::FsBoolResult, String> {
                web_fs::append_text(&params.path, &params.data).await
                    .map_err(|e| e.wire_message())?;
                Ok($crate::fs::FsBoolResult { ok: true })
            }

            #[wasm_bindgen(js_name = fsAppendBase64)]
            pub async fn fs_append_base64(&self, params: $crate::fs::FsWriteParams) -> Result<$crate::fs::FsBoolResult, String> {
                web_fs::append_base64(&params.path, &params.data).await
                    .map_err(|e| e.wire_message())?;
                Ok($crate::fs::FsBoolResult { ok: true })
            }

            // ─── Path + offset + len ─────────────────────────────────────────
            #[wasm_bindgen(js_name = fsReadRange)]
            pub async fn fs_read_range(&self, params: $crate::fs::FsReadRangeParams) -> Result<$crate::fs::FsStringResult, String> {
                let len = params.len as usize;
                let bytes = web_fs::read_range(&params.path, params.offset, len).await
                    .map_err(|e| e.wire_message())?;
                Ok($crate::fs::FsStringResult {
                    data: data_encoding::BASE64.encode(&bytes),
                })
            }

            // ─── Path + offset + data ──────────────────────────────────────
            #[wasm_bindgen(js_name = fsUpdate)]
            pub async fn fs_update(&self, params: $crate::fs::FsReadRangeDataParams) -> Result<$crate::fs::FsBoolResult, String> {
                let bytes = data_encoding::BASE64.decode(params.data.as_bytes())
                    .map_err(|_| "Invalid base64".to_string())?;
                web_fs::update(&params.path, params.offset, &bytes).await
                    .map_err(|e| e.wire_message())?;
                Ok($crate::fs::FsBoolResult { ok: true })
            }

            // ─── Path + algo ─────────────────────────────────────────────────
            #[wasm_bindgen(js_name = fsHash)]
            pub async fn fs_hash(&self, params: $crate::fs::FsHashParams) -> Result<$crate::fs::FsHashResult, String> {
                let hash = web_fs::hash(&params.path, &params.algo).await
                    .map_err(|e| e.wire_message())?;
                Ok($crate::fs::FsHashResult { hash })
            }
        }
    };
}
