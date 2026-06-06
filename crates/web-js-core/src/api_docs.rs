use serde::ser::SerializeStruct;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use tsify::Tsify;
use wasm_bindgen::prelude::*;

use crate::handler_registry::Handler;
use crate::types::{AsyncCommand, AsyncResponse};

// Each action occupies one registry record. Production registration inserts
// metadata and its non-serializable executable handler together.

/// How the API is invoked across the JS/Rust boundary.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum ToolTransport {
    Async,
    Sync,
    Event,
}

/// Where the API implementation lives.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum ToolSource {
    RustCore,
    JsPrelude,
    Extension,
}

/// Documentation entry for a single JS API.
#[derive(Clone, Debug)]
pub struct JsApiDoc {
    pub namespace: String,
    pub name: String,
    pub action: Option<String>,
    pub description: String,
    pub params: Vec<ParamDoc>,
    pub returns: ReturnDoc,
    /// Fully-qualified public name shown to users (e.g. `browser.navigate`).
    pub public_name: String,
    /// Local binding name inside the JS runtime, if different from `name`.
    pub local_name: Option<String>,
    /// Whether the API is async, sync, or event-driven.
    pub transport: ToolTransport,
    /// Origin of the implementation (Rust core, JS prelude, or extension).
    pub tool_source: ToolSource,
    /// Field names for positional arg normalization in makeAsync.
    /// e.g. `["duration"]` for `web.sleep(1000)` → `{duration: 1000}`
    pub fields: Option<Vec<String>>,
}

impl Serialize for JsApiDoc {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut state = serializer.serialize_struct("JsApiDoc", 11)?;
        state.serialize_field("namespace", &self.namespace)?;
        state.serialize_field("name", &self.name)?;
        state.serialize_field("action", &self.action)?;
        state.serialize_field("description", &self.description)?;
        state.serialize_field("params", &self.params)?;
        state.serialize_field("returns", &self.returns)?;
        let source = match self.tool_source {
            ToolSource::RustCore => "rust_core",
            ToolSource::JsPrelude => "js_prelude",
            ToolSource::Extension => "extension",
        };
        state.serialize_field("source", &source)?;
        state.serialize_field("public_name", &self.public_name)?;
        state.serialize_field("local_name", &self.local_name)?;
        state.serialize_field("transport", &self.transport)?;
        state.serialize_field("tool_source", &self.tool_source)?;
        state.serialize_field("fields", &self.fields)?;
        state.end()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ParamDoc {
    pub name: String,
    #[serde(rename = "type")]
    pub js_type: String,
    pub required: bool,
    pub description: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReturnDoc {
    #[serde(rename = "type")]
    pub js_type: String,
    pub description: String,
}

/// Backward-compatible alias for an API.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ApiAlias {
    pub namespace: String,
    pub name: String,
    pub fields: Option<Vec<String>>,
}

/// Executable handler for an API action.
#[derive(Clone)]
pub enum ApiHandler {
    Rust(Handler),
    JsCallback(JsValue),
}

impl std::fmt::Debug for ApiHandler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ApiHandler::Rust(_) => write!(f, "ApiHandler::Rust(...)"),
            ApiHandler::JsCallback(_) => write!(f, "ApiHandler::JsCallback(...)"),
        }
    }
}

/// Full manifest entry for a single public API.
#[derive(Clone, Debug)]
pub struct ApiManifestEntry {
    pub namespace: String,
    pub name: String,
    pub action: Option<String>,
    pub description: String,
    pub params: Vec<ParamDoc>,
    pub returns: ReturnDoc,
    pub public_name: String,
    pub local_name: Option<String>,
    pub transport: ToolTransport,
    pub tool_source: ToolSource,
    pub fields: Option<Vec<String>>,
    pub aliases: Vec<ApiAlias>,
}

impl From<JsApiDoc> for ApiManifestEntry {
    fn from(doc: JsApiDoc) -> Self {
        Self {
            namespace: doc.namespace,
            name: doc.name,
            action: doc.action,
            description: doc.description,
            params: doc.params,
            returns: doc.returns,
            public_name: doc.public_name,
            local_name: doc.local_name,
            transport: doc.transport,
            tool_source: doc.tool_source,
            fields: doc.fields,
            aliases: vec![],
        }
    }
}

impl From<ApiManifestEntry> for JsApiDoc {
    fn from(entry: ApiManifestEntry) -> Self {
        Self {
            namespace: entry.namespace,
            name: entry.name,
            action: entry.action,
            description: entry.description,
            params: entry.params,
            returns: entry.returns,
            public_name: entry.public_name,
            local_name: entry.local_name,
            transport: entry.transport,
            tool_source: entry.tool_source,
            fields: entry.fields,
        }
    }
}

// ─── wasm_bindgen DTOs for JS manifest entries ─────────────────────
// These structs use tsify to generate TypeScript types and allow
// passing JS objects directly to wasm_bindgen functions via serde.

#[derive(Tsify, Clone, Debug, Serialize, Deserialize)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct JsApiAlias {
    pub namespace: String,
    pub name: String,
    pub fields: Option<Vec<String>>,
}

#[derive(Tsify, Clone, Debug, Serialize, Deserialize)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct JsParamDoc {
    pub name: String,
    #[serde(rename = "type")]
    pub js_type: String,
    pub required: bool,
    pub description: String,
}

#[derive(Tsify, Clone, Debug, Serialize, Deserialize)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct JsReturnDoc {
    #[serde(rename = "type")]
    pub js_type: String,
    pub description: String,
}

#[derive(Tsify, Clone, Debug, Serialize, Deserialize)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(rename_all = "camelCase")]
pub struct JsManifestEntry {
    pub action: String,
    pub namespace: String,
    pub name: String,
    pub public_name: String,
    pub description: String,
    pub fields: Option<Vec<String>>,
    pub aliases: Vec<JsApiAlias>,
    pub params_doc: Vec<JsParamDoc>,
    pub returns_doc: JsReturnDoc,
    pub error_code: String,
    pub error_category: Option<String>,
}

impl From<JsApiAlias> for ApiAlias {
    fn from(alias: JsApiAlias) -> Self {
        Self {
            namespace: alias.namespace,
            name: alias.name,
            fields: alias.fields,
        }
    }
}

impl From<JsParamDoc> for ParamDoc {
    fn from(param: JsParamDoc) -> Self {
        Self {
            name: param.name,
            js_type: param.js_type,
            required: param.required,
            description: param.description,
        }
    }
}

impl From<JsReturnDoc> for ReturnDoc {
    fn from(ret: JsReturnDoc) -> Self {
        Self {
            js_type: ret.js_type,
            description: ret.description,
        }
    }
}

impl TryFrom<JsManifestEntry> for ApiManifestEntry {
    type Error = String;
    fn try_from(entry: JsManifestEntry) -> Result<Self, Self::Error> {
        Ok(Self {
            namespace: entry.namespace,
            name: entry.name,
            action: Some(entry.action),
            description: entry.description,
            params: entry.params_doc.into_iter().map(Into::into).collect(),
            returns: entry.returns_doc.into(),
            public_name: entry.public_name,
            local_name: None,
            transport: ToolTransport::Async,
            tool_source: ToolSource::Extension,
            fields: entry.fields,
            aliases: entry.aliases.into_iter().map(Into::into).collect(),
        })
    }
}

#[derive(Debug, PartialEq)]
pub enum RegistryError {
    DuplicateAction(String),
    DuplicatePublicName(String),
    DuplicateAlias(String),
    DuplicateHandler(String),
    MissingAction,
    Frozen,
    SharedDispatchNotRegistered,
    InvalidManifest(String),
}

impl std::fmt::Display for RegistryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RegistryError::DuplicateAction(a) => write!(f, "duplicate action: {a}"),
            RegistryError::DuplicatePublicName(n) => write!(f, "duplicate public name: {n}"),
            RegistryError::DuplicateAlias(n) => write!(f, "duplicate alias: {n}"),
            RegistryError::DuplicateHandler(a) => write!(f, "duplicate handler: {a}"),
            RegistryError::SharedDispatchNotRegistered => {
                write!(f, "shared JS dispatch callback is not registered")
            }
            RegistryError::InvalidManifest(msg) => write!(f, "invalid manifest entry: {msg}"),
            RegistryError::MissingAction => write!(f, "executable API entry is missing an action"),
            RegistryError::Frozen => write!(f, "registry is frozen"),
        }
    }
}

static FROZEN: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, Default)]
pub(crate) struct RegistryRecord {
    manifest: Option<ApiManifestEntry>,
    handler: Option<ApiHandler>,
}

thread_local! {
    pub(crate) static REGISTRY: RefCell<BTreeMap<String, RegistryRecord>> = const { RefCell::new(BTreeMap::new()) };
    static SHARED_JS_DISPATCH: RefCell<Option<JsValue>> = const { RefCell::new(None) };
}

fn alias_public_name(namespace: &str, name: &str) -> String {
    format!("{namespace}.{name}")
}

fn occupied_public_names(registry: &BTreeMap<String, RegistryRecord>) -> std::collections::BTreeSet<String> {
    let mut names = std::collections::BTreeSet::new();
    for record in registry.values() {
        let Some(manifest) = record.manifest.as_ref() else {
            continue;
        };
        names.insert(manifest.public_name.clone());
        for alias in &manifest.aliases {
            names.insert(alias_public_name(&alias.namespace, &alias.name));
        }
    }
    names
}

fn validate_entry_internal_aliases(entry: &ApiManifestEntry) -> Result<(), RegistryError> {
    let mut seen = std::collections::BTreeSet::from([entry.public_name.clone()]);
    for alias in &entry.aliases {
        let alias_name = alias_public_name(&alias.namespace, &alias.name);
        if alias_name == entry.public_name {
            return Err(RegistryError::DuplicateAlias(alias_name));
        }
        if !seen.insert(alias_name.clone()) {
            return Err(RegistryError::DuplicateAlias(alias_name));
        }
    }
    Ok(())
}

fn validate_manifest_names(
    registry: &BTreeMap<String, RegistryRecord>,
    entry: &ApiManifestEntry,
) -> Result<(), RegistryError> {
    validate_entry_internal_aliases(entry)?;
    let occupied = occupied_public_names(registry);
    if occupied.contains(&entry.public_name) {
        return Err(RegistryError::DuplicatePublicName(entry.public_name.clone()));
    }
    for alias in &entry.aliases {
        let alias_name = alias_public_name(&alias.namespace, &alias.name);
        if occupied.contains(&alias_name) {
            return Err(RegistryError::DuplicateAlias(alias_name));
        }
    }
    Ok(())
}

fn validate_batch_entries(
    registry: &BTreeMap<String, RegistryRecord>,
    entries: &[(ApiManifestEntry, ApiHandler)],
) -> Result<(), RegistryError> {
    let mut batch_actions = std::collections::BTreeSet::new();
    let mut batch_public_names = std::collections::BTreeSet::new();

    for (entry, _) in entries {
        let action = entry
            .action
            .as_ref()
            .filter(|action| !action.is_empty())
            .ok_or(RegistryError::MissingAction)?
            .clone();
        if !batch_actions.insert(action.clone()) {
            return Err(RegistryError::DuplicateAction(action));
        }
        validate_entry_internal_aliases(entry)?;
        if !batch_public_names.insert(entry.public_name.clone()) {
            return Err(RegistryError::DuplicatePublicName(entry.public_name.clone()));
        }
        for alias in &entry.aliases {
            let alias_name = alias_public_name(&alias.namespace, &alias.name);
            if !batch_public_names.insert(alias_name.clone()) {
                return Err(RegistryError::DuplicateAlias(alias_name));
            }
        }
        validate_manifest_names(registry, entry)?;
    }

    Ok(())
}

/// Register multiple executable entries atomically: validate the full batch first, then commit.
pub fn register_executable_entries_batch(
    entries: Vec<(ApiManifestEntry, ApiHandler)>,
) -> Result<(), RegistryError> {
    if FROZEN.load(Ordering::SeqCst) {
        return Err(RegistryError::Frozen);
    }

    REGISTRY.with(|reg| {
        let registry = reg.borrow();
        validate_batch_entries(&registry, &entries)?;
        drop(registry);

        let mut registry = reg.borrow_mut();
        for (entry, handler) in entries {
            let action = entry
                .action
                .clone()
                .filter(|action| !action.is_empty())
                .ok_or(RegistryError::MissingAction)?;
            if let Some(existing) = registry.get(&action) {
                if existing.manifest.is_some() {
                    return Err(RegistryError::DuplicateAction(action));
                }
                if existing.handler.is_some() {
                    return Err(RegistryError::DuplicateHandler(action));
                }
            }
            registry.insert(
                action,
                RegistryRecord {
                    manifest: Some(entry),
                    handler: Some(handler),
                },
            );
        }
        Ok(())
    })
}

/// Store the single shared JS dispatch callback used for all JS-remote manifest entries.
pub fn set_shared_js_dispatch(callback: JsValue) {
    SHARED_JS_DISPATCH.with(|slot| {
        *slot.borrow_mut() = Some(callback);
    });
}

/// Returns the shared JS dispatch callback if registered.
pub fn get_shared_js_dispatch() -> Option<JsValue> {
    SHARED_JS_DISPATCH.with(|slot| slot.borrow().clone())
}

/// Import JS manifest metadata entries, attaching the shared JS dispatch handler to each.
pub fn import_js_manifest_entries(entries: Vec<JsManifestEntry>) -> Result<(), RegistryError> {
    let shared = get_shared_js_dispatch().ok_or(RegistryError::SharedDispatchNotRegistered)?;
    let batch = entries
        .into_iter()
        .map(|entry| {
            let spec = ApiManifestEntry::try_from(entry).map_err(RegistryError::InvalidManifest)?;
            Ok((spec, ApiHandler::JsCallback(shared.clone())))
        })
        .collect::<Result<Vec<_>, RegistryError>>()?;
    register_executable_entries_batch(batch)
}

/// Register metadata and its executable handler as one operation.
///
/// All production registrations must use this boundary. Validation happens
/// before either map is mutated, so an API cannot become visible without the
/// handler that executes it.
pub fn register_executable_entry(
    entry: ApiManifestEntry,
    handler: ApiHandler,
) -> Result<(), RegistryError> {
    if FROZEN.load(Ordering::SeqCst) {
        return Err(RegistryError::Frozen);
    }

    let action = entry
        .action
        .clone()
        .filter(|action| !action.is_empty())
        .ok_or(RegistryError::MissingAction)?;

    REGISTRY.with(|reg| {
        let mut registry = reg.borrow_mut();
        if let Some(existing) = registry.get(&action) {
            if existing.manifest.is_some() {
                return Err(RegistryError::DuplicateAction(action));
            }
            if existing.handler.is_some() {
                return Err(RegistryError::DuplicateHandler(action));
            }
        }
        validate_manifest_names(&registry, &entry)?;
        registry.insert(
            action,
            RegistryRecord {
                manifest: Some(entry),
                handler: Some(handler),
            },
        );
        Ok(())
    })
}

/// Register a handler for the given action in the separate handler registry.
/// Returns `true` if newly registered, `false` if duplicate or frozen.
pub fn register_handler(action: &str, handler: ApiHandler) -> bool {
    if FROZEN.load(Ordering::SeqCst) {
        return false;
    }
    REGISTRY.with(|reg| {
        let mut registry = reg.borrow_mut();
        let record = registry.entry(action.to_string()).or_default();
        if record.handler.is_some() {
            return false;
        }
        record.handler = Some(handler);
        true
    })
}

/// Check whether a handler is registered for the given action.
pub fn has_handler(action: &str) -> bool {
    REGISTRY.with(|reg| reg.borrow().get(action).and_then(|record| record.handler.as_ref()).is_some())
}

/// Return a snapshot of executable handler action names.
pub fn list_handler_actions() -> Vec<String> {
    REGISTRY.with(|reg| {
        reg.borrow()
            .iter()
            .filter(|(_, record)| record.handler.is_some())
            .map(|(action, _)| action.clone())
            .collect()
    })
}

/// Extract a readable error message from a JS value.
/// Tries `as_string()` first, then falls back to reading the `.message`
/// property from Error-like objects, and finally uses debug formatting.
fn extract_js_error_message(e: &JsValue) -> String {
    e.as_string()
        .or_else(|| {
            js_sys::Reflect::get(e, &"message".into())
                .ok()
                .and_then(|m| m.as_string())
        })
        .unwrap_or_else(|| format!("JS callback error: {:?}", e))
}

/// Dispatch a command by looking up its handler in the handler registry.
/// Returns `Some(future)` if a handler was found, `None` otherwise.
pub fn dispatch_handler(
    action: &str,
    cmd: AsyncCommand,
) -> Option<Pin<Box<dyn Future<Output = Result<AsyncResponse, String>>>>> {
    let handler = REGISTRY.with(|reg| {
        reg.borrow()
            .get(action)
            .and_then(|record| record.handler.clone())
    })?;
    match handler {
        ApiHandler::Rust(handler_fn) => Some(handler_fn(cmd)),
        ApiHandler::JsCallback(js_value) => {
                let cb = js_sys::Function::from(js_value);
                let params_js = match serde_wasm_bindgen::to_value(&cmd.params) {
                    Ok(v) => v,
                    Err(e) => {
                        tracing::warn!(action = %cmd.action, error = %e, "dispatch_handler_params_serialize_failed");
                        return Some(Box::pin(async move {
                            Err(format!("Failed to serialize params: {}", e))
                        }) as Pin<Box<dyn Future<Output = Result<AsyncResponse, String>>>>)
                    }
                };
                tracing::debug!(action = %cmd.action, "dispatch_handler_js_callback_call");
                // Build context object with action, call_id and run_id for the JS callback
                let context_js = js_sys::Object::new();
                let _ = js_sys::Reflect::set(&context_js, &"action".into(), &JsValue::from_str(&cmd.action));
                let _ = js_sys::Reflect::set(&context_js, &"callId".into(), &JsValue::from_f64(cmd.call_id as f64));
                let _ = js_sys::Reflect::set(&context_js, &"runId".into(), &cmd.run_id.as_ref().map(|s| JsValue::from_str(s)).unwrap_or(JsValue::NULL));
                let result_js = match cb.call2(&JsValue::NULL, &params_js, &context_js) {
                    Ok(v) => v,
                    Err(e) => {
                        let err_msg = extract_js_error_message(&e);
                        tracing::warn!(action = %cmd.action, error = %err_msg, "dispatch_handler_js_callback_threw");
                        return Some(Box::pin(async move {
                            Err(format!("JS callback error: {}", err_msg))
                        }) as Pin<Box<dyn Future<Output = Result<AsyncResponse, String>>>>)
                    }
                };
                // If the JS callback returns a non-Promise value, wrap it in a resolved Promise
                let promise = if result_js.is_instance_of::<js_sys::Promise>() {
                    js_sys::Promise::from(result_js)
                } else {
                    js_sys::Promise::resolve(&result_js)
                };
                let action_for_timeout = cmd.action.clone();
                Some(Box::pin(async move {
                    let timeout = gloo_timers::future::TimeoutFuture::new(30_000);
                    let resp_js = match futures_util::future::select(
                        wasm_bindgen_futures::JsFuture::from(promise),
                        timeout,
                    ).await {
                        futures_util::future::Either::Left((result, _)) => {
                            match result {
                                Ok(v) => v,
                                Err(e) => {
                                    let err_msg = extract_js_error_message(&e);
                                    tracing::warn!(action = %action_for_timeout, error = %err_msg, "dispatch_handler_js_callback_rejected");
                                    return Err(format!("JS callback promise rejected: {}", err_msg));
                                }
                            }
                        }
                        futures_util::future::Either::Right((_, _)) => {
                            tracing::warn!(action = %action_for_timeout, "dispatch_handler_js_callback_timeout");
                            return Err("JS callback timed out after 30s".to_string());
                        }
                    };
                    let resp: AsyncResponse = serde_wasm_bindgen::from_value(resp_js)
                        .map_err(|e| {
                            tracing::warn!(action = %action_for_timeout, error = %e, "dispatch_handler_js_callback_deserialize_failed");
                            format!("Failed to deserialize JS callback response: {}", e)
                        })?;
                    tracing::info!(action = %action_for_timeout, ok = resp.ok, "dispatch_handler_js_callback_done");
                    Ok(resp)
                }) as Pin<Box<dyn Future<Output = Result<AsyncResponse, String>>>>)
        }
    }
}

/// Clear all registered handlers. Primarily useful in tests.
pub fn clear_handlers() {
    REGISTRY.with(|reg| {
        reg.borrow_mut().retain(|_, record| record.handler.is_none());
    });
}

/// Register a doc entry for backward compatibility.
/// Respects freeze flag and dedupes by namespace+name.
pub fn register(doc: JsApiDoc) {
    if FROZEN.load(Ordering::SeqCst) {
        return;
    }
    REGISTRY.with(|reg| {
        let mut registry = reg.borrow_mut();
        // Avoid duplicates when sessions are recreated (e.g. reset)
        if registry.values().filter_map(|record| record.manifest.as_ref()).any(
            |entry| entry.namespace == doc.namespace && entry.name == doc.name,
        )
        {
            return;
        }
        let entry = ApiManifestEntry::from(doc);
        let key = entry
            .action
            .clone()
            .unwrap_or_else(|| format!("{}.{}", entry.namespace, entry.name));
        registry.entry(key).or_default().manifest = Some(entry);
    });
}

/// Register a manifest entry with strict duplicate and freeze checks.
pub fn register_manifest_entry(entry: ApiManifestEntry) -> Result<(), RegistryError> {
    if FROZEN.load(Ordering::SeqCst) {
        return Err(RegistryError::Frozen);
    }
    let action = entry.action.clone().unwrap_or_default();
    if action.is_empty() {
        return Ok(());
    }
    REGISTRY.with(|reg| {
        let mut registry = reg.borrow_mut();
        // Check duplicate action
        if registry.get(&action).and_then(|record| record.manifest.as_ref()).is_some() {
            return Err(RegistryError::DuplicateAction(action));
        }
        // Check duplicate public_name
        for existing in registry.values().filter_map(|record| record.manifest.as_ref()) {
            if existing.public_name == entry.public_name {
                return Err(RegistryError::DuplicatePublicName(
                    entry.public_name.clone(),
                ));
            }
        }
        registry.entry(action).or_default().manifest = Some(entry);
        Ok(())
    })
}

/// Return a snapshot of all manifest entries.
pub fn list_manifest_entries() -> Vec<ApiManifestEntry> {
    REGISTRY.with(|reg| {
        reg.borrow()
            .values()
            .filter_map(|record| record.manifest.clone())
            .collect()
    })
}

/// Look up a manifest entry by action name.
pub fn get_manifest_entry(action: &str) -> Option<ApiManifestEntry> {
    REGISTRY.with(|reg| reg.borrow().get(action).and_then(|record| record.manifest.clone()))
}

/// Remove a manifest entry by action. Returns true if removed.
/// Primarily used for rollback during atomic registration.
pub fn remove_manifest_entry(action: &str) -> bool {
    REGISTRY.with(|reg| reg.borrow_mut().remove(action).and_then(|record| record.manifest).is_some())
}

/// Clear all manifest entries and reset the freeze flag.
/// Primarily useful in tests.
pub fn clear_manifest_entries() {
    REGISTRY.with(|reg| reg.borrow_mut().clear());
    FROZEN.store(false, Ordering::SeqCst);
}

/// Freeze the manifest so no further entries can be registered.
pub fn freeze_manifest() {
    FROZEN.store(true, Ordering::SeqCst);
}

/// Unfreeze the manifest to allow internal re-registration (e.g. during reset).
pub fn unfreeze_manifest() {
    FROZEN.store(false, Ordering::SeqCst);
}

/// Check whether the manifest is frozen.
pub fn is_manifest_frozen() -> bool {
    FROZEN.load(Ordering::SeqCst)
}

/// Clear all registered API docs. Primarily useful in tests.
pub fn clear_docs() {
    clear_manifest_entries();
}

/// Return a snapshot of all registered API docs.
pub fn list_docs() -> Vec<JsApiDoc> {
    list_manifest_entries()
        .into_iter()
        .map(JsApiDoc::from)
        .collect()
}

pub fn generate_json() -> Result<String, String> {
    let docs = list_docs();
    serde_json::to_string_pretty(&docs)
        .map_err(|e| format!("Failed to serialize manifest: {}", e))
}

pub fn generate_markdown() -> String {
    let docs = list_docs();
    let mut md = String::new();

    use std::collections::BTreeMap;
    let mut by_ns: BTreeMap<String, Vec<JsApiDoc>> = BTreeMap::new();
    for doc in docs {
        by_ns.entry(doc.namespace.clone()).or_default().push(doc);
    }

    for (ns, apis) in by_ns {
        md.push_str(&format!("## `{}` module\n\n", ns));
        for api in apis {
            let action_note = api
                .action
                .as_ref()
                .filter(|a| !a.is_empty())
                .map(|a| format!(" _(action: `{}`)_", a))
                .unwrap_or_default();
            md.push_str(&format!("### `{}.{}{}`\n\n", ns, api.name, action_note));
            md.push_str(&format!("{}\n\n", api.description));
            if !api.params.is_empty() {
                md.push_str("**Parameters**\n\n");
                for p in &api.params {
                    let req_flag = if p.required { "required" } else { "optional" };
                    md.push_str(&format!(
                        "- `{}` (`{}`, {}): {}\n",
                        p.name, p.js_type, req_flag, p.description
                    ));
                }
                md.push('\n');
            }
            md.push_str(&format!(
                "**Returns** `{}`: {}\n\n",
                api.returns.js_type, api.returns.description
            ));
        }
    }

    md
}

pub fn generate(format: &str) -> Result<String, String> {
    match format {
        "json" => generate_json(),
        "markdown" | "md" => Ok(generate_markdown()),
        _ => Ok(generate_markdown()),
    }
}

/// Generate JS code that creates async bindings from the doc registry.
///
/// This produces a script that calls `__webJsSetupAsyncBindings` with a spec array
/// containing all async APIs registered in the doc registry.  The generated code
/// skips APIs that already have custom wrappers in the JS environment (checked via
/// `typeof ns[name] === 'undefined'`).
///
/// The returned string is safe to eval in the QuickJS context after `prelude.js`
/// has been loaded.
fn escape_js_string(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
        .replace("</script>", "<\\/script>")
}

pub fn generate_js_bindings_code() -> String {
    let entries = list_manifest_entries();
    let mut specs = Vec::new();

    for entry in &entries {
        // Only generate bindings for async APIs that have an action
        if entry.transport != ToolTransport::Async {
            continue;
        }
        let Some(ref action) = entry.action else {
            continue;
        };
        if action.is_empty() {
            continue;
        }
        // Only generate bindings for entries that have a registered handler
        if !has_handler(action) {
            continue;
        }

        // Escape strings for JS
        let ns = escape_js_string(&entry.namespace);
        let name = escape_js_string(&entry.name);
        let action_escaped = escape_js_string(action);

        let fields_js = match &entry.fields {
            Some(fields) if !fields.is_empty() => {
                let escaped: Vec<String> = fields
                    .iter()
                    .map(|f| escape_js_string(f))
                    .collect();
                format!(
                    ",fields:[{}]",
                    escaped
                        .iter()
                        .map(|f| format!("\"{}\"", f))
                        .collect::<Vec<_>>()
                        .join(",")
                )
            }
            _ => String::new(),
        };

        specs.push(format!(
            r#"{{namespace:"{}",name:"{}",action:"{}"{}}}"#,
            ns, name, action_escaped, fields_js
        ));

        // Generate bindings for aliases
        for alias in &entry.aliases {
            let alias_ns = escape_js_string(&alias.namespace);
            let alias_name = escape_js_string(&alias.name);

            let alias_fields_js = match &alias.fields {
                Some(fields) if !fields.is_empty() => {
                    let escaped: Vec<String> = fields
                        .iter()
                        .map(|f| escape_js_string(f))
                        .collect();
                    format!(
                        ",fields:[{}]",
                        escaped
                            .iter()
                            .map(|f| format!("\"{}\"", f))
                            .collect::<Vec<_>>()
                            .join(",")
                    )
                }
                _ => String::new(),
            };

            specs.push(format!(
                r#"{{namespace:"{}",name:"{}",action:"{}"{}}}"#,
                alias_ns, alias_name, action_escaped, alias_fields_js
            ));
        }
    }

    if specs.is_empty() {
        return String::new();
    }

    format!(
        "__webJsSetupAsyncBindings([\n  {}\n]);",
        specs.join(",\n  ")
    )
}

/// Generate JS code that creates sync namespace wrappers for RustCore sync APIs.
///
/// This produces a script that creates namespace objects (e.g. `web.url`) and
/// assigns the local rquickjs function (e.g. `__webJsUrlParse`) to the public
/// name (e.g. `web.url.parse`).
pub fn generate_js_sync_bindings_code() -> String {
    let entries = list_manifest_entries();
    let mut lines = Vec::new();

    for entry in &entries {
        // Only generate bindings for sync APIs that have an action
        if entry.transport != ToolTransport::Sync {
            continue;
        }
        let Some(ref action) = entry.action else {
            continue;
        };
        if action.is_empty() {
            continue;
        }

        let name = escape_js_string(&entry.name);
        let local = escape_js_string(
            entry.local_name.as_deref().unwrap_or(action.as_str()),
        );

        // Build namespace chain: var ns=globalThis; ns=ns["web"]||(ns["web"]={}); ...
        let ns_parts: Vec<&str> = entry.namespace.split('.').collect();
        let mut ns_setup = String::from("var ns=globalThis;");
        for part in &ns_parts {
            let p = escape_js_string(part);
            ns_setup.push_str(&format!("ns=ns[\"{}\"]||(ns[\"{}\"]={{}});", p, p));
        }

        lines.push(format!(
            r#"(function(){{{0}if(typeof ns["{1}"]==="undefined")ns["{1}"]={2};}})();"#,
            ns_setup, name, local
        ));
    }

    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    // Minimal block_on for test-only use (no wake needed for trivial futures).
    fn block_on<F: Future>(f: F) -> F::Output {
        use std::task::{Context, Poll, Waker};
        let waker = unsafe { Waker::from_raw(std::task::RawWaker::new(std::ptr::null(), &VTABLE)) };
        let mut context = Context::from_waker(&waker);
        let mut pinned = std::boxed::Box::pin(f);
        loop {
            match pinned.as_mut().poll(&mut context) {
                Poll::Ready(val) => return val,
                Poll::Pending => {}
            }
        }
    }

    static VTABLE: std::task::RawWakerVTable = std::task::RawWakerVTable::new(
        |_| std::task::RawWaker::new(std::ptr::null(), &VTABLE),
        |_| {},
        |_| {},
        |_| {},
    );

    #[test]
    fn test_register_populates_registry() {
        clear_docs();

        register(JsApiDoc {
            namespace: "test".into(),
            name: "foo".into(),
            action: Some("test_foo".into()),
            description: "Test API.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "null".into(),
                description: "None".into(),
            },
            public_name: "test.foo".into(),
            local_name: None,
            transport: ToolTransport::Async,
            tool_source: ToolSource::RustCore,
            fields: None,
        });

        let json = generate_json().unwrap();
        assert!(json.contains("test.foo"));
        assert!(json.contains("test_foo"));
        assert!(json.contains("RustCore"));
        assert!(json.contains("Async"));
        assert!(json.contains("rust_core"));
    }

    #[test]
    fn test_register_avoids_duplicates() {
        clear_docs();

        let doc = JsApiDoc {
            namespace: "dup".into(),
            name: "bar".into(),
            action: Some("dup_bar".into()),
            description: "Dup test.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "null".into(),
                description: "None".into(),
            },
            public_name: "dup.bar".into(),
            local_name: None,
            transport: ToolTransport::Sync,
            tool_source: ToolSource::JsPrelude,
            fields: None,
        };

        register(doc.clone());
        register(doc);

        let docs = REGISTRY.with(|reg| reg.borrow().clone());
        assert_eq!(docs.len(), 1);
    }

    #[test]
    fn test_generate_markdown() {
        clear_docs();

        register(JsApiDoc {
            namespace: "browser".into(),
            name: "navigate".into(),
            action: Some("browser_navigate".into()),
            description: "Navigate to a URL.".into(),
            params: vec![ParamDoc {
                name: "url".into(),
                js_type: "string".into(),
                required: true,
                description: "The URL to navigate to.".into(),
            }],
            returns: ReturnDoc {
                js_type: "null".into(),
                description: "None".into(),
            },
            public_name: "browser.navigate".into(),
            local_name: None,
            transport: ToolTransport::Async,
            tool_source: ToolSource::RustCore,
            fields: None,
        });

        let md = generate_markdown();
        assert!(md.contains("## `browser` module"));
        assert!(md.contains("browser.navigate"));
        assert!(md.contains("_(action: `browser_navigate`)_"));
        assert!(md.contains("Navigate to a URL."));
        assert!(md.contains("**Parameters**"));
        assert!(md.contains("`url` (`string`, required): The URL to navigate to."));
        assert!(md.contains("**Returns** `null`: None"));
    }

    #[test]
    fn test_generate_json_format() {
        clear_docs();

        register(JsApiDoc {
            namespace: "fs".into(),
            name: "read".into(),
            action: Some("fs_read".into()),
            description: "Read a file.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "string".into(),
                description: "File contents.".into(),
            },
            public_name: "fs.read".into(),
            local_name: None,
            transport: ToolTransport::Sync,
            tool_source: ToolSource::Extension,
            fields: None,
        });

        let json = generate("json").unwrap();
        assert!(json.contains("fs.read"));
        assert!(json.contains("fs_read"));
        assert!(json.contains("Extension"));
        assert!(json.contains("extension"));
    }

    #[test]
    fn test_generate_markdown_format() {
        clear_docs();

        register(JsApiDoc {
            namespace: "crypto".into(),
            name: "hash".into(),
            action: None,
            description: "Hash data.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "string".into(),
                description: "Hash result.".into(),
            },
            public_name: "crypto.hash".into(),
            local_name: None,
            transport: ToolTransport::Sync,
            tool_source: ToolSource::JsPrelude,
            fields: None,
        });

        let md = generate("markdown").unwrap();
        assert!(md.contains("## `crypto` module"));
        assert!(md.contains("### `crypto.hash`"));

        let md_short = generate("md").unwrap();
        assert!(md_short.contains("## `crypto` module"));
    }

    #[test]
    fn test_generate_js_bindings_code_produces_valid_js() {
        clear_docs();
        clear_handlers();

        // Register a mix of async and sync APIs
        register(JsApiDoc {
            namespace: "web".into(),
            name: "fetch".into(),
            action: Some("fetch".into()),
            description: "Make an HTTP request.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "object".into(),
                description: "Response object.".into(),
            },
            public_name: "web.fetch".into(),
            local_name: None,
            transport: ToolTransport::Async,
            tool_source: ToolSource::RustCore,
            fields: None,
        });
        // Register a handler so the binding is generated
        let _ = register_handler("fetch", ApiHandler::Rust(std::rc::Rc::new(|_cmd| {
            Box::pin(async move { Ok(AsyncResponse { ok: true, value: None, error: None }) })
                as Pin<Box<dyn Future<Output = Result<AsyncResponse, String>>>>
        })));

        register(JsApiDoc {
            namespace: "chrome.tabs".into(),
            name: "query".into(),
            action: Some("chrome_tabs_query".into()),
            description: "Query tabs.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "object[]".into(),
                description: "Array of tab objects.".into(),
            },
            public_name: "chrome.tabs.query".into(),
            local_name: None,
            transport: ToolTransport::Async,
            tool_source: ToolSource::Extension,
            fields: None,
        });
        // Register a handler so the binding is generated
        let _ = register_handler("chrome_tabs_query", ApiHandler::Rust(std::rc::Rc::new(|_cmd| {
            Box::pin(async move { Ok(AsyncResponse { ok: true, value: None, error: None }) })
                as Pin<Box<dyn Future<Output = Result<AsyncResponse, String>>>>
        })));

        register(JsApiDoc {
            namespace: "web.url".into(),
            name: "parse".into(),
            action: Some("url_parse".into()),
            description: "Parse a URL.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "object".into(),
                description: "Parsed URL object.".into(),
            },
            public_name: "web.url.parse".into(),
            local_name: None,
            transport: ToolTransport::Sync,
            tool_source: ToolSource::JsPrelude,
            fields: None,
        });

        let js = generate_js_bindings_code();

        // Must contain the setup function call
        assert!(
            js.contains("__webJsSetupAsyncBindings"),
            "generated JS must call __webJsSetupAsyncBindings"
        );

        // Must contain async API bindings
        assert!(
            js.contains(r#"namespace:"web",name:"fetch",action:"fetch""#),
            "generated JS must contain web.fetch binding"
        );
        assert!(
            js.contains(r#"namespace:"chrome.tabs",name:"query",action:"chrome_tabs_query""#),
            "generated JS must contain chrome.tabs.query binding"
        );

        // Must NOT contain sync APIs
        assert!(
            !js.contains("url_parse"),
            "generated JS must not contain sync API bindings"
        );

        // Must be valid JS syntax (starts with function call)
        assert!(
            js.starts_with("__webJsSetupAsyncBindings(["),
            "generated JS must start with __webJsSetupAsyncBindings(["
        );
        assert!(js.ends_with("]);"), "generated JS must end with ]);");
    }

    #[test]
    fn test_generate_js_bindings_code_empty_when_no_async_apis() {
        clear_docs();

        register(JsApiDoc {
            namespace: "crypto".into(),
            name: "hash".into(),
            action: None,
            description: "Hash data.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "string".into(),
                description: "Hash result.".into(),
            },
            public_name: "crypto.hash".into(),
            local_name: None,
            transport: ToolTransport::Sync,
            tool_source: ToolSource::JsPrelude,
            fields: None,
        });

        let js = generate_js_bindings_code();
        assert_eq!(
            js, "",
            "generate_js_bindings_code must return empty string when no async APIs are registered"
        );
    }

    #[test]
    fn test_generate_js_bindings_code_escapes_strings() {
        clear_docs();
        clear_handlers();

        register(JsApiDoc {
            namespace: "test".into(),
            name: "quote".into(),
            action: Some(r#"test_"quote""#.into()),
            description: "Test escaping.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "null".into(),
                description: "None.".into(),
            },
            public_name: "test.quote".into(),
            local_name: None,
            transport: ToolTransport::Async,
            tool_source: ToolSource::RustCore,
            fields: None,
        });
        // Register a handler so the binding is generated
        let _ = register_handler(r#"test_"quote""#, ApiHandler::Rust(std::rc::Rc::new(|_cmd| {
            Box::pin(async move { Ok(AsyncResponse { ok: true, value: None, error: None }) })
                as Pin<Box<dyn Future<Output = Result<AsyncResponse, String>>>>
        })));

        let js = generate_js_bindings_code();
        // The action string contains a quote, so it must be escaped
        assert!(
            js.contains(r#"action:"test_\"quote\""}"#),
            "generated JS must escape embedded quotes"
        );
    }

    #[test]
    fn test_generate_js_bindings_code_includes_fields() {
        clear_docs();
        clear_handlers();

        register(JsApiDoc {
            namespace: "web".into(),
            name: "sleep".into(),
            action: Some("sleep".into()),
            description: "Sleep for a duration.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "null".into(),
                description: "None.".into(),
            },
            public_name: "web.sleep".into(),
            local_name: None,
            transport: ToolTransport::Async,
            tool_source: ToolSource::RustCore,
            fields: Some(vec!["duration".into()]),
        });
        // Register a handler so the binding is generated
        let _ = register_handler("sleep", ApiHandler::Rust(std::rc::Rc::new(|_cmd| {
            Box::pin(async move { Ok(AsyncResponse { ok: true, value: None, error: None }) })
                as Pin<Box<dyn Future<Output = Result<AsyncResponse, String>>>>
        })));

        let js = generate_js_bindings_code();
        assert!(
            js.contains(r#"namespace:"web",name:"sleep",action:"sleep",fields:["duration"]"#),
            "generated JS must include fields array"
        );
    }

    #[test]
    fn test_generate_js_bindings_code_includes_new_namespaces() {
        clear_docs();
        clear_handlers();

        // Register APIs for the newly added namespaces
        register(JsApiDoc {
            namespace: "chrome.sessions".into(),
            name: "getRecentlyClosed".into(),
            action: Some("chrome_sessions_getRecentlyClosed".into()),
            description: "Get recently closed sessions.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "object[]".into(),
                description: "Array of session objects.".into(),
            },
            public_name: "chrome.sessions.getRecentlyClosed".into(),
            local_name: None,
            transport: ToolTransport::Async,
            tool_source: ToolSource::Extension,
            fields: None,
        });
        // Register a handler so the binding is generated
        let _ = register_handler("chrome_sessions_getRecentlyClosed", ApiHandler::Rust(std::rc::Rc::new(|_cmd| {
            Box::pin(async move { Ok(AsyncResponse { ok: true, value: None, error: None }) })
                as Pin<Box<dyn Future<Output = Result<AsyncResponse, String>>>>
        })));

        register(JsApiDoc {
            namespace: "chrome.windows".into(),
            name: "getCurrent".into(),
            action: Some("chrome_windows_getCurrent".into()),
            description: "Get the current window.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "object".into(),
                description: "Window object.".into(),
            },
            public_name: "chrome.windows.getCurrent".into(),
            local_name: None,
            transport: ToolTransport::Async,
            tool_source: ToolSource::Extension,
            fields: None,
        });
        // Register a handler so the binding is generated
        let _ = register_handler("chrome_windows_getCurrent", ApiHandler::Rust(std::rc::Rc::new(|_cmd| {
            Box::pin(async move { Ok(AsyncResponse { ok: true, value: None, error: None }) })
                as Pin<Box<dyn Future<Output = Result<AsyncResponse, String>>>>
        })));

        let js = generate_js_bindings_code();

        // Must contain the new namespace bindings
        assert!(
            js.contains(r#"namespace:"chrome.sessions",name:"getRecentlyClosed",action:"chrome_sessions_getRecentlyClosed""#),
            "generated JS must contain chrome.sessions.getRecentlyClosed binding"
        );
        assert!(
            js.contains(
                r#"namespace:"chrome.windows",name:"getCurrent",action:"chrome_windows_getCurrent""#
            ),
            "generated JS must contain chrome.windows.getCurrent binding"
        );
    }

    #[test]
    fn test_register_manifest_entry_basic() {
        clear_manifest_entries();

        let entry = ApiManifestEntry {
            namespace: "test".into(),
            name: "foo".into(),
            action: Some("test_foo".into()),
            description: "Test API.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "null".into(),
                description: "None".into(),
            },
            public_name: "test.foo".into(),
            local_name: None,
            transport: ToolTransport::Async,
            tool_source: ToolSource::RustCore,
            fields: None,
            aliases: vec![],
        };

        assert!(register_manifest_entry(entry).is_ok());
        let entries = list_manifest_entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].public_name, "test.foo");
    }

    #[test]
    fn test_register_manifest_entry_duplicate_action() {
        clear_manifest_entries();

        let entry1 = ApiManifestEntry {
            namespace: "test".into(),
            name: "foo".into(),
            action: Some("test_foo".into()),
            description: "First.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "null".into(),
                description: "None".into(),
            },
            public_name: "test.foo".into(),
            local_name: None,
            transport: ToolTransport::Async,
            tool_source: ToolSource::RustCore,
            fields: None,
            aliases: vec![],
        };

        let entry2 = ApiManifestEntry {
            namespace: "test".into(),
            name: "bar".into(),
            action: Some("test_foo".into()),
            description: "Duplicate action.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "null".into(),
                description: "None".into(),
            },
            public_name: "test.bar".into(),
            local_name: None,
            transport: ToolTransport::Async,
            tool_source: ToolSource::RustCore,
            fields: None,
            aliases: vec![],
        };

        assert!(register_manifest_entry(entry1).is_ok());
        let result = register_manifest_entry(entry2);
        assert_eq!(
            result,
            Err(RegistryError::DuplicateAction("test_foo".into()))
        );
    }

    #[test]
    fn test_register_manifest_entry_duplicate_public_name() {
        clear_manifest_entries();

        let entry1 = ApiManifestEntry {
            namespace: "test".into(),
            name: "foo".into(),
            action: Some("test_foo".into()),
            description: "First.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "null".into(),
                description: "None".into(),
            },
            public_name: "test.foo".into(),
            local_name: None,
            transport: ToolTransport::Async,
            tool_source: ToolSource::RustCore,
            fields: None,
            aliases: vec![],
        };

        let entry2 = ApiManifestEntry {
            namespace: "test".into(),
            name: "bar".into(),
            action: Some("test_bar".into()),
            description: "Duplicate public name.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "null".into(),
                description: "None".into(),
            },
            public_name: "test.foo".into(),
            local_name: None,
            transport: ToolTransport::Async,
            tool_source: ToolSource::RustCore,
            fields: None,
            aliases: vec![],
        };

        assert!(register_manifest_entry(entry1).is_ok());
        let result = register_manifest_entry(entry2);
        assert_eq!(
            result,
            Err(RegistryError::DuplicatePublicName("test.foo".into()))
        );
    }

    #[test]
    fn test_register_executable_entry_rejects_duplicate_alias() {
        clear_handlers();
        clear_manifest_entries();

        let first = ApiManifestEntry {
            namespace: "page".into(),
            name: "click".into(),
            action: Some("page_click".into()),
            description: "Click.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "null".into(),
                description: "None".into(),
            },
            public_name: "page.click".into(),
            local_name: None,
            transport: ToolTransport::Async,
            tool_source: ToolSource::Extension,
            fields: None,
            aliases: vec![],
        };

        let second = ApiManifestEntry {
            namespace: "tab".into(),
            name: "click".into(),
            action: Some("tab_click".into()),
            description: "Tab click.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "null".into(),
                description: "None".into(),
            },
            public_name: "tab.click".into(),
            local_name: None,
            transport: ToolTransport::Async,
            tool_source: ToolSource::Extension,
            fields: None,
            aliases: vec![ApiAlias {
                namespace: "page".into(),
                name: "click".into(),
                fields: None,
            }],
        };

        assert!(
            register_executable_entry(
                first,
                ApiHandler::Rust(std::rc::Rc::new(|_cmd| {
                    Box::pin(async move { Ok(AsyncResponse { ok: true, value: None, error: None }) })
                        as Pin<Box<dyn Future<Output = Result<AsyncResponse, String>>>>
                })),
            )
            .is_ok()
        );

        let result = register_executable_entry(
            second,
            ApiHandler::Rust(std::rc::Rc::new(|_cmd| {
                Box::pin(async move { Ok(AsyncResponse { ok: true, value: None, error: None }) })
                    as Pin<Box<dyn Future<Output = Result<AsyncResponse, String>>>>
            })),
        );

        assert_eq!(
            result,
            Err(RegistryError::DuplicateAlias("page.click".into()))
        );

        clear_handlers();
        clear_manifest_entries();
    }

    #[test]
    fn test_register_executable_entry_rejects_duplicate_alias_within_entry() {
        clear_handlers();
        clear_manifest_entries();

        let entry = ApiManifestEntry {
            namespace: "page".into(),
            name: "click".into(),
            action: Some("page_click".into()),
            description: "Click.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "null".into(),
                description: "None".into(),
            },
            public_name: "page.click".into(),
            local_name: None,
            transport: ToolTransport::Async,
            tool_source: ToolSource::Extension,
            fields: None,
            aliases: vec![
                ApiAlias {
                    namespace: "page".into(),
                    name: "tap".into(),
                    fields: None,
                },
                ApiAlias {
                    namespace: "page".into(),
                    name: "tap".into(),
                    fields: None,
                },
            ],
        };

        let result = register_executable_entry(
            entry,
            ApiHandler::Rust(std::rc::Rc::new(|_cmd| {
                Box::pin(async move { Ok(AsyncResponse { ok: true, value: None, error: None }) })
                    as Pin<Box<dyn Future<Output = Result<AsyncResponse, String>>>>
            })),
        );

        assert_eq!(
            result,
            Err(RegistryError::DuplicateAlias("page.tap".into()))
        );

        clear_handlers();
        clear_manifest_entries();
    }

    #[test]
    fn test_register_executable_entry_rejects_alias_equal_to_public_name() {
        clear_handlers();
        clear_manifest_entries();

        let entry = ApiManifestEntry {
            namespace: "page".into(),
            name: "click".into(),
            action: Some("page_click".into()),
            description: "Click.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "null".into(),
                description: "None".into(),
            },
            public_name: "page.click".into(),
            local_name: None,
            transport: ToolTransport::Async,
            tool_source: ToolSource::Extension,
            fields: None,
            aliases: vec![ApiAlias {
                namespace: "page".into(),
                name: "click".into(),
                fields: None,
            }],
        };

        let result = register_executable_entry(
            entry,
            ApiHandler::Rust(std::rc::Rc::new(|_cmd| {
                Box::pin(async move { Ok(AsyncResponse { ok: true, value: None, error: None }) })
                    as Pin<Box<dyn Future<Output = Result<AsyncResponse, String>>>>
            })),
        );

        assert_eq!(
            result,
            Err(RegistryError::DuplicateAlias("page.click".into()))
        );

        clear_handlers();
        clear_manifest_entries();
    }

    #[test]
    fn test_register_executable_entries_batch_is_atomic() {
        clear_handlers();
        clear_manifest_entries();

        let ok_entry = ApiManifestEntry {
            namespace: "test".into(),
            name: "one".into(),
            action: Some("test_one".into()),
            description: "One.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "null".into(),
                description: "None".into(),
            },
            public_name: "test.one".into(),
            local_name: None,
            transport: ToolTransport::Async,
            tool_source: ToolSource::Extension,
            fields: None,
            aliases: vec![],
        };

        let duplicate_alias_entry = ApiManifestEntry {
            namespace: "test".into(),
            name: "two".into(),
            action: Some("test_two".into()),
            description: "Two.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "null".into(),
                description: "None".into(),
            },
            public_name: "test.two".into(),
            local_name: None,
            transport: ToolTransport::Async,
            tool_source: ToolSource::Extension,
            fields: None,
            aliases: vec![
                ApiAlias {
                    namespace: "test".into(),
                    name: "dup".into(),
                    fields: None,
                },
                ApiAlias {
                    namespace: "test".into(),
                    name: "dup".into(),
                    fields: None,
                },
            ],
        };

        let handler = ApiHandler::Rust(std::rc::Rc::new(|_cmd| {
            Box::pin(async move { Ok(AsyncResponse { ok: true, value: None, error: None }) })
                as Pin<Box<dyn Future<Output = Result<AsyncResponse, String>>>>
        }));

        let result = register_executable_entries_batch(vec![
            (ok_entry, handler.clone()),
            (duplicate_alias_entry, handler),
        ]);

        assert_eq!(
            result,
            Err(RegistryError::DuplicateAlias("test.dup".into()))
        );
        assert!(!has_handler("test_one"));

        clear_handlers();
        clear_manifest_entries();
    }

    #[test]
    fn test_freeze_manifest_prevents_registration() {
        clear_manifest_entries();
        // Reset freeze flag for this test
        FROZEN.store(false, Ordering::SeqCst);

        let entry = ApiManifestEntry {
            namespace: "test".into(),
            name: "foo".into(),
            action: Some("test_foo".into()),
            description: "Test API.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "null".into(),
                description: "None".into(),
            },
            public_name: "test.foo".into(),
            local_name: None,
            transport: ToolTransport::Async,
            tool_source: ToolSource::RustCore,
            fields: None,
            aliases: vec![],
        };

        assert!(register_manifest_entry(entry.clone()).is_ok());
        freeze_manifest();
        assert!(is_manifest_frozen());

        let result = register_manifest_entry(entry);
        assert_eq!(result, Err(RegistryError::Frozen));

        // Clean up freeze flag so subsequent tests can register
        clear_manifest_entries();
    }

    #[test]
    fn test_generate_js_bindings_code_includes_aliases() {
        clear_manifest_entries();
        clear_handlers();

        let entry = ApiManifestEntry {
            namespace: "fs".into(),
            name: "readText".into(),
            action: Some("fs_readText".into()),
            description: "Read file as text.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "string".into(),
                description: "File contents.".into(),
            },
            public_name: "fs.readText".into(),
            local_name: None,
            transport: ToolTransport::Async,
            tool_source: ToolSource::RustCore,
            fields: None,
            aliases: vec![ApiAlias {
                namespace: "fs".into(),
                name: "read_text".into(),
                fields: None,
            }],
        };

        let _ = register_manifest_entry(entry);
        // Register a handler so the binding is generated
        let _ = register_handler("fs_readText", ApiHandler::Rust(std::rc::Rc::new(|_cmd| {
            Box::pin(async move { Ok(AsyncResponse { ok: true, value: None, error: None }) })
                as Pin<Box<dyn Future<Output = Result<AsyncResponse, String>>>>
        })));
        let js = generate_js_bindings_code();

        assert!(js.contains(r#"namespace:"fs",name:"readText",action:"fs_readText""#));
        assert!(js.contains(r#"namespace:"fs",name:"read_text",action:"fs_readText""#));
    }

    #[test]
    fn test_get_manifest_entry() {
        clear_manifest_entries();

        let entry = ApiManifestEntry {
            namespace: "test".into(),
            name: "foo".into(),
            action: Some("test_foo".into()),
            description: "Test API.".into(),
            params: vec![],
            returns: ReturnDoc {
                js_type: "null".into(),
                description: "None".into(),
            },
            public_name: "test.foo".into(),
            local_name: None,
            transport: ToolTransport::Async,
            tool_source: ToolSource::RustCore,
            fields: None,
            aliases: vec![],
        };

        let _ = register_manifest_entry(entry);
        let found = get_manifest_entry("test_foo");
        assert!(found.is_some());
        assert_eq!(found.unwrap().public_name, "test.foo");

        let not_found = get_manifest_entry("missing");
        assert!(not_found.is_none());
    }

    #[test]
    fn test_register_handler_respects_freeze() {
        clear_handlers();
        clear_manifest_entries();
        FROZEN.store(false, Ordering::SeqCst);

        let handler = ApiHandler::Rust(std::rc::Rc::new(|_cmd| {
            Box::pin(async move { Ok(AsyncResponse { ok: true, value: None, error: None }) })
                as Pin<Box<dyn Future<Output = Result<AsyncResponse, String>>>>
        }));

        assert!(register_handler("test_action", handler.clone()));
        assert!(has_handler("test_action"));

        freeze_manifest();
        assert!(!register_handler("test_action2", handler));
        assert!(!has_handler("test_action2"));

        clear_handlers();
        clear_manifest_entries();
    }

    #[test]
    fn test_register_handler_rejects_duplicates() {
        clear_handlers();

        let handler1 = ApiHandler::Rust(std::rc::Rc::new(|_cmd| {
            Box::pin(async move { Ok(AsyncResponse { ok: true, value: Some(serde_json::json!(1)), error: None }) })
                as Pin<Box<dyn Future<Output = Result<AsyncResponse, String>>>>
        }));
        let handler2 = ApiHandler::Rust(std::rc::Rc::new(|_cmd| {
            Box::pin(async move { Ok(AsyncResponse { ok: true, value: Some(serde_json::json!(2)), error: None }) })
                as Pin<Box<dyn Future<Output = Result<AsyncResponse, String>>>>
        }));

        assert!(register_handler("dup_test", handler1));
        assert!(!register_handler("dup_test", handler2));
        assert!(has_handler("dup_test"));

        // Verify the original handler (handler1) is still the one that runs
        let cmd = AsyncCommand {
            call_id: 1,
            action: "dup_test".to_string(),
            params: serde_json::json!({}),
            run_id: None,
        };
        let fut = dispatch_handler("dup_test", cmd);
        assert!(fut.is_some());
        let result = block_on(fut.unwrap());
        assert!(result.is_ok());
        assert_eq!(result.unwrap().value, Some(serde_json::json!(1)));

        clear_handlers();
    }

    #[test]
    fn test_dispatch_handler_returns_future_for_rust_handler() {
        clear_handlers();

        let handler = ApiHandler::Rust(std::rc::Rc::new(|cmd| {
            Box::pin(async move {
                Ok(AsyncResponse {
                    ok: true,
                    value: Some(serde_json::json!(cmd.action)),
                    error: None,
                })
            }) as Pin<Box<dyn Future<Output = Result<AsyncResponse, String>>>>
        }));
        register_handler("rust_action", handler);

        let cmd = AsyncCommand {
            call_id: 1,
            action: "rust_action".to_string(),
            params: serde_json::json!({}),
            run_id: None,
        };

        let fut = dispatch_handler("rust_action", cmd);
        assert!(fut.is_some(), "dispatch_handler should return Some(future) for registered Rust handler");

        // Await the future and verify the response
        let result = block_on(fut.unwrap());
        assert!(result.is_ok(), "Future should resolve successfully");
        let resp = result.unwrap();
        assert!(resp.ok);
        assert_eq!(resp.value, Some(serde_json::json!("rust_action")));

        clear_handlers();
    }

    #[test]
    fn test_dispatch_handler_returns_none_for_unknown_action() {
        clear_handlers();

        let cmd = AsyncCommand {
            call_id: 1,
            action: "unknown".to_string(),
            params: serde_json::json!({}),
            run_id: None,
        };

        let fut = dispatch_handler("unknown", cmd);
        assert!(fut.is_none(), "dispatch_handler should return None for unknown action");

        clear_handlers();
    }

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test::wasm_bindgen_test]
    fn test_register_handler_accepts_js_callback() {
        clear_handlers();

        // Use a real JS function instead of undefined
        let cb = js_sys::Function::new_no_args("return Promise.resolve({ok:true,value:null,error:null})");
        assert!(register_handler("js_registered_action", ApiHandler::JsCallback(JsValue::from(cb))));
        assert!(has_handler("js_registered_action"));

        clear_handlers();
    }

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test::wasm_bindgen_test]
    async fn test_js_callback_dispatch_success() {
        clear_handlers();

        // Create a JS function that returns a resolved Promise with an AsyncResponse
        let cb = js_sys::Function::new_no_args(
            "return Promise.resolve({ok:true,value:42,error:null})"
        );
        assert!(register_handler("js_success", ApiHandler::JsCallback(JsValue::from(cb))));

        let cmd = AsyncCommand {
            call_id: 1,
            action: "js_success".to_string(),
            params: serde_json::json!({}),
            run_id: None,
        };

        let fut = dispatch_handler("js_success", cmd);
        assert!(fut.is_some());
        let result = fut.unwrap().await;
        assert!(result.is_ok(), "Expected Ok, got: {:?}", result);
        let resp = result.unwrap();
        assert!(resp.ok);
        assert_eq!(resp.value, Some(serde_json::json!(42)));

        clear_handlers();
    }

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test::wasm_bindgen_test]
    async fn test_js_callback_dispatch_rejection() {
        clear_handlers();

        // Create a JS function that returns a rejected Promise
        let cb = js_sys::Function::new_no_args(
            "return Promise.reject(new Error('test rejection'))"
        );
        assert!(register_handler("js_reject", ApiHandler::JsCallback(JsValue::from(cb))));

        let cmd = AsyncCommand {
            call_id: 1,
            action: "js_reject".to_string(),
            params: serde_json::json!({}),
            run_id: None,
        };

        let fut = dispatch_handler("js_reject", cmd);
        assert!(fut.is_some());
        let result = fut.unwrap().await;
        assert!(result.is_err(), "Expected Err, got: {:?}", result);
        let err = result.unwrap_err();
        assert!(err.contains("rejected"), "Error should mention rejection, got: {}", err);

        clear_handlers();
    }

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test::wasm_bindgen_test]
    async fn test_js_callback_dispatch_timeout() {
        clear_handlers();

        // Create a JS function that returns a never-resolving Promise
        let cb = js_sys::Function::new_no_args(
            "return new Promise(() => {})"
        );
        assert!(register_handler("js_timeout", ApiHandler::JsCallback(JsValue::from(cb))));

        let cmd = AsyncCommand {
            call_id: 1,
            action: "js_timeout".to_string(),
            params: serde_json::json!({}),
            run_id: None,
        };

        let fut = dispatch_handler("js_timeout", cmd);
        assert!(fut.is_some());
        let result = fut.unwrap().await;
        assert!(result.is_err(), "Expected Err, got: {:?}", result);
        let err = result.unwrap_err();
        assert!(err.contains("timed out"), "Error should mention timeout, got: {}", err);

        clear_handlers();
    }
}
