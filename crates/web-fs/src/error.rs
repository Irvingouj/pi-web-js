use thiserror::Error;

/// Result type alias for filesystem operations.
pub type Result<T> = std::result::Result<T, FsError>;

/// Error type for OPFS filesystem operations.
#[derive(Debug, Error, Clone, PartialEq)]
pub enum FsError {
    #[error("E_NOT_FOUND")]
    NotFound,
    #[error("E_ALREADY_EXISTS")]
    AlreadyExists,
    #[error("E_NOT_FILE")]
    NotFile,
    #[error("E_NOT_DIRECTORY")]
    NotDirectory,
    #[error("E_DIRECTORY_NOT_EMPTY")]
    DirectoryNotEmpty,
    #[error("E_INVALID_PATH: {0}")]
    InvalidPath(String),
    #[error("E_INVALID_ENCODING")]
    InvalidEncoding,
    #[error("E_PERMISSION_DENIED")]
    PermissionDenied,
    #[error("E_OUT_OF_QUOTA")]
    OutOfQuota,
    #[error("E_IO: {0}")]
    Io(String),
}

impl FsError {
    /// Wire error code for WASM async responses.
    pub fn wire_code(&self) -> &'static str {
        match self {
            FsError::NotFound => "E_NOT_FOUND",
            FsError::AlreadyExists => "E_ALREADY_EXISTS",
            FsError::NotFile => "E_NOT_FILE",
            FsError::NotDirectory => "E_NOT_DIRECTORY",
            FsError::DirectoryNotEmpty => "E_DIRECTORY_NOT_EMPTY",
            FsError::InvalidPath(_) => "E_INVALID_PATH",
            FsError::InvalidEncoding => "E_INVALID_ENCODING",
            FsError::PermissionDenied => "E_PERMISSION_DENIED",
            FsError::OutOfQuota => "E_OUT_OF_QUOTA",
            FsError::Io(_) => "E_IO",
        }
    }

    /// Human-readable message for WASM async responses.
    pub fn wire_message(&self) -> String {
        match self {
            FsError::Io(msg) => msg.clone(),
            FsError::InvalidPath(ctx) => format!("E_INVALID_PATH: {}", ctx),
            _ => self.wire_code().to_string(),
        }
    }
}
