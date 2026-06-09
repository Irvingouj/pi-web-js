/// Wrap every user cell in a per-run async function scope.
///
/// - Avoids QuickJS top-level-await eval mode (`promise: true`), which can recurse
///   async resume on wasm32 until stack overflow.
/// - Keeps top-level `let`/`const` in a fresh scope so the same cell can be re-run.
/// - Preserves notebook result semantics by implicitly returning the last expression-like line.
pub(crate) fn wrap_user_cell_code(code: &str) -> String {
    let trimmed = code.trim_end();
    if trimmed.is_empty() {
        return "(async function __webJsCell() {\n})()".to_string();
    }

    let body = match split_last_line(trimmed) {
        Some((head, last)) if !head.is_empty() => {
            if should_implicit_return(last) {
                format!("{head}\nreturn {last}")
            } else {
                trimmed.to_string()
            }
        }
        _ => {
            if should_implicit_return(trimmed) {
                format!("return {trimmed}")
            } else {
                trimmed.to_string()
            }
        }
    };

    format!("(async function __webJsCell() {{\n{body}\n}})()")
}

fn split_last_line(code: &str) -> Option<(&str, &str)> {
    code.rsplit_once('\n')
        .map(|(head, last)| (head, last.trim_end()))
}

fn should_implicit_return(line: &str) -> bool {
    let line = line.trim();
    if line.is_empty() {
        return false;
    }
    if line.starts_with("return") {
        return false;
    }
    const STMT_PREFIXES: &[&str] = &[
        "let ",
        "const ",
        "var ",
        "if ",
        "for ",
        "while ",
        "do ",
        "switch ",
        "try ",
        "catch ",
        "finally ",
        "throw ",
        "await ",
        "function ",
        "class ",
        "import ",
        "export ",
        "debugger",
        "break",
        "continue",
    ];
    if STMT_PREFIXES.iter().any(|prefix| line.starts_with(prefix)) {
        return false;
    }
    if line.starts_with('}') || line.ends_with('{') || line == "}" || line.ends_with("};") {
        return false;
    }
    if line.starts_with("print(") || line.starts_with("console.log(") {
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wraps_user_goto_extract_cell() {
        let code = "await page.goto(\"https://example.com\")\nlet result = await page.extract([\"title\", \"url\"])\nconsole.log(result)";
        let wrapped = wrap_user_cell_code(code);
        assert!(wrapped.contains("async function __webJsCell"));
        assert!(wrapped.contains("await page.goto"));
        assert!(wrapped.contains("console.log(result)"));
        assert!(!wrapped.contains("return console.log(result)"));
    }

    #[test]
    fn wraps_bare_await_cell() {
        let code = "await web.sleep(100)\nprint(\"done\")";
        let wrapped = wrap_user_cell_code(code);
        assert!(wrapped.starts_with("(async function __webJsCell()"));
        assert!(wrapped.ends_with("})()"));
        assert!(wrapped.contains("print(\"done\")"));
        assert!(!wrapped.contains("return print(\"done\")"));
    }

    #[test]
    fn implicit_return_for_single_line_expression() {
        let wrapped = wrap_user_cell_code("1 + 1");
        assert!(wrapped.contains("return 1 + 1"));
    }

    #[test]
    fn implicit_return_for_const_then_use() {
        let wrapped = wrap_user_cell_code("const x = 1;\nx");
        assert!(wrapped.contains("return x"));
    }

    #[test]
    fn wraps_sync_cells_too() {
        let code = "print(1 + 1);";
        assert!(wrap_user_cell_code(code).contains("print(1 + 1);"));
    }

    #[test]
    fn multiline_print_closing_line_is_not_implicit_return() {
        let code = "print(JSON.stringify({\n  ok: true,\n}));";
        let wrapped = wrap_user_cell_code(code);
        assert!(!wrapped.contains("return }));"));
        assert!(wrapped.contains("}));"));
    }
}
