use crate::ExtensionSession;
use wasm_bindgen::prelude::*;

/// csv.* namespace — CSV format primitives.
/// Standalone module (not in the fs.rs macro) so future csv.append / csv.write
/// have a natural home without bloating the fs macro.
#[wasm_bindgen]
impl ExtensionSession {
    #[wasm_bindgen(js_name = csvParse)]
    pub async fn csv_parse(
        &self,
        params: crate::fs::FsPathParams,
    ) -> Result<crate::fs::FsStringResult, String> {
        let json = web_fs::parse_csv(&params.path)
            .await
            .map_err(|e| e.wire_message())?;
        Ok(crate::fs::FsStringResult { data: json })
    }
}
