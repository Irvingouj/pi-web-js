use serde::{Deserialize, Serialize};
use std::fmt;
use ts_rs::TS;

// ─── Error Types ────────────────────────────────────────────────

/// Structured error from running a cell.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export_to = "web/src/types/generated.ts")]
pub enum CellError {
    /// Syntax or parse error during compilation.
    Compile { message: String, line: Option<u32> },
    /// JavaScript runtime error (type mismatch, undefined access, etc.)
    Runtime { message: String, line: Option<u32> },
    /// Execution exceeded the time limit (likely an infinite loop).
    FuelExhausted,
    /// Internal error (Rust/WASM panic, unexpected state).
    Internal { message: String },
}

impl fmt::Display for CellError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CellError::Compile { message, line } => {
                if let Some(line) = line {
                    write!(f, "Compile error (line {}): {}", line, message)
                } else {
                    write!(f, "Compile error: {}", message)
                }
            }
            CellError::Runtime { message, line } => {
                if let Some(line) = line {
                    write!(f, "Runtime error (line {}): {}", line, message)
                } else {
                    write!(f, "Runtime error: {}", message)
                }
            }
            CellError::FuelExhausted => write!(f, "Execution stopped: time limit reached"),
            CellError::Internal { message } => write!(f, "Internal error: {}", message),
        }
    }
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
    #[ts(type = "string")]
    pub action: crate::action::Action,
    #[ts(type = "unknown")]
    pub params: serde_json::Value,
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
}

/// Result of running a single cell.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export_to = "web/src/types/generated.ts")]
pub struct RunResult {
    pub stdout: Vec<String>,
    pub stderr: Vec<String>,
    pub result: Option<String>,
    pub error: Option<CellError>,
    #[ts(type = "unknown[]")]
    pub commands: Vec<serde_json::Value>,
    pub fuel_exhausted: bool,
    pub execution_count: u32,
    pub status: CellStatus,
    pub pending_command: Option<AsyncCommand>,
}

impl RunResult {
    pub(crate) fn err(error: CellError, execution_count: u32) -> Self {
        Self {
            stdout: vec![],
            stderr: vec![],
            result: None,
            error: Some(error),
            commands: vec![],
            fuel_exhausted: false,
            execution_count,
            status: CellStatus::Done,
            pending_command: None,
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
            pending_command: None,
        }
    }

    pub(crate) fn async_pending(
        stdout: Vec<String>,
        command: AsyncCommand,
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
            pending_command: Some(command),
        }
    }
}
