use crate::globals::register_host_globals;
use crate::state::HostState;
use crate::types::{
    AsyncCommand, AsyncResponse, CellError, CellStatus, GlobalVariable, GlobalsSnapshot, RunResult,
};
use crate::utils::{
    classify_js_error, clean_error_message, exception_to_string, extract_line_number, format_js_value,
};
use rquickjs::{Context, Ctx, Filter, Runtime, Value};
use rquickjs::promise::PromiseState as QjsPromiseState;
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

enum PromiseState<'js> {
    Pending,
    Fulfilled(Value<'js>),
    Rejected(Value<'js>),
}

fn check_promise_state<'js>(ctx: Ctx<'js>, promise: &Value<'js>) -> PromiseState<'js> {
    if let Some(p) = promise.as_promise() {
        match p.state() {
            QjsPromiseState::Pending => PromiseState::Pending,
            QjsPromiseState::Resolved => {
                match p.result::<Value>() {
                    Some(Ok(val)) => PromiseState::Fulfilled(val),
                    _ => PromiseState::Pending,
                }
            }
            QjsPromiseState::Rejected => {
                // result() throws the rejection reason as an exception
                let _ = p.result::<Value>();
                let exc = ctx.catch();
                PromiseState::Rejected(exc)
            }
        }
    } else {
        PromiseState::Fulfilled(promise.clone())
    }
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
        self.fuel_counter = Arc::new(AtomicU64::new(0));
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
            hs.pending_async_commands.clear();
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
            // Clear stale pending async from previous runs
            let _ = ctx.eval::<Value, _>("if (typeof __webJsPending !== 'undefined') { Object.keys(__webJsPending).forEach(k => delete __webJsPending[k]); } if (typeof __webJsTopPromise !== 'undefined') { delete __webJsTopPromise; }");

            let mut eval_opts = EvalOptions::default();
            eval_opts.global = true;
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

            // Store the top-level result for Promise state checking in resume_cell
            let _ = ctx.globals().set("__webJsTopPromise", result_val.clone());

            // Run job queue to process Promise microtasks
            while ctx.execute_pending_job() {}

            // Check for host async first
            let pending: Vec<AsyncCommand> = host_state.borrow_mut().pending_async_commands.drain(..).collect();
            if !pending.is_empty() {
                let hs = host_state.borrow();
                return RunResult::async_pending(hs.stdout.clone(), pending, exec_count);
            }

            // Unwrap Promise result if needed
            let mut final_val = result_val;
            if final_val.is_promise() {
                let ctx2 = ctx.clone();
                match check_promise_state(ctx, &final_val) {
                    PromiseState::Fulfilled(val) => {
                        final_val = val;
                    }
                    PromiseState::Rejected(err) => {
                        let msg = exception_to_string(&err);
                        let line = extract_line_number(&msg);
                        let hs = host_state.borrow();
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
                    PromiseState::Pending => {
                        let hs = host_state.borrow();
                        return RunResult::with_partial_output(
                            hs.stdout.clone(),
                            hs.stderr.clone(),
                            hs.commands.clone(),
                            CellError::Runtime {
                                message: "Promise is still pending after execution".into(),
                                line: None,
                            },
                            false,
                            exec_count,
                        );
                    }
                }
            }

            // QuickJS async eval wraps the completion value in {value: ...}
            if let Some(obj) = final_val.as_object() {
                if let Ok(val) = obj.get::<_, Value>("value") {
                    final_val = val;
                }
            }

            let result_str = if final_val.is_undefined() || final_val.is_null() {
                None
            } else {
                Some(format_js_value(&final_val))
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
                pending_commands: vec![],
            }
        });

        // Clear interrupt handler after execution
        self.runtime.set_interrupt_handler(None);

        result
    }

    /// Resume a yielded cell with an async response.
    pub fn resume_cell(&mut self, call_id: u32, result_json: &str) -> RunResult {
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

        let host_state = self.host_state.clone();

        // Set up interrupt handler for fuel limit
        let fuel_counter = self.fuel_counter.clone();
        let fuel_limit = self.fuel_limit;
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

        let result = self.context.with(|ctx| {
            let mut resume_opts = EvalOptions::default();
            resume_opts.global = true;
            resume_opts.strict = false;
            resume_opts.promise = true;
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
                let msg_escaped = msg.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "\\r").replace('\t', "\\t");
                format!(
                    r#"__webJsPending[{}].reject(new Error("{}")); delete __webJsPending[{}];"#,
                    call_id, msg_escaped, call_id
                )
            };
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

            // Check for NEW pending commands generated by the resolve
            let new_pending: Vec<AsyncCommand> = host_state.borrow_mut().pending_async_commands.drain(..).collect();

            // Check if there are still unresolved promises in QuickJS
            let has_remaining: bool = ctx.eval::<bool, _>("Object.keys(__webJsPending).length > 0").unwrap_or(false);

            if has_remaining || !new_pending.is_empty() {
                let hs = host_state.borrow();
                return RunResult::async_pending(hs.stdout.clone(), new_pending, exec_count);
            }

            // Check top-level Promise state for unhandled rejections
            let top_promise = ctx.globals().get::<_, Value>("__webJsTopPromise").ok();
            if let Some(promise) = top_promise {
                if promise.is_promise() {
                    match check_promise_state(ctx, &promise) {
                        PromiseState::Rejected(err) => {
                            let msg = exception_to_string(&err);
                            let line = extract_line_number(&msg);
                            let hs = host_state.borrow();
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
                        _ => {}
                    }
                }
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
                pending_commands: vec![],
            }
        });

        // Clear interrupt handler after execution
        self.runtime.set_interrupt_handler(None);

        result
    }
}
