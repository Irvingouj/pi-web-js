#[cfg(test)]
mod tests {
    use crate::JsSession;

    #[test]
    fn test_run_cell_print() {
        let mut session = JsSession::new();
        let result = session.run_cell("print(1)", "");
        println!("{:?}", result);
        assert!(result.error.is_none());
    }
}
