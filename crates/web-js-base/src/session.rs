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

    /// Create an extension notebook session with eval enabled and higher fuel.
    pub fn new_extension() -> Self {
        Self {
            inner: JsSession::build()
                .allow_user_eval(true)
                .fuel_limit(10_000_000)
                .finish(),
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

    /// Reset the session immediately, creating a fresh JS context.
    pub fn reset_now(&mut self) {
        self.inner.reset_now();
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
    tracing::trace!(code_len = code.len(), "run_cell_async_loop_enter");
    let mut result = base.run_cell(code, stdin);
    tracing::trace!(result = ?result.status(), "run_cell_async_loop_initial");

    let mut batch_counter = 0u32;

    while let WasmRunResult::Pending {
        ref pending_commands,
        ..
    } = &result
    {
        let batch: Vec<WasmAsyncCommand> = pending_commands.clone();

        if batch.is_empty() {
            tracing::error!("batch_empty");
            // Cell is pending but no commands were yielded — it's stuck.
            return match result {
                    WasmRunResult::Pending {
                        stdout,
                        stderr,
                        execution_count,
                        ..
                    } => WasmRunResult::Err {
                        stdout,
                        stderr,
                        error: WasmCellError::Internal {
                            message: "Cell is pending but no async commands were yielded — likely a stuck promise".into(),
                        },
                        execution_count,
                    },
                    _ => unreachable!(),
                };
        }

        batch_counter += 1;
        let batch_id = format!("batch_{}", batch_counter);
        let actions_str = batch
            .iter()
            .map(|c| c.action.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        tracing::trace!(batch_id = %batch_id, batch_size = batch.len(), actions = %actions_str, "batch_created");

        // Check abort before executing batch
        if let Some(flag) = aborted {
            if flag.get() {
                let err_json = serde_json::to_string(&WasmAsyncResponse {
                    ok: false,
                    value: None,
                    error: Some(WasmAsyncError::new("Runner aborted", "E_ABORTED")),
                })
                .unwrap_or_default();
                for cmd in &batch {
                    result = base.resume_cell(cmd.call_id, &err_json);
                }
                break;
            }
        }

        let _prev_stdout = match &result {
            WasmRunResult::Pending { stdout, .. } => stdout.clone(),
            _ => Vec::new(),
        };

        // Execute all commands in the batch concurrently
        let call_ids: Vec<u32> = batch.iter().map(|c| c.call_id).collect();
        let actions: Vec<String> = batch.iter().map(|c| c.action.clone()).collect();
        tracing::trace!(batch_id = %batch_id, "awaiting_handle_command_batch");
        let futures: Vec<Fut> = batch.into_iter().map(&mut handle_command).collect();
        let responses: Vec<Result<WasmAsyncResponse, WasmAsyncError>> =
            futures_util::future::join_all(futures).await;
        tracing::trace!(batch_id = %batch_id, response_count = responses.len(), "handle_command_batch_done");

        // Resume QuickJS serially — one resume_cell at a time
        let mut accumulated_pending: Vec<WasmAsyncCommand> = Vec::new();
        let mut last_stdout = Vec::new();
        let mut last_stderr = Vec::new();
        let mut last_execution_count = 0;

        for (idx, (call_id, response_result)) in call_ids.into_iter().zip(responses).enumerate() {
            let action = actions
                .get(idx)
                .cloned()
                .unwrap_or_else(|| "unknown".to_string());
            tracing::trace!(call_id, action = %action, "resume_start");
            // Check abort between resumes
            if let Some(flag) = aborted {
                if flag.get() {
                    let err_json = serde_json::to_string(&WasmAsyncResponse {
                        ok: false,
                        value: None,
                        error: Some(WasmAsyncError::new("Runner aborted", "E_ABORTED")),
                    })
                    .unwrap_or_default();
                    result = base.resume_cell(call_id, &err_json);
                    if let WasmRunResult::Pending {
                        pending_commands,
                        stdout,
                        stderr,
                        execution_count,
                        ..
                    } = &result
                    {
                        accumulated_pending.extend(pending_commands.clone());
                        last_stdout = stdout.clone();
                        last_stderr = stderr.clone();
                        last_execution_count = *execution_count;
                    } else if let WasmRunResult::Ok {
                        stdout,
                        stderr,
                        execution_count,
                        ..
                    } = &result
                    {
                        last_stdout = stdout.clone();
                        last_stderr = stderr.clone();
                        last_execution_count = *execution_count;
                    } else if let WasmRunResult::Err {
                        stdout,
                        stderr,
                        execution_count,
                        ..
                    } = &result
                    {
                        last_stdout = stdout.clone();
                        last_stderr = stderr.clone();
                        last_execution_count = *execution_count;
                    }
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
            // SANITIZED: do NOT log full JSON
            tracing::trace!(call_id, ok = response.ok, "resume_response");
            let json = serde_json::to_string(&response).unwrap_or_default();
            result = base.resume_cell(call_id, &json);
            tracing::trace!(call_id, result = ?result.status(), "resume_done");

            match &result {
                WasmRunResult::Pending {
                    pending_commands,
                    stdout,
                    stderr,
                    execution_count,
                    ..
                } => {
                    accumulated_pending.extend(pending_commands.clone());
                    last_stdout = stdout.clone();
                    last_stderr = stderr.clone();
                    last_execution_count = *execution_count;
                }
                WasmRunResult::Ok {
                    stdout,
                    stderr,
                    execution_count,
                    ..
                } => {
                    last_stdout = stdout.clone();
                    last_stderr = stderr.clone();
                    last_execution_count = *execution_count;
                }
                WasmRunResult::Err {
                    stdout,
                    stderr,
                    execution_count,
                    ..
                } => {
                    last_stdout = stdout.clone();
                    last_stderr = stderr.clone();
                    last_execution_count = *execution_count;
                }
            }
        }

        tracing::trace!(batch_id = %batch_id, accumulated_pending = accumulated_pending.len(), "batch_end");
        // If any resume produced pending commands and the final result is not
        // an error, force result to Pending so the loop will batch and execute
        // them in the next iteration.
        if !accumulated_pending.is_empty() && !matches!(result, WasmRunResult::Err { .. }) {
            result = WasmRunResult::Pending {
                stdout: last_stdout,
                stderr: last_stderr,
                execution_count: last_execution_count,
                pending_commands: accumulated_pending,
                commands: vec![],
                fuel_exhausted: false,
            };
        }

        tracing::trace!(result = ?result.status(), "loop_iteration_end");
        // Loop will check result again — if Pending with new commands, they'll be batched
    }

    tracing::trace!(result = ?result.status(), "run_cell_async_loop_exit");
    result
}
