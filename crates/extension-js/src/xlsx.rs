use crate::ExtensionSession;
use wasm_bindgen::prelude::*;

/// xlsx.* namespace — XLSX workbook primitives.
#[wasm_bindgen]
impl ExtensionSession {
    #[wasm_bindgen(js_name = xlsxRead)]
    pub async fn xlsx_read(
        &self,
        params: crate::fs::FsPathParams,
    ) -> Result<crate::fs::FsStringResult, String> {
        let json = web_fs::parse_xlsx(&params.path)
            .await
            .map_err(|e| e.wire_message())?;
        Ok(crate::fs::FsStringResult { data: json })
    }
}
