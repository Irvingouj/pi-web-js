/// True when user cell code declares top-level `let`/`const` bindings.
pub(crate) fn cell_needs_isolation_wrap(code: &str) -> bool {
    code.lines().any(|line| {
        let trimmed = line.trim_start();
        trimmed.starts_with("let ")
            || trimmed.starts_with("const ")
            || trimmed.starts_with("let\t")
            || trimmed.starts_with("const\t")
    })
}

/// Wrap user cell code so top-level `let`/`const` can be re-run without global redeclaration errors.
pub(crate) fn wrap_user_cell_code(code: &str) -> String {
    format!("(async function __webJsCell() {{\n{}\n}})()", code)
}
