use std::cell::Cell;

use crate::types::*;
use web_js_core::JsSession;


// ─── BaseSession ────────────────────────────────────────────────

/// BaseSession wraps JsSession for use by upper-layer crates
/// (web-js, extension-js). It is NOT marked with `#[wasm_bindgen]`;
/// JS cannot see it directly. Upper crates wrap it in their own
/// `#[wasm_bindgen]` structs.
pub struct BaseSession {
    pub inner: JsSession,
}

impl Default for BaseSession {
    fn default() -> Self {
        Self::new()
    }
}

impl BaseSession {
    /// Create a new notebook session.
    pub fn new() -> Self {
        Self {
            inner: JsSession::new(),
        }
    }

    /// Run a cell of code with optional stdin.
    pub fn run_cell(&mut self, code: &str, stdin: &str) -> WasmRunResult {
        self.inner.run_cell(code, stdin).into()
    }

    /// Resume a yielded cell with an async response JSON string.
    pub fn resume_cell(&mut self, call_id: u32, response_json: &str) -> WasmRunResult {
        self.inner.resume_cell(call_id, response_json).into()
    }

    /// Reset the session, clearing all JS state.
    pub fn reset(&mut self) {
        self.inner.reset();
    }

    /// Set the fuel limit for execution.
    pub fn set_fuel_limit(&mut self, limit: u64) {
        self.inner.set_fuel_limit(limit);
    }

    /// Load a JS library by executing its source code.
    /// Any globals defined become available to subsequent cells.
    pub fn load_library(&mut self, source: &str) -> WasmRunResult {
        self.inner.run_cell(source, "").into()
    }

    /// Inspect all global variables in the current JS state.
    pub fn inspect_globals(&mut self) -> WasmGlobalsSnapshot {
        self.inner.inspect_globals().into()
    }
}

// ─── Shared async loop ──────────────────────────────────────────

/// Run a cell and resolve all async yields via the provided handler.
///
/// The `handle_command` callback receives each yielded `WasmAsyncCommand`
/// and must return a `WasmAsyncResponse` (or an error). The loop
/// automatically serialises responses and resumes the JS executor.
///
/// If `aborted` is provided, a `true` flag causes the loop to resume
/// with an `E_ABORTED` error so the executor unwinds cleanly.
pub async fn run_cell_async_loop<F, Fut>(
    base: &mut BaseSession,
    code: &str,
    stdin: &str,
    mut handle_command: F,
    aborted: Option<&Cell<bool>>,
) -> WasmRunResult
where
    F: FnMut(WasmAsyncCommand) -> Fut,
    Fut: std::future::Future<Output = Result<WasmAsyncResponse, WasmAsyncError>>,
{
    let mut result = base.run_cell(code, stdin);

    loop {
        let batch: Vec<WasmAsyncCommand> = match &result {
            WasmRunResult::Pending {
                ref pending_commands,
                ..
            } => pending_commands.clone(),
            _ => break,
        };

        if batch.is_empty() {
            break;
        }

        let _call_ids: Vec<u32> = batch.iter().map(|c| c.call_id).collect();

        // Check abort before executing batch
        if let Some(flag) = aborted {
            if flag.get() {
                let err_json = serde_json::to_string(&WasmAsyncResponse {
                    ok: false,
                    value: None,
                    error: Some(WasmAsyncError {
                        message: "Runner aborted".into(),
                        code: "E_ABORTED".into(),
                    }),
                })
                .unwrap_or_default();
                for cmd in &batch {
                    result = base.resume_cell(cmd.call_id, &err_json);
                }
                break;
            }
        }

        let prev_stdout = match &result {
            WasmRunResult::Pending { stdout, .. } => stdout.clone(),
            _ => Vec::new(),
        };

        // Execute all commands in the batch concurrently
        let call_ids: Vec<u32> = batch.iter().map(|c| c.call_id).collect();
        let futures: Vec<Fut> = batch.into_iter().map(|cmd| handle_command(cmd)).collect();
        let responses: Vec<Result<WasmAsyncResponse, WasmAsyncError>> =
            futures_util::future::join_all(futures).await;

        // Resume QuickJS serially — one resume_cell at a time
        for (call_id, response_result) in call_ids.into_iter().zip(responses.into_iter()) {
            // Check abort between resumes
            if let Some(flag) = aborted {
                if flag.get() {
                    let err_json = serde_json::to_string(&WasmAsyncResponse {
                        ok: false,
                        value: None,
                        error: Some(WasmAsyncError {
                            message: "Runner aborted".into(),
                            code: "E_ABORTED".into(),
                        }),
                    })
                    .unwrap_or_default();
                    result = base.resume_cell(call_id, &err_json);
                    continue;
                }
            }

            let response = match response_result {
                Ok(r) => r,
                Err(e) => WasmAsyncResponse {
                    ok: false,
                    value: None,
                    error: Some(e),
                },
            };
            let json = serde_json::to_string(&response).unwrap_or_default();
            result = base.resume_cell(call_id, &json);

            // Merge stdout from error results
            if let WasmRunResult::Err {
                ref mut stdout, ..
            } = result
            {
                let mut merged = prev_stdout.clone();
                merged.append(&mut stdout.clone());
                *stdout = merged;
            }
        }

        // Loop will check result again — if Pending with new commands, they'll be batched
    }

    result
}
