use crate::async_resume::resume_async_pending;
use crate::cell_wrap::wrap_user_cell_code;
use crate::error::{
    cell_error_from_exception, cell_error_from_rquickjs_error, drain_pending_jobs,
    exception_to_string, fuel_depleted, fuel_exhausted_flag_for,
};
use crate::globals::register_host_globals;
use crate::js_value::format_js_value;
use crate::state::HostState;
use crate::types::{
    AsyncCommand, AsyncResponse, CellError, CellStatus, GlobalVariable, GlobalsSnapshot, RunResult,
};
use rquickjs::context::EvalOptions;
use rquickjs::promise::PromiseState as QjsPromiseState;
use rquickjs::{Context, Ctx, Filter, Runtime, Value};
use std::cell::{Cell as StdCell, RefCell};
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

// ─── Session Builder ────────────────────────────────────────────

/// Builder for creating a [`JsSession`] with custom configuration.
pub struct SessionBuilder {
    fuel_limit: u64,
    js_libraries: Vec<(String, String)>,
    allow_user_eval: bool,
}

impl Default for SessionBuilder {
    fn default() -> Self {
        Self {
            fuel_limit: 50_000,
            js_libraries: Vec::new(),
            allow_user_eval: false,
        }
    }
}

impl SessionBuilder {
    /// Set the fuel limit (mapped to QuickJS interrupt-check iterations).
    pub fn fuel_limit(mut self, limit: u64) -> Self {
        self.fuel_limit = limit;
        self
    }

    /// Allow user-facing `eval()` in the QuickJS runtime (extension context only).
    pub fn allow_user_eval(mut self, allow: bool) -> Self {
        self.allow_user_eval = allow;
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
            register_host_globals(ctx.clone(), host_state.clone(), self.allow_user_eval)
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
            needs_reset: false,
            allow_user_eval: self.allow_user_eval,
        };

        // Load JS libraries into global scope (unwrapped — libraries define shared helpers).
        for (_name, source) in &self.js_libraries {
            let _ = session.run_cell_unwrapped(source, "");
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
    needs_reset: bool,
    allow_user_eval: bool,
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
            QjsPromiseState::Resolved => match p.result::<Value>() {
                Some(Ok(val)) => PromiseState::Fulfilled(val),
                _ => PromiseState::Pending,
            },
            QjsPromiseState::Rejected => {
                // rquickjs surfaces rejections as thrown exceptions; read via catch().
                let _ = p.result::<Value>();
                let exc = ctx.catch();
                let exc_msg = exception_to_string(&exc);
                tracing::error!("[check_promise_state] Promise rejected: {}", exc_msg);
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
                        let obj_keys: Vec<String> =
                            obj.keys::<String>().filter_map(|k| k.ok()).collect();
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
    /// If called during execution, the reset is deferred until the next run_cell.
    pub fn reset(&mut self) {
        self.needs_reset = true;
    }

    /// Reset the session immediately, creating a fresh JS context.
    pub fn reset_now(&mut self) {
        self.perform_reset();
    }

    fn perform_reset(&mut self) {
        let rt = Runtime::new().expect("Failed to create QuickJS runtime");
        rt.set_max_stack_size(0);
        let context = Context::full(&rt).expect("Failed to create QuickJS context");
        let host_state = Rc::new(RefCell::new(HostState::default()));

        context.with(|ctx| {
            register_host_globals(ctx.clone(), host_state.clone(), self.allow_user_eval)
                .expect("register globals");
            crate::web::register_web_module(ctx.clone(), host_state.clone())
                .expect("register web module");
        });

        self.runtime = rt;
        self.context = context;
        self.execution_count = 0;
        self.host_state = host_state;
        self.fuel_counter = Arc::new(AtomicU64::new(0));
        self.needs_reset = false;
        tracing::info!("perform_reset_done");
    }

    /// Run a user cell. Every user cell is wrapped in `(async function __webJsCell(){...})()`
    /// so eval never uses QuickJS top-level-await (`promise: true`), which recursively
    /// resumes async on wasm32 until the host stack overflows. The wrapper also keeps
    /// top-level `let`/`const` in a fresh scope so cells can be re-run safely.
    pub fn run_cell(&mut self, code: &str, stdin: &str) -> RunResult {
        let wrapped = wrap_user_cell_code(code);
        tracing::trace!(
            code_len = code.len(),
            wrapped_len = wrapped.len(),
            "run_cell_wrapped"
        );
        self.run_cell_unwrapped(&wrapped, stdin)
    }

    /// Run code directly in the global QuickJS scope (library load, binding injection).
    pub fn run_cell_unwrapped(&mut self, code: &str, stdin: &str) -> RunResult {
        if self.needs_reset {
            self.perform_reset();
        }

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
            hs.async_call_counter = 0;
        }

        self.execution_count += 1;
        let exec_count = self.execution_count;
        let fuel_limit = self.fuel_limit;

        // Set up interrupt handler for fuel limit
        let fuel_counter = self.fuel_counter.clone();
        let fuel_counter_for_handler = fuel_counter.clone();
        fuel_counter_for_handler.store(fuel_limit, Ordering::Relaxed);
        self.runtime.set_interrupt_handler(Some(Box::new(move || {
            let remaining = fuel_counter_for_handler.load(Ordering::Relaxed);
            if remaining == 0 {
                true
            } else {
                fuel_counter_for_handler.fetch_sub(1, Ordering::Relaxed);
                false
            }
        })));

        let host_state = self.host_state.clone();

        let result = self.context.with(|ctx| {
            tracing::trace!(code_len = code.len(), execution_count = exec_count, "eval_start");
            // Clear stale pending async from previous runs
            if ctx.eval::<Value, _>("if (typeof __webJsPending !== 'undefined') { Object.keys(__webJsPending).forEach(k => delete __webJsPending[k]); } if (typeof __webJsTopPromise !== 'undefined') { delete __webJsTopPromise; }").is_err() {
                let _ = ctx.catch();
            }

            let mut eval_opts = EvalOptions::default();
            eval_opts.global = true;
            eval_opts.strict = false;
            // Do NOT set promise=true. User async runs inside __webJsCell wrapper;
            // TLA eval flag recursively drives async resume on wasm32 until stack overflow.
            eval_opts.promise = false;
            let eval_result = ctx.eval_with_options::<Value, _>(code, eval_opts);
            tracing::trace!(is_ok = eval_result.is_ok(), "eval_with_options_done");

            let result_val = match eval_result {
                Ok(val) => val,
                Err(e) => {
                    let hs = host_state.borrow();
                    let cell_err = cell_error_from_rquickjs_error(&ctx, e);
                    tracing::error!(execution_count = exec_count, "eval_error");
                    return RunResult::with_partial_output(
                        hs.stdout.clone(),
                        hs.stderr.clone(),
                        hs.commands.clone(),
                        cell_err.clone(),
                        fuel_exhausted_flag_for(&cell_err, &fuel_counter),
                        exec_count,
                    );
                }
            };

            // Store the top-level result for Promise state checking in resume_cell
            let _ = ctx.globals().set("__webJsTopPromise", result_val.clone());
            tracing::trace!("stored_top_promise");

            if let Some(fuel_err) = drain_pending_jobs(&ctx, &fuel_counter) {
                let hs = host_state.borrow();
                return RunResult::with_partial_output(
                    hs.stdout.clone(),
                    hs.stderr.clone(),
                    hs.commands.clone(),
                    fuel_err,
                    true,
                    exec_count,
                );
            }
            tracing::trace!("execute_pending_job_done");

            const MAX_PROMISE_SETTLE: u32 = 4096;
            let mut final_val = result_val;
            let mut settle_iters = 0u32;
            while final_val.is_promise() && settle_iters < MAX_PROMISE_SETTLE {
                settle_iters += 1;
                match check_promise_state(ctx.clone(), &final_val) {
                    PromiseState::Fulfilled(val) => {
                        final_val = val;
                        break;
                    }
                    PromiseState::Rejected(err) => {
                        let msg = exception_to_string(&err);
                        tracing::error!(execution_count = exec_count, error = %msg, "top_level_promise_rejected");
                        let hs = host_state.borrow();
                        let cell_err = cell_error_from_exception(&err);
                        return RunResult::with_partial_output(
                            hs.stdout.clone(),
                            hs.stderr.clone(),
                            hs.commands.clone(),
                            cell_err.clone(),
                            fuel_exhausted_flag_for(&cell_err, &fuel_counter),
                            exec_count,
                        );
                    }
                    PromiseState::Pending => {
                        let pending: Vec<AsyncCommand> = host_state
                            .borrow_mut()
                            .pending_async_commands
                            .drain(..)
                            .collect();
                        if !pending.is_empty() {
                            let hs = host_state.borrow();
                            tracing::trace!(
                                execution_count = exec_count,
                                pending_count = pending.len(),
                                "returning_async_pending_from_top_promise"
                            );
                            return RunResult::async_pending(hs.stdout.clone(), pending, exec_count);
                        }
                        if !ctx.execute_pending_job() {
                            break;
                        }
                        if let Some(fuel_err) = drain_pending_jobs(&ctx, &fuel_counter) {
                            let hs = host_state.borrow();
                            return RunResult::with_partial_output(
                                hs.stdout.clone(),
                                hs.stderr.clone(),
                                hs.commands.clone(),
                                fuel_err,
                                true,
                                exec_count,
                            );
                        }
                    }
                }
            }

            let pending: Vec<AsyncCommand> = host_state
                .borrow_mut()
                .pending_async_commands
                .drain(..)
                .collect();
            tracing::trace!(pending_count = pending.len(), "pending_async_count");
            if !pending.is_empty() {
                let hs = host_state.borrow();
                tracing::trace!(execution_count = exec_count, "returning_async_pending");
                return RunResult::async_pending(hs.stdout.clone(), pending, exec_count);
            }

            if final_val.is_promise() {
                let hs = host_state.borrow();
                if fuel_depleted(&fuel_counter) {
                    return RunResult::with_partial_output(
                        hs.stdout.clone(),
                        hs.stderr.clone(),
                        hs.commands.clone(),
                        CellError::FuelExhausted,
                        true,
                        exec_count,
                    );
                }
                return RunResult::with_partial_output(
                    hs.stdout.clone(),
                    hs.stderr.clone(),
                    hs.commands.clone(),
                    CellError::Runtime {
                        name: None,
                        message: "Promise is still pending after execution".into(),
                        line: None,
                        action: None,
                        code: None,
                        stack: None,
                    },
                    false,
                    exec_count,
                );
            }

            // Unwrap Promise result if needed
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
            let fuel_exhausted = fuel_depleted(&fuel_counter);
            let error = if fuel_exhausted {
                Some(CellError::FuelExhausted)
            } else {
                None
            };

            tracing::debug!(has_result = result_str.is_some(), execution_count = exec_count, "run_cell_done");
            RunResult {
                stdout: hs.stdout.clone(),
                stderr: hs.stderr.clone(),
                result: result_str,
                error,
                commands: hs.commands.clone(),
                fuel_exhausted,
                execution_count: exec_count,
                status: CellStatus::Done,
                pending_commands: vec![],
            }
        });

        // Clear interrupt handler after execution
        self.runtime.set_interrupt_handler(None);
        tracing::info!("run_cell_end");
        result
    }

    /// Resume a yielded cell with an async response.
    pub fn resume_cell(&mut self, call_id: u32, result_json: &str) -> RunResult {
        let exec_count = self.execution_count;
        tracing::trace!(call_id, execution_count = exec_count, "resume_enter");

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
        let reset_after_internal_resume_error = Rc::new(StdCell::new(false));
        let reset_after_internal_resume_error_for_ctx = reset_after_internal_resume_error.clone();

        // Set up interrupt handler for fuel limit
        let fuel_counter = self.fuel_counter.clone();
        let fuel_counter_for_handler = fuel_counter.clone();
        let fuel_limit = self.fuel_limit;
        fuel_counter_for_handler.store(fuel_limit, Ordering::Relaxed);
        self.runtime.set_interrupt_handler(Some(Box::new(move || {
            let remaining = fuel_counter_for_handler.load(Ordering::Relaxed);
            if remaining == 0 {
                true
            } else {
                fuel_counter_for_handler.fetch_sub(1, Ordering::Relaxed);
                false
            }
        })));

        let result = self.context.with(|ctx| {
            let resume_result = resume_async_pending(&ctx, call_id, &response);
            if let Err(e) = resume_result {
                reset_after_internal_resume_error_for_ctx.set(true);
                let hs = host_state.borrow();
                let cell_err = cell_error_from_rquickjs_error(&ctx, e);
                tracing::error!(call_id, error = %cell_err, "resume_pending_error");
                return RunResult::with_partial_output(
                    hs.stdout.clone(),
                    hs.stderr.clone(),
                    hs.commands.clone(),
                    cell_err.clone(),
                    fuel_exhausted_flag_for(&cell_err, &fuel_counter),
                    exec_count,
                );
            }

            if let Some(fuel_err) = drain_pending_jobs(&ctx, &fuel_counter) {
                let hs = host_state.borrow();
                return RunResult::with_partial_output(
                    hs.stdout.clone(),
                    hs.stderr.clone(),
                    hs.commands.clone(),
                    fuel_err,
                    true,
                    exec_count,
                );
            }

            // Check for NEW pending commands generated by the resolve
            let new_pending: Vec<AsyncCommand> = host_state
                .borrow_mut()
                .pending_async_commands
                .drain(..)
                .collect();

            // Check if there are still unresolved promises in QuickJS
            let has_remaining: bool = ctx
                .eval::<bool, _>("Object.keys(__webJsPending).length > 0")
                .unwrap_or(false);

            if has_remaining || !new_pending.is_empty() {
                let hs = host_state.borrow();
                return RunResult::async_pending(hs.stdout.clone(), new_pending, exec_count);
            }

            // Check top-level Promise state for unhandled rejections / in-flight wrapper
            let top_promise = ctx.globals().get::<_, Value>("__webJsTopPromise").ok();
            if let Some(promise) = top_promise {
                if promise.is_promise() {
                    match check_promise_state(ctx.clone(), &promise) {
                        PromiseState::Rejected(err) => {
                            let msg = exception_to_string(&err);
                            tracing::error!(call_id, error = %msg, "resume_top_level_promise_rejected");
                            let hs = host_state.borrow();
                            let cell_err = cell_error_from_exception(&err);
                            return RunResult::with_partial_output(
                                hs.stdout.clone(),
                                hs.stderr.clone(),
                                hs.commands.clone(),
                                cell_err.clone(),
                                fuel_exhausted_flag_for(&cell_err, &fuel_counter),
                                exec_count,
                            );
                        }
                        PromiseState::Pending => {
                            if let Some(fuel_err) = drain_pending_jobs(&ctx, &fuel_counter) {
                                let hs = host_state.borrow();
                                return RunResult::with_partial_output(
                                    hs.stdout.clone(),
                                    hs.stderr.clone(),
                                    hs.commands.clone(),
                                    fuel_err,
                                    true,
                                    exec_count,
                                );
                            }
                            let pending_after_drain: Vec<AsyncCommand> = host_state
                                .borrow_mut()
                                .pending_async_commands
                                .drain(..)
                                .collect();
                            let has_js_pending: bool = ctx
                                .eval::<bool, _>(
                                    "typeof __webJsPending !== 'undefined' && Object.keys(__webJsPending).length > 0",
                                )
                                .unwrap_or(false);
                            if has_js_pending || !pending_after_drain.is_empty() {
                                let hs = host_state.borrow();
                                return RunResult::async_pending(
                                    hs.stdout.clone(),
                                    pending_after_drain,
                                    exec_count,
                                );
                            }
                        }
                        PromiseState::Fulfilled(_) => {}
                    }
                }
            }

            let hs = host_state.borrow();
            let fuel_exhausted = fuel_depleted(&fuel_counter);
            let error = if fuel_exhausted {
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
                fuel_exhausted,
                execution_count: exec_count,
                status: CellStatus::Done,
                pending_commands: vec![],
            }
        });

        // Clear interrupt handler after execution
        self.runtime.set_interrupt_handler(None);
        if reset_after_internal_resume_error.get() {
            self.needs_reset = true;
        }

        tracing::trace!(call_id, status = ?result.status, "resume_exit");
        result
    }
}
