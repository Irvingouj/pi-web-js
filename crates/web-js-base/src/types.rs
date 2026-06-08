use serde::{Deserialize, Serialize};
use tsify::Tsify;

// ─── Typed wrapper types for WASM ABI ───────────────────────────
// These mirror the core types but derive Tsify so wasm-bindgen
// emits proper TypeScript interfaces in the .d.ts output.

/// Status of a cell execution.
#[derive(Debug, Clone, PartialEq, Serialize, Tsify)]
#[tsify(into_wasm_abi)]
#[serde(rename_all = "snake_case")]
pub enum WasmCellStatus {
    Done,
    AsyncPending,
}

/// Error details inside an async response.
#[derive(Debug, Clone, Deserialize, Serialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct WasmAsyncError {
    pub message: String,
    pub code: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

impl WasmAsyncError {
    pub fn new(message: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            code: code.into(),
            category: None,
            hint: None,
            recovery: None,
            details: None,
        }
    }
}

/// Response passed to `resume_cell` to resolve an async yield.
#[derive(Debug, Clone, Deserialize, Serialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct WasmAsyncResponse {
    pub ok: bool,
    pub value: Option<serde_json::Value>,
    pub error: Option<WasmAsyncError>,
}

/// Structured error from running a cell.
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WasmCellError {
    Compile {
        name: Option<String>,
        message: String,
        line: Option<u32>,
    },
    Runtime {
        name: Option<String>,
        message: String,
        line: Option<u32>,
        action: Option<String>,
        code: Option<String>,
    },
    FuelExhausted,
    Internal {
        message: String,
    },
}

/// A single global variable observed by `inspect_globals`.
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct WasmGlobalVariable {
    pub name: String,
    #[serde(rename = "type")]
    pub type_name: String,
    pub value: Option<String>,
    pub keys: Option<Vec<String>>,
}

/// Snapshot of all JS globals.
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct WasmGlobalsSnapshot {
    pub variables: Vec<WasmGlobalVariable>,
    pub execution_count: u32,
}

/// An async command yielded from JS, waiting for external resolution.
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct WasmAsyncCommand {
    pub call_id: u32,
    pub action: String,
    #[tsify(type = "CommandParams")]
    pub params: serde_json::Value,
    pub run_id: Option<String>,
}

impl WasmAsyncCommand {
    pub fn parse_params<T: serde::de::DeserializeOwned>(&self) -> Result<T, serde_json::Error> {
        serde_json::from_value(self.params.clone())
    }
}

// ─── Result types ──────────────────────────────────────────────

/// Consumer-facing result of running a single cell.
/// Either success with an optional result string, or an error.
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum CellResult {
    Ok {
        stdout: Vec<String>,
        stderr: Vec<String>,
        result: Option<String>,
        execution_count: u32,
    },
    Err {
        stdout: Vec<String>,
        stderr: Vec<String>,
        error: WasmCellError,
        execution_count: u32,
    },
}

/// Result of running a single cell, including async-loop state.
/// Either still pending (waiting for async resolution) or done.
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum WasmRunResult {
    Pending {
        stdout: Vec<String>,
        stderr: Vec<String>,
        #[tsify(type = "CommandParams[]")]
        commands: Vec<serde_json::Value>,
        fuel_exhausted: bool,
        execution_count: u32,
        pending_commands: Vec<WasmAsyncCommand>,
    },
    Ok {
        stdout: Vec<String>,
        stderr: Vec<String>,
        result: Option<String>,
        execution_count: u32,
    },
    Err {
        stdout: Vec<String>,
        stderr: Vec<String>,
        error: WasmCellError,
        execution_count: u32,
    },
}

impl WasmRunResult {
    pub fn status(&self) -> &'static str {
        match self {
            WasmRunResult::Pending { .. } => "Pending",
            WasmRunResult::Ok { .. } => "Ok",
            WasmRunResult::Err { .. } => "Err",
        }
    }
}

// ─── From impls ────────────────────────────────────────────────

impl From<web_js_core::CellError> for WasmCellError {
    fn from(e: web_js_core::CellError) -> Self {
        match e {
            web_js_core::CellError::Compile {
                name,
                message,
                line,
            } => WasmCellError::Compile {
                name,
                message,
                line,
            },
            web_js_core::CellError::Runtime {
                name,
                message,
                line,
                action,
                code,
            } => WasmCellError::Runtime {
                name,
                message,
                line,
                action,
                code,
            },
            web_js_core::CellError::FuelExhausted => WasmCellError::FuelExhausted,
            web_js_core::CellError::Internal { message } => WasmCellError::Internal { message },
        }
    }
}

impl From<web_js_core::GlobalVariable> for WasmGlobalVariable {
    fn from(v: web_js_core::GlobalVariable) -> Self {
        WasmGlobalVariable {
            name: v.name,
            type_name: v.type_name,
            value: v.value,
            keys: v.keys,
        }
    }
}

impl From<web_js_core::GlobalsSnapshot> for WasmGlobalsSnapshot {
    fn from(s: web_js_core::GlobalsSnapshot) -> Self {
        WasmGlobalsSnapshot {
            variables: s.variables.into_iter().map(Into::into).collect(),
            execution_count: s.execution_count,
        }
    }
}

impl From<web_js_core::AsyncCommand> for WasmAsyncCommand {
    fn from(c: web_js_core::AsyncCommand) -> Self {
        WasmAsyncCommand {
            call_id: c.call_id,
            action: c.action,
            params: c.params,
            run_id: c.run_id,
        }
    }
}

impl From<web_js_core::RunResult> for CellResult {
    fn from(r: web_js_core::RunResult) -> Self {
        if let Some(error) = r.error {
            CellResult::Err {
                stdout: r.stdout,
                stderr: r.stderr,
                error: error.into(),
                execution_count: r.execution_count,
            }
        } else {
            CellResult::Ok {
                stdout: r.stdout,
                stderr: r.stderr,
                result: r.result,
                execution_count: r.execution_count,
            }
        }
    }
}

impl From<web_js_core::RunResult> for WasmRunResult {
    fn from(r: web_js_core::RunResult) -> Self {
        match r.status {
            web_js_core::CellStatus::AsyncPending => WasmRunResult::Pending {
                stdout: r.stdout,
                stderr: r.stderr,
                commands: r.commands,
                fuel_exhausted: r.fuel_exhausted,
                execution_count: r.execution_count,
                pending_commands: r.pending_commands.into_iter().map(Into::into).collect(),
            },
            web_js_core::CellStatus::Done => {
                if let Some(error) = r.error {
                    WasmRunResult::Err {
                        stdout: r.stdout,
                        stderr: r.stderr,
                        error: error.into(),
                        execution_count: r.execution_count,
                    }
                } else {
                    WasmRunResult::Ok {
                        stdout: r.stdout,
                        stderr: r.stderr,
                        result: r.result,
                        execution_count: r.execution_count,
                    }
                }
            }
        }
    }
}

impl From<WasmRunResult> for CellResult {
    fn from(r: WasmRunResult) -> Self {
        match r {
            WasmRunResult::Ok {
                stdout,
                stderr,
                result,
                execution_count,
            } => CellResult::Ok {
                stdout,
                stderr,
                result,
                execution_count,
            },
            WasmRunResult::Err {
                stdout,
                stderr,
                error,
                execution_count,
            } => CellResult::Err {
                stdout,
                stderr,
                error,
                execution_count,
            },
            WasmRunResult::Pending {
                stdout,
                stderr,
                execution_count,
                ..
            } => CellResult::Err {
                stdout,
                stderr,
                error: WasmCellError::Internal {
                    message: "Pending result converted to CellResult".into(),
                },
                execution_count,
            },
        }
    }
}
