use crate::ExtensionSession;
use wasm_bindgen::prelude::*;

/// zip.* namespace — ZIP archive primitives.
#[wasm_bindgen]
impl ExtensionSession {
    #[wasm_bindgen(js_name = zipList)]
    pub async fn zip_list(
        &self,
        params: crate::fs::FsPathParams,
    ) -> Result<crate::fs::FsStringResult, String> {
        let json = web_fs::parse_zip(&params.path)
            .await
            .map_err(|e| e.wire_message())?;
        Ok(crate::fs::FsStringResult { data: json })
    }
}
