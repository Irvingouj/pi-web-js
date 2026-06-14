use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ─── Error Types ────────────────────────────────────────────────

/// Structured error from running a cell.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export_to = "web/src/types/generated.ts")]
pub enum CellError {
    /// Syntax or parse error during compilation.
    Compile {
        name: Option<String>,
        message: String,
        line: Option<u32>,
    },
    /// JavaScript runtime error (type mismatch, undefined access, etc.)
    Runtime {
        name: Option<String>,
        message: String,
        line: Option<u32>,
        action: Option<String>,
        code: Option<String>,
        stack: Option<String>,
    },
    /// Execution exceeded the time limit (likely an infinite loop).
    FuelExhausted,
    /// Internal error (Rust/WASM panic, unexpected state).
    Internal { message: String },
}

/// Status of a cell execution.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export_to = "web/src/types/generated.ts")]
pub enum CellStatus {
    Done,
    AsyncPending,
}

/// A single global variable observed by `inspect_globals`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export_to = "web/src/types/generated.ts")]
pub struct GlobalVariable {
    pub name: String,
    #[serde(rename = "type")]
    pub type_name: String,
    /// String representation of the value. Truncated for objects (keys only).
    pub value: Option<String>,
    /// For objects: list of key names/indices.
    pub keys: Option<Vec<String>>,
}

/// Snapshot of all JS globals.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export_to = "web/src/types/generated.ts")]
pub struct GlobalsSnapshot {
    pub variables: Vec<GlobalVariable>,
    pub execution_count: u32,
}

/// An async command yielded from JS, waiting for external resolution.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export_to = "web/src/types/generated.ts")]
pub struct AsyncCommand {
    pub call_id: u32,
    pub action: String,
    #[ts(type = "CommandParams")]
    pub params: serde_json::Value,
    pub run_id: Option<String>,
}

impl AsyncCommand {
    pub fn parse_params<T: serde::de::DeserializeOwned>(&self) -> Result<T, serde_json::Error> {
        serde_json::from_value(self.params.clone())
    }
}

/// Response to an async command, passed to resume_cell.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsyncResponse {
    pub ok: bool,
    pub value: Option<serde_json::Value>,
    pub error: Option<AsyncError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsyncError {
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

impl AsyncError {
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

/// Result of running a single cell.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export_to = "web/src/types/generated.ts")]
pub struct RunResult {
    pub stdout: Vec<String>,
    pub stderr: Vec<String>,
    pub result: Option<String>,
    pub error: Option<CellError>,
    #[ts(type = "CommandParams[]")]
    pub commands: Vec<serde_json::Value>,
    pub fuel_exhausted: bool,
    pub execution_count: u32,
    pub status: CellStatus,
    pub pending_commands: Vec<AsyncCommand>,
}

impl RunResult {
    pub(crate) fn err(error: CellError, execution_count: u32) -> Self {
        let fuel_exhausted = matches!(&error, CellError::FuelExhausted);
        Self {
            stdout: vec![],
            stderr: vec![],
            result: None,
            error: Some(error),
            commands: vec![],
            fuel_exhausted,
            execution_count,
            status: CellStatus::Done,
            pending_commands: vec![],
        }
    }

    pub(crate) fn with_partial_output(
        stdout: Vec<String>,
        stderr: Vec<String>,
        commands: Vec<serde_json::Value>,
        error: CellError,
        fuel_exhausted: bool,
        execution_count: u32,
    ) -> Self {
        Self {
            stdout,
            stderr,
            result: None,
            error: Some(error),
            commands,
            fuel_exhausted,
            execution_count,
            status: CellStatus::Done,
            pending_commands: vec![],
        }
    }

    pub(crate) fn async_pending(
        stdout: Vec<String>,
        commands: Vec<AsyncCommand>,
        execution_count: u32,
    ) -> Self {
        Self {
            stdout,
            stderr: vec![],
            result: None,
            error: None,
            commands: vec![],
            fuel_exhausted: false,
            execution_count,
            status: CellStatus::AsyncPending,
            pending_commands: commands,
        }
    }
}
