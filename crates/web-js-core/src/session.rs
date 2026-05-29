use crate::globals::register_host_globals;
use crate::state::HostState;
use crate::types::{
    AsyncCommand, AsyncResponse, CellError, CellStatus, GlobalVariable, GlobalsSnapshot, RunResult,
};
use crate::utils::{
    classify_js_error, clean_error_message, exception_to_string, extract_line_number, format_js_value,
};
use rquickjs::{Context, Ctx, Filter, Runtime, Value};
use rquickjs::context::EvalOptions;
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

// ─── Session Builder ────────────────────────────────────────────

/// Builder for creating a [`JsSession`] with custom configuration.
pub struct SessionBuilder {
    fuel_limit: u64,
    js_libraries: Vec<(String, String)>,
}

impl Default for SessionBuilder {
    fn default() -> Self {
        Self {
            fuel_limit: 50_000,
            js_libraries: Vec::new(),
        }
    }
}

impl SessionBuilder {
    /// Set the fuel limit (mapped to QuickJS interrupt-check iterations).
    pub fn fuel_limit(mut self, limit: u64) -> Self {
        self.fuel_limit = limit;
        self
    }

    /// Register a pure JS library by source code.
    /// The code will be executed during session initialization.
    pub fn js_library(mut self, name: &str, source: &str) -> Self {
        self.js_libraries
            .push((name.to_string(), source.to_string()));
        self
    }

    /// Build the session with the configured options.
    pub fn finish(self) -> JsSession {
        let rt = Runtime::new().expect("Failed to create QuickJS runtime");
        // Disable QuickJS stack-limit checks; WASM stack is managed by the host
        // and __builtin_frame_address(0) yields unreliable values in wasm32.
        rt.set_max_stack_size(0);
        let context = Context::full(&rt).expect("Failed to create QuickJS context");
        let host_state = Rc::new(RefCell::new(HostState::default()));

        context.with(|ctx| {
            register_host_globals(ctx.clone(), host_state.clone())
                .expect("register globals");
            crate::web::register_web_module(ctx.clone(), host_state.clone())
                .expect("register web module");
        });

        let mut session = JsSession {
            runtime: rt,
            context,
            execution_count: 0,
            fuel_limit: self.fuel_limit,
            host_state,
            fuel_counter: Arc::new(AtomicU64::new(0)),
        };

        // Load JS libraries (uses run_cell, so after session creation)
        for (_name, source) in &self.js_libraries {
            let _ = session.run_cell(source, "");
        }

        // Reset execution count after library loading so user cells start at 1
        session.execution_count = 0;

        session
    }
}

// ─── JsSession ──────────────────────────────────────────────────

/// A persistent JavaScript notebook session using QuickJS.
pub struct JsSession {
    runtime: Runtime,
    context: Context,
    execution_count: u32,
    fuel_limit: u64,
    host_state: Rc<RefCell<HostState>>,
    fuel_counter: Arc<AtomicU64>,
}

impl Default for JsSession {
    fn default() -> Self {
        Self::new()
    }
}

impl JsSession {
    /// Create a new notebook session with a fresh JS context.
    pub fn new() -> Self {
        Self::build().finish()
    }

    /// Create a new notebook session with a custom fuel limit.
    pub fn with_fuel_limit(fuel_limit: u64) -> Self {
        Self::build().fuel_limit(fuel_limit).finish()
    }

    /// Start building a session with custom configuration.
    pub fn build() -> SessionBuilder {
        SessionBuilder::default()
    }

    /// Run a closure with access to the underlying QuickJS context.
    pub fn with_context<F, R>(&self, f: F) -> R
    where
        F: FnOnce(Ctx) -> R,
    {
        self.context.with(f)
    }

    /// Set the fuel limit for execution.
    pub fn set_fuel_limit(&mut self, limit: u64) {
        self.fuel_limit = limit;
    }

    /// Get the current execution count.
    pub fn execution_count(&self) -> u32 {
        self.execution_count
    }

    /// Inspect all global variables in the current JS state.
    pub fn inspect_globals(&mut self) -> GlobalsSnapshot {
        self.context.with(|ctx| {
            let exec_count = self.execution_count;
            let mut variables = Vec::new();

            let global = ctx.globals();
            for key_res in global.own_keys::<String>(Filter::new().string()) {
                let name = match key_res {
                    Ok(k) => k,
                    Err(_) => continue,
                };
                if name.starts_with("__webJs") {
                    continue;
                }

                let value = match global.get::<_, Value>(name.as_str()) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                let type_name = if value.is_undefined() {
                    "undefined"
                } else if value.is_null() {
                    "null"
                } else if value.is_bool() {
                    "boolean"
                } else if value.is_number() {
                    "number"
                } else if value.is_string() {
                    "string"
                } else if value.is_symbol() {
                    "symbol"
                } else if value.is_big_int() {
                    "bigint"
                } else if value.is_function() {
                    "function"
                } else if value.is_object() {
                    "object"
                } else {
                    "unknown"
                };

                let (val_str, keys_opt) = if type_name == "object" && !value.is_null() {
                    if let Some(obj) = value.as_object() {
                        let obj_keys: Vec<String> = obj
                            .keys::<String>()
                            .filter_map(|k| k.ok())
                            .collect();
                        (None, Some(obj_keys))
                    } else {
                        (None, None)
                    }
                } else if type_name == "function" {
                    (None, None)
                } else {
                    let formatted = format_js_value(&value);
                    (Some(formatted), None)
                };

                variables.push(GlobalVariable {
                    name,
                    type_name: type_name.to_string(),
                    value: val_str,
                    keys: keys_opt,
                });
            }

            variables.sort_by(|a, b| a.name.cmp(&b.name));

            GlobalsSnapshot {
                variables,
                execution_count: exec_count,
            }
        })
    }

    /// Reset the session, clearing all JS state.
    pub fn reset(&mut self) {
        let rt = Runtime::new().expect("Failed to create QuickJS runtime");
        rt.set_max_stack_size(0);
        let context = Context::full(&rt).expect("Failed to create QuickJS context");
        let host_state = Rc::new(RefCell::new(HostState::default()));

        context.with(|ctx| {
            register_host_globals(ctx.clone(), host_state.clone())
                .expect("register globals");
            crate::web::register_web_module(ctx.clone(), host_state.clone())
                .expect("register web module");
        });

        self.runtime = rt;
        self.context = context;
        self.execution_count = 0;
        self.host_state = host_state;
    }

    /// Restore a pending async command that was yielded but not yet resolved.
    pub fn restore_pending_command(&mut self, cmd: AsyncCommand) {
        self.host_state.borrow_mut().pending_async_command = Some(cmd);
    }

    /// Run a cell of code.
    pub fn run_cell(&mut self, code: &str, stdin: &str) -> RunResult {
        // Reset host state for this run
        let stdin_lines: Vec<String> = stdin.lines().map(|l| l.to_string()).collect();
        {
            let mut hs = self.host_state.borrow_mut();
            hs.stdout.clear();
            hs.stderr.clear();
            hs.commands.clear();
            hs.stdin_lines = stdin_lines;
            hs.stdin_cursor = 0;
            hs.fuel_exhausted = false;
            hs.cell_errors.clear();
            hs.pending_async_command = None;
        }

        self.execution_count += 1;
        let exec_count = self.execution_count;
        let fuel_limit = self.fuel_limit;

        // Set up interrupt handler for fuel limit
        let fuel_counter = self.fuel_counter.clone();
        fuel_counter.store(fuel_limit, Ordering::Relaxed);
        self.runtime.set_interrupt_handler(Some(Box::new(move || {
            let remaining = fuel_counter.load(Ordering::Relaxed);
            if remaining == 0 {
                true
            } else {
                fuel_counter.fetch_sub(1, Ordering::Relaxed);
                false
            }
        })));

        let host_state = self.host_state.clone();

        let result = self.context.with(|ctx| {
            let mut eval_opts = EvalOptions::default();
            eval_opts.strict = false;
            eval_opts.promise = true;
            let eval_result = ctx.eval_with_options::<Value, _>(code, eval_opts);

            let result_val = match eval_result {
                Ok(val) => val,
                Err(e) => {
                    let hs = host_state.borrow();
                    let cell_err = if let rquickjs::Error::Exception = &e {
                        let msg = {
                            let exc = ctx.catch();
                            exception_to_string(&exc)
                        };
                        if msg.contains("interrupted") || msg.contains("InternalError") {
                            CellError::FuelExhausted
                        } else {
                            classify_js_error(&msg)
                        }
                    } else {
                        let msg = e.to_string();
                        classify_js_error(&msg)
                    };
                    return RunResult::with_partial_output(
                        hs.stdout.clone(),
                        hs.stderr.clone(),
                        hs.commands.clone(),
                        cell_err,
                        false,
                        exec_count,
                    );
                }
            };

            // Run job queue to process Promise microtasks
            while ctx.execute_pending_job() {}

            // Check for host async
            let pending = host_state.borrow().pending_async_command.clone();
            let log_msg = format!("[run_cell] pending_async_command: {:?}", pending);
            host_state.borrow_mut().stdout.push(log_msg);
            if let Some(cmd) = pending {
                let hs = host_state.borrow();
                let stdout_so_far = hs.stdout.clone();
                return RunResult::async_pending(stdout_so_far, cmd, exec_count);
            }

            let result_str = if result_val.is_undefined() || result_val.is_null() {
                None
            } else {
                Some(format_js_value(&result_val))
            };

            let hs = host_state.borrow();
            let error = if hs.fuel_exhausted {
                Some(CellError::FuelExhausted)
            } else {
                None
            };

            RunResult {
                stdout: hs.stdout.clone(),
                stderr: hs.stderr.clone(),
                result: result_str,
                error,
                commands: hs.commands.clone(),
                fuel_exhausted: hs.fuel_exhausted,
                execution_count: exec_count,
                status: CellStatus::Done,
                pending_command: None,
            }
        });

        // Clear interrupt handler after execution
        self.runtime.set_interrupt_handler(None);

        result
    }

    /// Resume a yielded cell with an async response.
    pub fn resume_cell(&mut self, result_json: &str) -> RunResult {
        let exec_count = self.execution_count;

        // Parse the async response
        let response: AsyncResponse = match serde_json::from_str(result_json) {
            Ok(r) => r,
            Err(e) => {
                return RunResult::err(
                    CellError::Internal {
                        message: format!("Invalid async response JSON: {}", e),
                    },
                    exec_count,
                );
            }
        };

        // Clear the pending command and get its call_id
        let call_id = {
            let mut hs = self.host_state.borrow_mut();
            let call_id = hs.pending_async_command.as_ref().map(|c| c.call_id);
            let log_msg = format!("[resume_cell] pending_async_command: {:?}, call_id: {:?}", hs.pending_async_command, call_id);
            hs.stdout.push(log_msg);
            hs.pending_async_command = None;
            call_id
        };

        let Some(call_id) = call_id else {
            return RunResult::err(
                CellError::Internal {
                    message: "No pending async command to resume".into(),
                },
                exec_count,
            );
        };

        let host_state = self.host_state.clone();

        let result = self.context.with(|ctx| {
            let js = if response.ok {
                let value_json = serde_json::to_string(&response.value.unwrap_or(serde_json::Value::Null))
                    .unwrap_or_else(|_| "null".to_string());
                format!(
                    "__webJsPending[{}].resolve({}); delete __webJsPending[{}];",
                    call_id, value_json, call_id
                )
            } else {
                let msg = response
                    .error
                    .as_ref()
                    .map(|e| e.message.clone())
                    .unwrap_or_else(|| "unknown async error".into());
                let msg_escaped = msg.replace('\\', "\\\\").replace('"', "\\\"");
                format!(
                    r#"__webJsPending[{}].reject(new Error("{}")); delete __webJsPending[{}];"#,
                    call_id, msg_escaped, call_id
                )
            };

            let mut resume_opts = EvalOptions::default();
            resume_opts.strict = false;
            resume_opts.promise = true;
            if let Err(e) = ctx.eval_with_options::<Value, _>(js.as_str(), resume_opts) {
                let hs = host_state.borrow();
                let msg = if let rquickjs::Error::Exception = &e {
                    let exc = ctx.catch();
                    exception_to_string(&exc)
                } else {
                    e.to_string()
                };
                let line = extract_line_number(&msg);
                return RunResult::with_partial_output(
                    hs.stdout.clone(),
                    hs.stderr.clone(),
                    hs.commands.clone(),
                    CellError::Runtime {
                        message: clean_error_message(&msg),
                        line,
                    },
                    false,
                    exec_count,
                );
            }

            while ctx.execute_pending_job() {}

            // Check for another pending async command (chained async)
            if host_state.borrow().pending_async_command.is_some() {
                let mut hs = host_state.borrow_mut();
                let cmd = hs.pending_async_command.take().unwrap();
                let stdout_so_far = hs.stdout.clone();
                return RunResult::async_pending(stdout_so_far, cmd, exec_count);
            }

            let hs = host_state.borrow();
            let error = if hs.fuel_exhausted {
                Some(CellError::FuelExhausted)
            } else {
                None
            };

            RunResult {
                stdout: hs.stdout.clone(),
                stderr: hs.stderr.clone(),
                result: None,
                error,
                commands: hs.commands.clone(),
                fuel_exhausted: hs.fuel_exhausted,
                execution_count: exec_count,
                status: CellStatus::Done,
                pending_command: None,
            }
        });

        result
    }
}
