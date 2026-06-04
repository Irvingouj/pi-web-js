use serde::ser::SerializeStruct;
use serde::Serialize;
use std::cell::RefCell;

/// How the API is invoked across the JS/Rust boundary.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub enum ToolTransport {
    Async,
    Sync,
    Event,
}

/// Where the API implementation lives.
#[derive(Clone, Debug, Serialize, PartialEq)]
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

#[derive(Clone, Debug, Serialize)]
pub struct ParamDoc {
    pub name: String,
    pub js_type: String,
    pub required: bool,
    pub description: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ReturnDoc {
    pub js_type: String,
    pub description: String,
}

thread_local! {
    pub(crate) static REGISTRY: RefCell<Vec<JsApiDoc>> = const { RefCell::new(Vec::new()) };
}

pub fn register(doc: JsApiDoc) {
    REGISTRY.with(|reg| {
        let mut registry = reg.borrow_mut();
        // Avoid duplicates when sessions are recreated (e.g. reset)
        if !registry
            .iter()
            .any(|d| d.namespace == doc.namespace && d.name == doc.name)
        {
            registry.push(doc);
        }
    });
}

/// Clear all registered API docs. Primarily useful in tests.
pub fn clear_docs() {
    REGISTRY.with(|reg| reg.borrow_mut().clear());
}

/// Return a snapshot of all registered API docs.
pub fn list_docs() -> Vec<JsApiDoc> {
    REGISTRY.with(|reg| reg.borrow().clone())
}

pub fn generate_json() -> String {
    let docs = REGISTRY.with(|reg| reg.borrow().clone());
    serde_json::to_string_pretty(&docs).unwrap()
}

pub fn generate_markdown() -> String {
    let docs = REGISTRY.with(|reg| reg.borrow().clone());
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

pub fn generate(format: &str) -> String {
    match format {
        "json" => generate_json(),
        "markdown" | "md" => generate_markdown(),
        _ => generate_markdown(),
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
pub fn generate_js_bindings_code() -> String {
    let docs = REGISTRY.with(|reg| reg.borrow().clone());
    let mut specs = Vec::new();

    for doc in &docs {
        // Only generate bindings for async APIs that have an action
        if doc.transport != ToolTransport::Async {
            continue;
        }
        let Some(action) = &doc.action else {
            continue;
        };
        if action.is_empty() {
            continue;
        }

        // Escape strings for JS
        let ns = doc.namespace.replace('\\', "\\\\").replace('"', "\\\"");
        let name = doc.name.replace('\\', "\\\\").replace('"', "\\\"");
        let action_escaped = action.replace('\\', "\\\\").replace('"', "\\\"");

        let fields_js = match &doc.fields {
            Some(fields) if !fields.is_empty() => {
                let escaped: Vec<String> = fields.iter()
                    .map(|f| f.replace('\\', "\\\\").replace('"', "\\\""))
                    .collect();
                format!(",fields:[{}]",
                    escaped.iter().map(|f| format!("\"{}\"", f)).collect::<Vec<_>>().join(",")
                )
            }
            _ => String::new(),
        };

        specs.push(format!(
            r#"{{namespace:"{}",name:"{}",action:"{}"{}}}"#,
            ns, name, action_escaped, fields_js
        ));
    }

    if specs.is_empty() {
        return String::new();
    }

    format!(
        "__webJsSetupAsyncBindings([\n  {}\n]);",
        specs.join(",\n  ")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

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

        let json = generate_json();
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

        let json = generate("json");
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

        let md = generate("markdown");
        assert!(md.contains("## `crypto` module"));
        assert!(md.contains("### `crypto.hash`"));

        let md_short = generate("md");
        assert!(md_short.contains("## `crypto` module"));
    }

    #[test]
    fn test_generate_js_bindings_code_produces_valid_js() {
        clear_docs();

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
        assert!(
            js.ends_with("]);"),
            "generated JS must end with ]);"
        );
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
        assert_eq!(js, "", "generate_js_bindings_code must return empty string when no async APIs are registered");
    }

    #[test]
    fn test_generate_js_bindings_code_escapes_strings() {
        clear_docs();

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

        let js = generate_js_bindings_code();
        assert!(
            js.contains(r#"namespace:"web",name:"sleep",action:"sleep",fields:["duration"]"#),
            "generated JS must include fields array"
        );
    }

    #[test]
    fn test_generate_js_bindings_code_includes_new_namespaces() {
        clear_docs();

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

        let js = generate_js_bindings_code();

        // Must contain the new namespace bindings
        assert!(
            js.contains(r#"namespace:"chrome.sessions",name:"getRecentlyClosed",action:"chrome_sessions_getRecentlyClosed""#),
            "generated JS must contain chrome.sessions.getRecentlyClosed binding"
        );
        assert!(
            js.contains(r#"namespace:"chrome.windows",name:"getCurrent",action:"chrome_windows_getCurrent""#),
            "generated JS must contain chrome.windows.getCurrent binding"
        );
    }
}
