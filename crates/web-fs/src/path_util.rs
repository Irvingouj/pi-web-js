use crate::{FsError, Result};

#[cfg_attr(not(target_family = "wasm"), allow(dead_code))]
const RELATIVE_ANCHOR: &str = "/";

#[cfg_attr(not(target_family = "wasm"), allow(dead_code))]
pub(crate) fn path_parts(path: &std::path::Path) -> Result<Vec<String>> {
    if path.as_os_str().is_empty() {
        return Err(FsError::InvalidPath("path is empty".to_string()));
    }

    let anchored: std::path::PathBuf;
    let effective: &std::path::Path = if path.has_root() {
        path
    } else {
        anchored = std::path::PathBuf::from(RELATIVE_ANCHOR).join(path);
        &anchored
    };

    let mut parts = Vec::new();
    for comp in effective.components() {
        match comp {
            std::path::Component::RootDir => {}
            std::path::Component::Normal(s) => {
                let s = s.to_str().ok_or_else(|| {
                    FsError::InvalidPath(format!("non-UTF8 component in {}", path.display()))
                })?;
                if s == ".." {
                    return Err(FsError::InvalidPath(format!(
                        "parent traversal (..) not allowed in {}",
                        path.display()
                    )));
                }
                if s == "." || s.is_empty() {
                    continue;
                }
                parts.push(s.to_string());
            }
            _ => {
                return Err(FsError::InvalidPath(format!(
                    "unsupported component in {}",
                    path.display()
                )))
            }
        }
    }
    Ok(parts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn parts(input: &str) -> Result<Vec<String>> {
        path_parts(Path::new(input))
    }

    #[test]
    fn absolute_path_passes_through() {
        assert_eq!(parts("/foo/bar.txt").unwrap(), vec!["foo", "bar.txt"]);
    }

    #[test]
    fn relative_path_resolves_to_root() {
        assert_eq!(parts("bar.txt").unwrap(), vec!["bar.txt"]);
        assert_eq!(parts("sub/bar.txt").unwrap(), vec!["sub", "bar.txt"]);
    }

    #[test]
    fn dot_segments_are_skipped() {
        assert_eq!(parts("./foo.txt").unwrap(), vec!["foo.txt"]);
    }

    #[test]
    fn parent_traversal_is_rejected() {
        assert!(parts("../foo.txt").is_err());
        assert!(parts("/foo/../bar").is_err());
    }

    #[test]
    fn empty_path_is_rejected() {
        assert!(parts("").is_err());
    }

    #[test]
    fn root_path_yields_empty_parts() {
        assert_eq!(parts("/").unwrap(), Vec::<String>::new());
    }
}
