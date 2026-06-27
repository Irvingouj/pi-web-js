use crate::ExtensionSession;
use wasm_bindgen::prelude::*;

/// pdf.* namespace — PDF document primitives.
#[wasm_bindgen]
impl ExtensionSession {
    #[wasm_bindgen(js_name = pdfText)]
    pub async fn pdf_text(
        &self,
        params: crate::fs::FsPathParams,
    ) -> Result<crate::fs::FsStringResult, String> {
        let json = web_fs::parse_pdf(&params.path)
            .await
            .map_err(|e| e.wire_message())?;
        Ok(crate::fs::FsStringResult { data: json })
    }
}
