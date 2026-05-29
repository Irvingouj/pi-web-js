use crate::types::{AsyncCommand, CellError};

/// Internal state shared between JS closures and the host.
#[derive(Debug, Default)]
pub struct HostState {
    pub(crate) stdout: Vec<String>,
    pub(crate) stderr: Vec<String>,
    pub(crate) commands: Vec<serde_json::Value>,
    pub(crate) stdin_lines: Vec<String>,
    pub(crate) stdin_cursor: usize,
    pub(crate) fuel_exhausted: bool,
    pub(crate) cell_errors: Vec<CellError>,
    /// When a callback yields for async, it stores the command here.
    pub(crate) pending_async_command: Option<AsyncCommand>,
    /// Monotonic counter for async call IDs.
    pub(crate) async_call_counter: u32,
}
