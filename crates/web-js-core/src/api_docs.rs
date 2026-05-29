use serde::Serialize;
use std::sync::Mutex;

#[derive(Clone, Debug, Serialize)]
pub struct JsApiDoc {
    pub namespace: String,
    pub name: String,
    pub action: Option<String>,
    pub description: String,
    pub params: Vec<ParamDoc>,
    pub returns: ReturnDoc,
    pub source: String,
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

pub(crate) static REGISTRY: Mutex<Vec<JsApiDoc>> = Mutex::new(Vec::new());

pub fn register(doc: JsApiDoc) {
    let mut registry = REGISTRY.lock().unwrap();
    // Avoid duplicates when sessions are recreated (e.g. reset)
    if !registry
        .iter()
        .any(|d| d.namespace == doc.namespace && d.name == doc.name)
    {
        registry.push(doc);
    }
}

pub fn generate_json() -> String {
    let docs = REGISTRY.lock().unwrap().clone();
    serde_json::to_string_pretty(&docs).unwrap()
}

pub fn generate_markdown() -> String {
    let docs = REGISTRY.lock().unwrap().clone();
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

/// Register all JS API documentation entries.
/// Call this once during web module initialization.
pub fn register_all_api_docs() {
    // ── web namespace ──
    register(JsApiDoc {
        namespace: "web".into(),
        name: "fetch".into(),
        action: Some("fetch".into()),
        description: "Perform an HTTP fetch request.".into(),
        params: vec![
            param("url", "string", true, "URL to fetch"),
            param("opts", "object | null", false, "Options: method, body, headers, timeout"),
        ],
        returns: ret("object", "{ status, ok, body, headers }"),
        source: "rust_core".into(),
    });
    register(JsApiDoc {
        namespace: "web".into(),
        name: "sleep".into(),
        action: Some("sleep".into()),
        description: "Pause execution for a duration.".into(),
        params: vec![
            param("ms", "number", false, "Milliseconds to sleep (default 1000)"),
        ],
        returns: ret("null", "None"),
        source: "rust_core".into(),
    });
    register(JsApiDoc {
        namespace: "web".into(),
        name: "mock_async".into(),
        action: Some("mock_async".into()),
        description: "Yield for testing, resumes with provided value.".into(),
        params: vec![
            param("label", "string | null", false, "Test label"),
        ],
        returns: ret("string", "Test label echoed back"),
        source: "rust_core".into(),
    });
    register(JsApiDoc {
        namespace: "web".into(),
        name: "log".into(),
        action: Some("web_log".into()),
        description: "Log a message to the browser console.".into(),
        params: vec![
            param("message", "any", true, "Value to log"),
        ],
        returns: ret("null", "None"),
        source: "rust_core".into(),
    });

    // ── web.url ──
    register(JsApiDoc {
        namespace: "web.url".into(),
        name: "parse".into(),
        action: Some("url_parse".into()),
        description: "Parse a URL string into components.".into(),
        params: vec![
            param("url", "string", true, "URL string to parse"),
        ],
        returns: ret("object", "Parsed URL components: scheme, host, port, path, query, fragment"),
        source: "rust_core".into(),
    });
    register(JsApiDoc {
        namespace: "web.url".into(),
        name: "encode".into(),
        action: Some("url_encode".into()),
        description: "Encode an object into a query string.".into(),
        params: vec![
            param("params", "object", true, "Key-value pairs to encode"),
        ],
        returns: ret("string", "URL-encoded query string"),
        source: "rust_core".into(),
    });

    // ── web.tab ──
    let tab_apis = [
        ("query", "tab_query", "Query Chrome tabs matching given criteria.", vec![
            param("query_info", "object", false, "Query filter: active, currentWindow, url, etc."),
        ], "object", "Array of matching tab objects"),
        ("create", "tab_create", "Create a new tab.", vec![
            param("create_properties", "object", false, "URL, windowId, active, etc."),
        ], "object", "Created tab object"),
        ("activate", "tab_activate", "Activate (focus) a tab.", vec![
            param("tab_id", "number", true, "Tab ID to activate"),
        ], "boolean", "Whether activation succeeded"),
        ("close", "tab_close", "Close a tab.", vec![
            param("tab_id", "number", true, "Tab ID to close"),
        ], "boolean", "Whether close succeeded"),
        ("execute_script", "tab_execute_script", "Execute JavaScript in a target tab.", vec![
            param("tab_id", "number", true, "Target tab ID"),
            param("script", "string | object", true, "Script code or injection details"),
        ], "object", "Injection results"),
        ("click", "tab_click", "Click an element by refId in the target tab.", vec![
            param("tab_id", "number", true, "Target tab ID"),
            param("ref_id", "number", true, "Element refId from snapshot"),
        ], "boolean", "Whether the click succeeded"),
        ("fill", "tab_fill", "Fill an input element by refId in the target tab.", vec![
            param("tab_id", "number", true, "Target tab ID"),
            param("ref_id", "number", true, "Element refId from snapshot"),
            param("value", "string", true, "Text to fill"),
        ], "boolean", "Whether fill succeeded"),
        ("snapshot", "tab_snapshot", "Take a DOM snapshot of the target tab and return readable text. Defaults to active tab.", vec![
            param("tab_id", "number", false, "Target tab ID (defaults to active tab)"),
        ], "string", "Human-readable accessibility tree with refIds"),
        ("snapshot_text", "tab_snapshot_text", "Take a DOM snapshot and return readable text (explicit alias). Defaults to active tab.", vec![
            param("tab_id", "number", false, "Target tab ID (defaults to active tab)"),
        ], "string", "Human-readable accessibility tree with refIds"),
        ("snapshot_data", "tab_snapshot_data", "Take a DOM snapshot and return structured data. Defaults to active tab.", vec![
            param("tab_id", "number", false, "Target tab ID (defaults to active tab)"),
        ], "object", "Structured snapshot with nodes, url, title, viewport"),
        ("scroll_to", "tab_scroll_to", "Scroll to an element by refId in the target tab.", vec![
            param("tab_id", "number", true, "Target tab ID"),
            param("ref_id", "number", true, "Element refId from snapshot"),
        ], "boolean", "Whether scroll succeeded"),
        ("evaluate", "tab_evaluate", "Evaluate JavaScript in a target tab and return the result.", vec![
            param("tab_id", "number", true, "Target tab ID"),
            param("script", "string", true, "JavaScript code to evaluate"),
        ], "any", "Evaluation result"),
        ("back", "tab_back", "Navigate back in a target tab.", vec![
            param("tab_id", "number", true, "Target tab ID"),
        ], "boolean", "Whether navigation succeeded"),
        ("wait_for_load", "tab_wait_for_load", "Wait for a tab to finish loading.", vec![
            param("tab_id", "number", true, "Target tab ID"),
            param("timeout", "number", false, "Timeout in milliseconds (default 30000)"),
        ], "boolean", "Whether the tab loaded"),
        ("type", "tab_type", "Type text into an input element by refId in the target tab (appends).", vec![
            param("tab_id", "number", true, "Target tab ID"),
            param("ref_id", "number", true, "Element refId from snapshot"),
            param("text", "string", true, "Text to type"),
        ], "boolean", "Whether type succeeded"),
        ("press", "tab_press", "Dispatch a keyboard key press in the target tab.", vec![
            param("tab_id", "number", true, "Target tab ID"),
            param("key", "string", true, "Key to press (e.g. 'Enter', 'Escape')"),
        ], "boolean", "Whether press succeeded"),
        ("select", "tab_select", "Select an option in a dropdown by refId in the target tab.", vec![
            param("tab_id", "number", true, "Target tab ID"),
            param("ref_id", "number", true, "Element refId from snapshot"),
            param("value", "string", true, "Option value to select"),
        ], "boolean", "Whether select succeeded"),
        ("check", "tab_check", "Toggle a checkbox by refId in the target tab.", vec![
            param("tab_id", "number", true, "Target tab ID"),
            param("ref_id", "number", true, "Element refId from snapshot"),
            param("checked", "boolean", false, "Desired checked state (default true)"),
        ], "boolean", "Whether check succeeded"),
        ("hover", "tab_hover", "Hover over an element by refId in the target tab.", vec![
            param("tab_id", "number", true, "Target tab ID"),
            param("ref_id", "number", true, "Element refId from snapshot"),
        ], "boolean", "Whether hover succeeded"),
        ("unhover", "tab_unhover", "Unhover (mouseleave) an element by refId in the target tab.", vec![
            param("tab_id", "number", true, "Target tab ID"),
        ], "boolean", "Whether unhover succeeded"),
        ("scroll", "tab_scroll", "Scroll the target tab page.", vec![
            param("tab_id", "number", true, "Target tab ID"),
            param("direction", "string", false, "Scroll direction: up or down (default down)"),
            param("amount", "number", false, "Scroll amount in pixels (default 300)"),
        ], "boolean", "Whether scroll succeeded"),
        ("dblclick", "tab_dblclick", "Double-click an element by refId in the target tab.", vec![
            param("tab_id", "number", true, "Target tab ID"),
            param("ref_id", "number", true, "Element refId from snapshot"),
        ], "boolean", "Whether dblclick succeeded"),
        ("fetch", "tab_fetch", "Perform an HTTP fetch inside a target tab origin.", vec![
            param("tab_id", "number", true, "Target tab ID"),
            param("url", "string", true, "URL to fetch"),
            param("opts", "object | null", false, "Options: method, body, headers, timeout"),
        ], "object", "{ status, ok, body, headers }"),
    ];
    for (name, action, desc, params, rtype, rdesc) in tab_apis {
        register(JsApiDoc {
            namespace: "web.tab".into(),
            name: name.into(),
            action: Some(action.into()),
            description: desc.into(),
            params,
            returns: ret(rtype, rdesc),
            source: "rust_core".into(),
        });
    }

    // ── web.storage ──
    register(JsApiDoc {
        namespace: "web.storage".into(),
        name: "get".into(),
        action: Some("storage_get".into()),
        description: "Get a value from web storage.".into(),
        params: vec![
            param("key", "string", true, "Storage key"),
        ],
        returns: ret("string | null", "Stored value or null"),
        source: "rust_core".into(),
    });
    register(JsApiDoc {
        namespace: "web.storage".into(),
        name: "set".into(),
        action: Some("storage_set".into()),
        description: "Set a value in web storage.".into(),
        params: vec![
            param("key", "string", true, "Storage key"),
            param("value", "string", true, "Value to store"),
        ],
        returns: ret("boolean", "Whether set succeeded"),
        source: "rust_core".into(),
    });
    register(JsApiDoc {
        namespace: "web.storage".into(),
        name: "delete".into(),
        action: Some("storage_delete".into()),
        description: "Remove a key from web storage.".into(),
        params: vec![
            param("key", "string", true, "Storage key to remove"),
        ],
        returns: ret("boolean", "Whether deletion succeeded"),
        source: "rust_core".into(),
    });
    register(JsApiDoc {
        namespace: "web.storage".into(),
        name: "list".into(),
        action: Some("storage_list".into()),
        description: "List all keys in web storage.".into(),
        params: vec![],
        returns: ret("object", "Array of key strings"),
        source: "rust_core".into(),
    });

    // ── web.cookies ──
    let cookies_apis = [
        ("get", "cookies_get", "Get a cookie by name and URL.", vec![
            param("details", "object", true, "Cookie query: name, url, storeId"),
        ], "object | null", "Cookie object or null if not found"),
        ("set", "cookies_set", "Set a cookie.", vec![
            param("details", "object", true, "Cookie to set: name, value, url, etc."),
        ], "object", "Set cookie object"),
        ("delete", "cookies_delete", "Delete a cookie.", vec![
            param("details", "object", true, "Cookie to delete: name, url"),
        ], "boolean", "Whether deletion succeeded"),
        ("list", "cookies_list", "List cookies matching a filter.", vec![
            param("filter", "object", false, "Filter: url, name, domain, etc."),
        ], "object", "Array of cookie objects"),
    ];
    for (name, action, desc, params, rtype, rdesc) in cookies_apis {
        register(JsApiDoc {
            namespace: "web.cookies".into(),
            name: name.into(),
            action: Some(action.into()),
            description: desc.into(),
            params,
            returns: ret(rtype, rdesc),
            source: "rust_core".into(),
        });
    }

    // ── web.history ──
    register(JsApiDoc {
        namespace: "web.history".into(),
        name: "search".into(),
        action: Some("history_search".into()),
        description: "Search browser history.".into(),
        params: vec![
            param("query", "object", true, "Search query: text, startTime, endTime, maxResults"),
        ],
        returns: ret("object", "Array of history items"),
        source: "rust_core".into(),
    });
    register(JsApiDoc {
        namespace: "web.history".into(),
        name: "delete".into(),
        action: Some("history_delete".into()),
        description: "Delete a URL from browser history.".into(),
        params: vec![
            param("url", "string", true, "URL to remove from history"),
        ],
        returns: ret("boolean", "Whether deletion succeeded"),
        source: "rust_core".into(),
    });

    // ── web.bookmarks ──
    register(JsApiDoc {
        namespace: "web.bookmarks".into(),
        name: "search".into(),
        action: Some("bookmarks_search".into()),
        description: "Search bookmarks.".into(),
        params: vec![
            param("query", "string | object", true, "Search string or query object"),
        ],
        returns: ret("object", "Array of bookmark nodes"),
        source: "rust_core".into(),
    });
    register(JsApiDoc {
        namespace: "web.bookmarks".into(),
        name: "create".into(),
        action: Some("bookmarks_create".into()),
        description: "Create a bookmark or folder.".into(),
        params: vec![
            param("bookmark", "object", true, "Bookmark properties: parentId, title, url"),
        ],
        returns: ret("object", "Created bookmark node"),
        source: "rust_core".into(),
    });
    register(JsApiDoc {
        namespace: "web.bookmarks".into(),
        name: "delete".into(),
        action: Some("bookmarks_delete".into()),
        description: "Delete a bookmark.".into(),
        params: vec![
            param("id", "string", true, "Bookmark node ID to delete"),
        ],
        returns: ret("boolean", "Whether deletion succeeded"),
        source: "rust_core".into(),
    });

    // ── web.notifications ──
    register(JsApiDoc {
        namespace: "web.notifications".into(),
        name: "create".into(),
        action: Some("notifications_create".into()),
        description: "Create a browser notification.".into(),
        params: vec![
            param("id", "string | null", false, "Notification ID (null for auto-generated)"),
            param("options", "object", true, "Notification options: type, title, message, iconUrl"),
        ],
        returns: ret("string", "Notification ID"),
        source: "rust_core".into(),
    });
    register(JsApiDoc {
        namespace: "web.notifications".into(),
        name: "clear".into(),
        action: Some("notifications_clear".into()),
        description: "Clear a browser notification.".into(),
        params: vec![
            param("id", "string", true, "Notification ID to clear"),
        ],
        returns: ret("boolean", "Whether notification was cleared"),
        source: "rust_core".into(),
    });

    // ── web.clipboard ──
    register(JsApiDoc {
        namespace: "web.clipboard".into(),
        name: "read".into(),
        action: Some("clipboard_read".into()),
        description: "Read text from the system clipboard.".into(),
        params: vec![],
        returns: ret("string | null", "Clipboard text or null"),
        source: "rust_core".into(),
    });
    register(JsApiDoc {
        namespace: "web.clipboard".into(),
        name: "write".into(),
        action: Some("clipboard_write".into()),
        description: "Write text to the system clipboard.".into(),
        params: vec![
            param("text", "string", true, "Text to write"),
        ],
        returns: ret("boolean", "Whether write succeeded"),
        source: "rust_core".into(),
    });

    // ── fs ──
    let fs_apis = [
        ("exists", "fs_exists", "Check whether a path exists in the virtual filesystem.", vec![
            param("path", "string", true, "Absolute VFS path"),
        ], "boolean", "true if the path exists"),
        ("stat", "fs_stat", "Get metadata for a path.", vec![
            param("path", "string", true, "Absolute VFS path"),
        ], "object | null", "Metadata object or null if not found"),
        ("list", "fs_list", "List entries in a directory.", vec![
            param("path", "string", true, "Absolute VFS directory path"),
        ], "object", "Array of DirEntry objects"),
        ("mkdir", "fs_mkdir", "Create a directory (and parents if needed).", vec![
            param("path", "string", true, "Absolute VFS directory path"),
        ], "boolean", "true on success"),
        ("delete", "fs_delete", "Delete a file or directory (recursive for directories).", vec![
            param("path", "string", true, "Absolute VFS path to delete"),
        ], "boolean", "true on success"),
        ("copy", "fs_copy", "Copy a file from one path to another.", vec![
            param("from", "string", true, "Source absolute VFS path"),
            param("to", "string", true, "Destination absolute VFS path"),
        ], "boolean", "true on success"),
        ("move", "fs_move", "Move (rename) a file from one path to another.", vec![
            param("from", "string", true, "Source absolute VFS path"),
            param("to", "string", true, "Destination absolute VFS path"),
        ], "boolean", "true on success"),
        ("read", "fs_read", "Read raw bytes from a file. Returns base64-encoded string over the async wire.", vec![
            param("path", "string", true, "Absolute VFS file path"),
        ], "string", "Base64-encoded file contents"),
        ("read_text", "fs_read_text", "Read a file as UTF-8 text.", vec![
            param("path", "string", true, "Absolute VFS file path"),
        ], "string | null", "File contents or null"),
        ("read_base64", "fs_read_base64", "Read a file and return its contents as base64.", vec![
            param("path", "string", true, "Absolute VFS file path"),
        ], "string | null", "Base64-encoded contents or null"),
        ("read_range", "fs_read_range", "Read a byte range from a file.", vec![
            param("path", "string", true, "Absolute VFS file path"),
            param("offset", "number", true, "Byte offset to start reading"),
            param("len", "number", true, "Number of bytes to read"),
        ], "string", "Base64-encoded range contents"),
        ("write", "fs_write", "Write raw bytes to a file (overwrites existing). Data is base64-encoded over the wire.", vec![
            param("path", "string", true, "Absolute VFS file path"),
            param("data", "string", true, "Raw byte string to write"),
        ], "boolean", "true on success"),
        ("write_text", "fs_write_text", "Write UTF-8 text to a file (overwrites existing).", vec![
            param("path", "string", true, "Absolute VFS file path"),
            param("text", "string", true, "Text to write"),
        ], "boolean", "true on success"),
        ("write_base64", "fs_write_base64", "Write base64-decoded bytes to a file (overwrites existing).", vec![
            param("path", "string", true, "Absolute VFS file path"),
            param("b64", "string", true, "Base64-encoded data"),
        ], "boolean", "true on success"),
        ("append", "fs_append", "Append raw bytes to a file. Data is base64-encoded over the wire.", vec![
            param("path", "string", true, "Absolute VFS file path"),
            param("data", "string", true, "Raw byte string to append"),
        ], "boolean", "true on success"),
        ("append_text", "fs_append_text", "Append UTF-8 text to a file.", vec![
            param("path", "string", true, "Absolute VFS file path"),
            param("text", "string", true, "Text to append"),
        ], "boolean", "true on success"),
        ("append_base64", "fs_append_base64", "Append base64-decoded bytes to a file.", vec![
            param("path", "string", true, "Absolute VFS file path"),
            param("b64", "string", true, "Base64-encoded data"),
        ], "boolean", "true on success"),
        ("update", "fs_update", "Write raw bytes at a specific offset in a file. Data is base64-encoded over the wire.", vec![
            param("path", "string", true, "Absolute VFS file path"),
            param("offset", "number", true, "Byte offset"),
            param("data", "string", true, "Raw byte string to write"),
        ], "boolean", "true on success"),
        ("hash", "fs_hash", "Compute a hash of a file's contents.", vec![
            param("path", "string", true, "Absolute VFS file path"),
            param("algo", "string", true, "Hash algorithm (sha256 or sha1)"),
        ], "string | null", "Hex-encoded hash or null"),
    ];
    for (name, action, desc, params, rtype, rdesc) in fs_apis {
        register(JsApiDoc {
            namespace: "fs".into(),
            name: name.into(),
            action: Some(action.into()),
            description: desc.into(),
            params,
            returns: ret(rtype, rdesc),
            source: "rust_core".into(),
        });
    }

    // ── fs Node.js compat ──
    let fs_compat = [
        ("readFile", "Node.js compatible readFile.", vec![
            param("path", "string", true, "Absolute VFS file path"),
            param("options", "object | null", false, "Options or encoding"),
            param("callback", "function", true, "Callback(err, data)"),
        ], "undefined", "None"),
        ("readFileSync", "Node.js compatible readFileSync.", vec![
            param("path", "string", true, "Absolute VFS file path"),
            param("options", "object | null", false, "Options or encoding"),
        ], "string | object", "File contents"),
        ("writeFile", "Node.js compatible writeFile.", vec![
            param("path", "string", true, "Absolute VFS file path"),
            param("data", "string | object", true, "Data to write"),
            param("options", "object | null", false, "Options or encoding"),
            param("callback", "function", true, "Callback(err)"),
        ], "undefined", "None"),
        ("writeFileSync", "Node.js compatible writeFileSync.", vec![
            param("path", "string", true, "Absolute VFS file path"),
            param("data", "string | object", true, "Data to write"),
            param("options", "object | null", false, "Options or encoding"),
        ], "undefined", "None"),
        ("appendFile", "Node.js compatible appendFile.", vec![
            param("path", "string", true, "Absolute VFS file path"),
            param("data", "string | object", true, "Data to append"),
            param("options", "object | null", false, "Options or encoding"),
            param("callback", "function", true, "Callback(err)"),
        ], "undefined", "None"),
        ("appendFileSync", "Node.js compatible appendFileSync.", vec![
            param("path", "string", true, "Absolute VFS file path"),
            param("data", "string | object", true, "Data to append"),
            param("options", "object | null", false, "Options or encoding"),
        ], "undefined", "None"),
        ("existsSync", "Node.js compatible existsSync.", vec![
            param("path", "string", true, "Absolute VFS path"),
        ], "boolean", "true if the path exists"),
        ("readdirSync", "Node.js compatible readdirSync.", vec![
            param("path", "string", true, "Absolute VFS directory path"),
            param("options", "object | null", false, "Options"),
        ], "object", "Array of entry names"),
        ("mkdirSync", "Node.js compatible mkdirSync.", vec![
            param("path", "string", true, "Absolute VFS directory path"),
            param("options", "object | null", false, "Options"),
        ], "undefined", "None"),
        ("unlinkSync", "Node.js compatible unlinkSync.", vec![
            param("path", "string", true, "Absolute VFS file path"),
        ], "undefined", "None"),
        ("rmdirSync", "Node.js compatible rmdirSync.", vec![
            param("path", "string", true, "Absolute VFS directory path"),
        ], "undefined", "None"),
        ("copyFileSync", "Node.js compatible copyFileSync.", vec![
            param("src", "string", true, "Source absolute VFS path"),
            param("dest", "string", true, "Destination absolute VFS path"),
        ], "undefined", "None"),
        ("renameSync", "Node.js compatible renameSync.", vec![
            param("oldPath", "string", true, "Old absolute VFS path"),
            param("newPath", "string", true, "New absolute VFS path"),
        ], "undefined", "None"),
        ("statSync", "Node.js compatible statSync.", vec![
            param("path", "string", true, "Absolute VFS path"),
        ], "object", "Stats object"),
        ("promises", "Node.js promises-compatible object.", vec![
        ], "object", "Promise-based fs API"),
    ];
    for (name, desc, params, rtype, rdesc) in fs_compat {
        register(JsApiDoc {
            namespace: "fs".into(),
            name: name.into(),
            action: None,
            description: desc.into(),
            params,
            returns: ret(rtype, rdesc),
            source: "js_prelude".into(),
        });
    }

    // ── global fetch ──
    register(JsApiDoc {
        namespace: "global".into(),
        name: "fetch".into(),
        action: None,
        description: "Global fetch — alias for web.fetch.".into(),
        params: vec![
            param("url", "string", true, "URL to fetch"),
            param("opts", "object | null", false, "Options: method, body, headers, timeout"),
        ],
        returns: ret("object", "{ status, ok, body, headers }"),
        source: "js_prelude".into(),
    });

    // ── global setTimeout / setInterval / clearTimeout / clearInterval ──
    register(JsApiDoc {
        namespace: "global".into(),
        name: "setTimeout".into(),
        action: None,
        description: "Schedule a function to run after a delay.".into(),
        params: vec![
            param("fn", "function", true, "Callback function"),
            param("ms", "number", false, "Delay in milliseconds (default 0)"),
        ],
        returns: ret("number", "Timeout ID"),
        source: "js_prelude".into(),
    });
    register(JsApiDoc {
        namespace: "global".into(),
        name: "setInterval".into(),
        action: None,
        description: "Schedule a function to run repeatedly.".into(),
        params: vec![
            param("fn", "function", true, "Callback function"),
            param("ms", "number", false, "Interval in milliseconds (default 0)"),
        ],
        returns: ret("number", "Interval ID"),
        source: "js_prelude".into(),
    });
    register(JsApiDoc {
        namespace: "global".into(),
        name: "clearTimeout".into(),
        action: None,
        description: "Cancel a scheduled timeout.".into(),
        params: vec![
            param("id", "number", true, "Timeout ID"),
        ],
        returns: ret("undefined", "None"),
        source: "js_prelude".into(),
    });
    register(JsApiDoc {
        namespace: "global".into(),
        name: "clearInterval".into(),
        action: None,
        description: "Cancel a scheduled interval.".into(),
        params: vec![
            param("id", "number", true, "Interval ID"),
        ],
        returns: ret("undefined", "None"),
        source: "js_prelude".into(),
    });

    // ── global URL / URLSearchParams ──
    register(JsApiDoc {
        namespace: "global".into(),
        name: "URL".into(),
        action: None,
        description: "URL class — parses a URL string into components.".into(),
        params: vec![
            param("url", "string", true, "URL string"),
            param("base", "string | null", false, "Base URL for relative URLs"),
        ],
        returns: ret("object", "URL object with href, protocol, host, pathname, search, hash"),
        source: "js_prelude".into(),
    });
    register(JsApiDoc {
        namespace: "global".into(),
        name: "URLSearchParams".into(),
        action: None,
        description: "URLSearchParams — manage query string parameters.".into(),
        params: vec![
            param("init", "string | object | null", false, "Query string or object of key-value pairs"),
        ],
        returns: ret("object", "URLSearchParams instance with append, get, set, delete, toString"),
        source: "js_prelude".into(),
    });

    // ── global localStorage / sessionStorage ──
    register(JsApiDoc {
        namespace: "global".into(),
        name: "localStorage".into(),
        action: None,
        description: "localStorage — wraps web.storage for LLM familiarity.".into(),
        params: vec![],
        returns: ret("object", "Storage object with getItem, setItem, removeItem, clear, key, length"),
        source: "js_prelude".into(),
    });
    register(JsApiDoc {
        namespace: "global".into(),
        name: "sessionStorage".into(),
        action: None,
        description: "sessionStorage — alias for localStorage (same backend).".into(),
        params: vec![],
        returns: ret("object", "Storage object with getItem, setItem, removeItem, clear, key, length"),
        source: "js_prelude".into(),
    });

    // ── global document / window / navigator ──
    register(JsApiDoc {
        namespace: "global".into(),
        name: "document".into(),
        action: None,
        description: "document — minimal stub with querySelector, querySelectorAll, title, URL.".into(),
        params: vec![],
        returns: ret("object", "Document proxy object"),
        source: "js_prelude".into(),
    });
    register(JsApiDoc {
        namespace: "global".into(),
        name: "window".into(),
        action: None,
        description: "window — minimal stub with location, document, fetch, localStorage, navigator, setTimeout.".into(),
        params: vec![],
        returns: ret("object", "Window proxy object"),
        source: "js_prelude".into(),
    });
    register(JsApiDoc {
        namespace: "global".into(),
        name: "navigator".into(),
        action: None,
        description: "navigator — minimal stub with clipboard.".into(),
        params: vec![],
        returns: ret("object", "Navigator proxy object with clipboard"),
        source: "js_prelude".into(),
    });

    // ── chrome.runtime ──
    register(JsApiDoc {
        namespace: "chrome.runtime".into(),
        name: "sendMessage".into(),
        action: Some("chrome_runtime_sendMessage".into()),
        description: "Send a message to the extension background script or another extension.".into(),
        params: vec![
            param("message", "any", true, "Message payload"),
            param("options", "object | null", false, "Options: to, includeTlsChannelId"),
        ],
        returns: ret("any", "Response from the recipient"),
        source: "rust_core".into(),
    });

    // ── chrome.tabs ──
    let chrome_tabs = [
        ("query", "chrome_tabs_query", "Query Chrome tabs matching given criteria.", vec![
            param("query_info", "object", true, "Query filter: active, currentWindow, url, etc."),
        ], "object", "Array of matching tab objects"),
        ("create", "chrome_tabs_create", "Create a new Chrome tab.", vec![
            param("create_properties", "object", false, "URL, windowId, active, etc."),
        ], "object", "Created tab object"),
        ("update", "chrome_tabs_update", "Update properties of a tab.", vec![
            param("tab_id", "number | null", false, "Tab ID (null for active tab)"),
            param("update_properties", "object", true, "Properties: url, active, muted, etc."),
        ], "object", "Updated tab object"),
        ("remove", "chrome_tabs_remove", "Close one or more tabs.", vec![
            param("tab_ids", "number | object", true, "Tab ID or array of tab IDs"),
        ], "boolean", "Whether removal succeeded"),
        ("get", "chrome_tabs_get", "Get a tab by ID.", vec![
            param("tab_id", "number", true, "Tab ID"),
        ], "object", "Tab object"),
        ("reload", "chrome_tabs_reload", "Reload a tab.", vec![
            param("tab_id", "number | null", false, "Tab ID (null for active tab)"),
            param("reload_properties", "object | null", false, "bypassCache"),
        ], "boolean", "Whether reload succeeded"),
        ("sendMessage", "chrome_tabs_sendMessage", "Send a message to a specific tab.", vec![
            param("tab_id", "number", true, "Target tab ID"),
            param("message", "any", true, "Message payload"),
            param("options", "object | null", false, "Options: frameId"),
        ], "any", "Response from the tab"),
    ];
    for (name, action, desc, params, rtype, rdesc) in chrome_tabs {
        register(JsApiDoc {
            namespace: "chrome.tabs".into(),
            name: name.into(),
            action: Some(action.into()),
            description: desc.into(),
            params,
            returns: ret(rtype, rdesc),
            source: "rust_core".into(),
        });
    }

    // ── chrome.alarms ──
    register(JsApiDoc {
        namespace: "chrome.alarms".into(),
        name: "create".into(),
        action: Some("chrome_alarms_create".into()),
        description: "Create an alarm.".into(),
        params: vec![
            param("name", "string | null", false, "Alarm name"),
            param("alarm_info", "object", true, "When: delayInMinutes, periodInMinutes"),
        ],
        returns: ret("boolean", "Whether creation succeeded"),
        source: "rust_core".into(),
    });
    register(JsApiDoc {
        namespace: "chrome.alarms".into(),
        name: "clear".into(),
        action: Some("chrome_alarms_clear".into()),
        description: "Clear an alarm.".into(),
        params: vec![
            param("name", "string | null", false, "Alarm name (null clears all)"),
        ],
        returns: ret("boolean", "Whether any alarm was cleared"),
        source: "rust_core".into(),
    });

    // ── chrome.storage ──
    register(JsApiDoc {
        namespace: "chrome.storage.local".into(),
        name: "get".into(),
        action: Some("chrome_storage_local_get".into()),
        description: "Get items from storage.".into(),
        params: vec![
            param("keys", "string | object | null", false, "Keys to retrieve"),
        ],
        returns: ret("object", "Retrieved items"),
        source: "rust_core".into(),
    });
    register(JsApiDoc {
        namespace: "chrome.storage.local".into(),
        name: "set".into(),
        action: Some("chrome_storage_local_set".into()),
        description: "Set items in storage.".into(),
        params: vec![
            param("items", "object", true, "Items to store"),
        ],
        returns: ret("boolean", "Whether set succeeded"),
        source: "rust_core".into(),
    });
    register(JsApiDoc {
        namespace: "chrome.storage.local".into(),
        name: "remove".into(),
        action: Some("chrome_storage_local_remove".into()),
        description: "Remove items from storage.".into(),
        params: vec![
            param("keys", "string | object", true, "Keys to remove"),
        ],
        returns: ret("boolean", "Whether removal succeeded"),
        source: "rust_core".into(),
    });
    register(JsApiDoc {
        namespace: "chrome.storage.local".into(),
        name: "clear".into(),
        action: Some("chrome_storage_local_clear".into()),
        description: "Clear all storage.".into(),
        params: vec![],
        returns: ret("boolean", "Whether clear succeeded"),
        source: "rust_core".into(),
    });
    register(JsApiDoc {
        namespace: "chrome.storage".into(),
        name: "sync".into(),
        action: None,
        description: "Alias for local.".into(),
        params: vec![],
        returns: ret("object", "Storage object with get, set, remove, clear"),
        source: "js_prelude".into(),
    });

    // ── chrome.action ──
    let chrome_action = [
        ("setBadgeText", "chrome_action_setBadgeText", "Set the badge text on the extension action icon.", vec![
            param("details", "object", true, "text, tabId"),
        ], "boolean", "Whether set succeeded"),
        ("setBadgeBackgroundColor", "chrome_action_setBadgeBackgroundColor", "Set the badge background color.", vec![
            param("details", "object", true, "color, tabId"),
        ], "boolean", "Whether set succeeded"),
        ("setTitle", "chrome_action_setTitle", "Set the title of the extension action.", vec![
            param("details", "object", true, "title, tabId"),
        ], "boolean", "Whether set succeeded"),
        ("setIcon", "chrome_action_setIcon", "Set the icon of the extension action.", vec![
            param("details", "object", true, "imageData, path, tabId"),
        ], "boolean", "Whether set succeeded"),
    ];
    for (name, action, desc, params, rtype, rdesc) in chrome_action {
        register(JsApiDoc {
            namespace: "chrome.action".into(),
            name: name.into(),
            action: Some(action.into()),
            description: desc.into(),
            params,
            returns: ret(rtype, rdesc),
            source: "rust_core".into(),
        });
    }

    // ── chrome.contextMenus ──
    register(JsApiDoc {
        namespace: "chrome.contextMenus".into(),
        name: "create".into(),
        action: Some("chrome_contextMenus_create".into()),
        description: "Create a context menu item.".into(),
        params: vec![
            param("create_properties", "object", true, "id, title, contexts, onclick"),
        ],
        returns: ret("string | number", "Created item ID"),
        source: "rust_core".into(),
    });
    register(JsApiDoc {
        namespace: "chrome.contextMenus".into(),
        name: "remove".into(),
        action: Some("chrome_contextMenus_remove".into()),
        description: "Remove a context menu item.".into(),
        params: vec![
            param("menuItemId", "string | number", true, "Item ID to remove"),
        ],
        returns: ret("boolean", "Whether removal succeeded"),
        source: "rust_core".into(),
    });

    // ── chrome.windows ──
    let chrome_windows = [
        ("getAll", "chrome_windows_getAll", "Get all browser windows.", vec![
            param("get_info", "object | null", false, "populate, windowTypes"),
        ], "object", "Array of window objects"),
        ("create", "chrome_windows_create", "Create a new browser window.", vec![
            param("create_data", "object | null", false, "url, type, focused, etc."),
        ], "object", "Created window object"),
        ("update", "chrome_windows_update", "Update a browser window.", vec![
            param("window_id", "number", true, "Window ID"),
            param("update_info", "object", true, "focused, state, etc."),
        ], "object", "Updated window object"),
        ("remove", "chrome_windows_remove", "Close a browser window.", vec![
            param("window_id", "number", true, "Window ID to close"),
        ], "boolean", "Whether close succeeded"),
    ];
    for (name, action, desc, params, rtype, rdesc) in chrome_windows {
        register(JsApiDoc {
            namespace: "chrome.windows".into(),
            name: name.into(),
            action: Some(action.into()),
            description: desc.into(),
            params,
            returns: ret(rtype, rdesc),
            source: "rust_core".into(),
        });
    }

    // ── chrome.sidePanel ──
    register(JsApiDoc {
        namespace: "chrome.sidePanel".into(),
        name: "setOptions".into(),
        action: Some("chrome_sidePanel_setOptions".into()),
        description: "Configure the side panel behavior.".into(),
        params: vec![
            param("options", "object", true, "enabled, path"),
        ],
        returns: ret("boolean", "Whether options were set"),
        source: "rust_core".into(),
    });

    // ── chrome.cookies ──
    let chrome_cookies = [
        ("get", "chrome_cookies_get", "Get a cookie by details.", vec![
            param("details", "object", true, "name, url, storeId"),
        ], "object | null", "Cookie object or null"),
        ("set", "chrome_cookies_set", "Set a cookie.", vec![
            param("details", "object", true, "name, value, url, etc."),
        ], "object", "Set cookie object"),
        ("remove", "chrome_cookies_remove", "Remove a cookie.", vec![
            param("details", "object", true, "name, url"),
        ], "boolean", "Whether removal succeeded"),
        ("getAll", "chrome_cookies_getAll", "Get all cookies matching a filter.", vec![
            param("details", "object", false, "url, name, domain, etc."),
        ], "object", "Array of cookie objects"),
    ];
    for (name, action, desc, params, rtype, rdesc) in chrome_cookies {
        register(JsApiDoc {
            namespace: "chrome.cookies".into(),
            name: name.into(),
            action: Some(action.into()),
            description: desc.into(),
            params,
            returns: ret(rtype, rdesc),
            source: "rust_core".into(),
        });
    }

    // ── chrome.bookmarks ──
    let chrome_bookmarks = [
        ("search", "chrome_bookmarks_search", "Search bookmarks.", vec![
            param("query", "string | object", true, "Search string or query object"),
        ], "object", "Array of bookmark nodes"),
        ("create", "chrome_bookmarks_create", "Create a bookmark.", vec![
            param("bookmark", "object", true, "parentId, title, url, index"),
        ], "object", "Created bookmark node"),
        ("remove", "chrome_bookmarks_remove", "Remove a bookmark.", vec![
            param("id", "string", true, "Bookmark node ID"),
        ], "boolean", "Whether removal succeeded"),
    ];
    for (name, action, desc, params, rtype, rdesc) in chrome_bookmarks {
        register(JsApiDoc {
            namespace: "chrome.bookmarks".into(),
            name: name.into(),
            action: Some(action.into()),
            description: desc.into(),
            params,
            returns: ret(rtype, rdesc),
            source: "rust_core".into(),
        });
    }

    // ── chrome.history ──
    let chrome_history = [
        ("search", "chrome_history_search", "Search browser history.", vec![
            param("query", "object", true, "text, startTime, endTime, maxResults"),
        ], "object", "Array of history items"),
        ("deleteUrl", "chrome_history_deleteUrl", "Delete a URL from history.", vec![
            param("url", "string", true, "URL to remove"),
        ], "boolean", "Whether removal succeeded"),
    ];
    for (name, action, desc, params, rtype, rdesc) in chrome_history {
        register(JsApiDoc {
            namespace: "chrome.history".into(),
            name: name.into(),
            action: Some(action.into()),
            description: desc.into(),
            params,
            returns: ret(rtype, rdesc),
            source: "rust_core".into(),
        });
    }

    // ── chrome.notifications ──
    let chrome_notifications = [
        ("create", "chrome_notifications_create", "Create a notification.", vec![
            param("id", "string | null", false, "Notification ID"),
            param("options", "object", true, "type, title, message, iconUrl"),
        ], "string", "Notification ID"),
        ("clear", "chrome_notifications_clear", "Clear a notification.", vec![
            param("id", "string", true, "Notification ID to clear"),
        ], "boolean", "Whether notification was cleared"),
    ];
    for (name, action, desc, params, rtype, rdesc) in chrome_notifications {
        register(JsApiDoc {
            namespace: "chrome.notifications".into(),
            name: name.into(),
            action: Some(action.into()),
            description: desc.into(),
            params,
            returns: ret(rtype, rdesc),
            source: "rust_core".into(),
        });
    }

    // ── chrome.scripting ──
    register(JsApiDoc {
        namespace: "chrome.scripting".into(),
        name: "executeScript".into(),
        action: Some("chrome_scripting_executeScript".into()),
        description: "Inject JavaScript into a page.".into(),
        params: vec![
            param("target", "object", true, "tabId, frameIds, allFrames"),
            param("func", "string | object | null", false, "Function or script to inject"),
        ],
        returns: ret("object", "Array of injection results"),
        source: "rust_core".into(),
    });

    // ── dom ──
    register(JsApiDoc {
        namespace: "dom".into(),
        name: "snapshot".into(),
        action: Some("dom_snapshot".into()),
        description: "Take a semantic DOM snapshot of the current page.".into(),
        params: vec![
            param("opts", "object | null", false, "Options: max_depth, include_hidden, etc."),
        ],
        returns: ret("object", "Semantic DOM tree snapshot"),
        source: "rust_core".into(),
    });
    register(JsApiDoc {
        namespace: "dom".into(),
        name: "format".into(),
        action: Some("dom_format".into()),
        description: "Format a DOM snapshot into a text representation.".into(),
        params: vec![
            param("snapshot", "object", true, "DOM snapshot object"),
            param("format", "string | null", false, "Output format: compact-text, markdown, etc."),
        ],
        returns: ret("string", "Formatted text representation"),
        source: "rust_core".into(),
    });

    // ── page ──
    let page_apis = [
        ("snapshot", "page_snapshot_text", "Take a DOM snapshot and return readable text.", vec![
            param("opts", "object | null", false, "Options: max_nodes, interactive_only, etc."),
        ], "string", "Readable accessibility tree with refIds"),
        ("snapshot_data", "page_snapshot_data", "Take a DOM snapshot and return structured data.", vec![
            param("opts", "object | null", false, "Options: max_nodes, interactive_only, etc."),
        ], "object", "Structured snapshot with nodes, url, title, viewport"),
        ("snapshot_text", "page_snapshot_text", "Alias for page.snapshot — returns readable text.", vec![
            param("opts", "object | null", false, "Options: max_nodes, interactive_only, etc."),
        ], "string", "Readable accessibility tree with refIds"),
        ("click", "page_click", "Click an element by refId or CSS selector in the current page.", vec![
            param("ref_id", "string", true, "Element refId from snapshot or CSS selector"),
        ], "null", "None"),
        ("dblclick", "page_dblclick", "Double-click an element by refId.", vec![
            param("ref_id", "string", true, "Element refId from snapshot"),
        ], "null", "None"),
        ("fill", "page_fill", "Fill an input element by refId with a value.", vec![
            param("ref_id", "string", true, "Element refId from snapshot"),
            param("value", "string", true, "Text to fill"),
        ], "null", "None"),
        ("type", "page_type", "Append text to an input element by refId.", vec![
            param("ref_id", "string", true, "Element refId from snapshot"),
            param("text", "string", true, "Text to append"),
        ], "null", "None"),
        ("press", "page_press", "Press a keyboard key.", vec![
            param("key", "string", true, "Key name: Enter, Escape, ArrowDown, etc."),
        ], "null", "None"),
        ("select", "page_select", "Select an option in a dropdown by refId and value.", vec![
            param("ref_id", "string", true, "Element refId from snapshot"),
            param("value", "string", true, "Option value to select"),
        ], "null", "None"),
        ("check", "page_check", "Check or uncheck a checkbox by refId.", vec![
            param("ref_id", "string", true, "Element refId from snapshot"),
            param("checked", "boolean", false, "Checked state (default true)"),
        ], "null", "None"),
        ("hover", "page_hover", "Hover over an element by refId.", vec![
            param("ref_id", "string", true, "Element refId from snapshot"),
        ], "null", "None"),
        ("unhover", "page_unhover", "Move mouse away from any hovered element.", vec![], "null", "None"),
        ("scroll", "page_scroll", "Scroll the page by direction and amount.", vec![
            param("direction", "string", false, "up, down, left, right (default down)"),
            param("amount", "number", false, "Pixels to scroll (default 300)"),
        ], "null", "None"),
        ("scroll_to", "page_scroll_to", "Scroll to an element by refId.", vec![
            param("ref_id", "string", true, "Element refId from snapshot"),
        ], "null", "None"),
        ("url", "page_url", "Get the current page URL.", vec![], "string", "Current URL"),
        ("title", "page_title", "Get the current page title.", vec![], "string", "Current page title"),
        ("screenshot", "page_screenshot", "Take a screenshot of the current page.", vec![], "string", "Base64-encoded screenshot image"),
        ("goto", "page_goto", "Navigate to a URL.", vec![
            param("url", "string", true, "URL to navigate to"),
        ], "null", "None"),
        ("back", "page_back", "Navigate back in history.", vec![], "null", "None"),
        ("forward", "page_forward", "Navigate forward in history.", vec![], "null", "None"),
        ("reload", "page_reload", "Reload the current page.", vec![], "null", "None"),
        ("wait", "page_wait", "Wait for a duration.", vec![
            param("ms", "number", false, "Milliseconds to wait (default 1000)"),
        ], "null", "None"),
        ("tabs", "page_tabs", "Get all tabs in the current window (extension mode).", vec![], "object", "Array of tab objects"),
        ("switch", "page_switch", "Switch to a tab by ID.", vec![
            param("tab_id", "number", true, "Tab ID to switch to"),
        ], "null", "None"),
        ("new_tab", "page_new_tab", "Open a new tab (optionally with a URL).", vec![
            param("url", "string | null", false, "URL to open in the new tab"),
        ], "object", "Created tab object"),
        ("close", "page_close", "Close a tab by ID.", vec![
            param("tab_id", "number", true, "Tab ID to close"),
        ], "boolean", "Whether close succeeded"),
        ("active_tab", "page_active_tab", "Get the currently active tab ID.", vec![], "number | null", "Active tab ID or null"),
        ("find", "page_find", "Find elements matching a CSS selector.", vec![
            param("selector", "string", true, "CSS selector"),
        ], "object", "Array of element objects { tag, refId, text }"),
        ("wait_for", "page_wait_for", "Wait for an element matching a CSS selector to appear.", vec![
            param("selector", "string", true, "CSS selector"),
            param("timeout", "number", false, "Timeout in milliseconds (default 30000)"),
        ], "boolean", "True if element found, false if timeout"),
        ("extract", "page_extract", "Extract structured data from the page.", vec![
            param("fields", "object", true, "Array of field names: title, url, headings, links, etc."),
        ], "object", "Extracted data object"),
        ("append", "page_append", "Append text to an input element by refId.", vec![
            param("ref_id", "string", true, "Element refId from snapshot"),
            param("text", "string", true, "Text to append"),
        ], "null", "None"),
    ];
    for (name, action, desc, params, rtype, rdesc) in page_apis {
        register(JsApiDoc {
            namespace: "page".into(),
            name: name.into(),
            action: Some(action.into()),
            description: desc.into(),
            params,
            returns: ret(rtype, rdesc),
            source: "rust_core".into(),
        });
    }

    // ── page aliases ──
    register(JsApiDoc {
        namespace: "page".into(),
        name: "go".into(),
        action: None,
        description: "Navigate to a URL (alias for page.goto).".into(),
        params: vec![
            param("url", "string", true, "URL to navigate to"),
        ],
        returns: ret("null", "None"),
        source: "js_prelude".into(),
    });
    register(JsApiDoc {
        namespace: "page".into(),
        name: "open".into(),
        action: None,
        description: "Open a new tab (alias for page.new_tab).".into(),
        params: vec![
            param("url", "string | null", false, "URL to open in the new tab"),
        ],
        returns: ret("object", "Created tab object"),
        source: "js_prelude".into(),
    });
    register(JsApiDoc {
        namespace: "page".into(),
        name: "fetch".into(),
        action: None,
        description: "Fetch a URL using the active tab origin (wrapper for tab.fetch).".into(),
        params: vec![
            param("url", "string", true, "URL to fetch"),
            param("opts", "object | null", false, "Options: method, body, headers, timeout"),
        ],
        returns: ret("object", "{ status, ok, body, headers }"),
        source: "js_prelude".into(),
    });

    // ── path ──
    let path_apis = [
        ("join", "Join path segments into an absolute VFS path.", vec![
            param("parts", "string", true, "Path segments to join"),
        ], "string", "Joined absolute path"),
        ("basename", "Get the last component of a path.", vec![
            param("path", "string", true, "Absolute VFS path"),
        ], "string", "File or directory name"),
        ("dirname", "Get the directory portion of a path.", vec![
            param("path", "string", true, "Absolute VFS path"),
        ], "string", "Parent directory path"),
        ("extname", "Get the file extension including the leading dot.", vec![
            param("path", "string", true, "Absolute VFS path"),
        ], "string", "Extension or empty string"),
        ("normalize", "Resolve . and .. segments in a path.", vec![
            param("path", "string", true, "Absolute VFS path"),
        ], "string", "Normalized absolute path"),
        ("isAbsolute", "Check whether a path is absolute (starts with /).", vec![
            param("path", "string", true, "Path to check"),
        ], "boolean", "true if absolute"),
        ("resolve", "Resolve path segments.", vec![
            param("parts", "string", true, "Path segments to resolve"),
        ], "string", "Resolved absolute path"),
        ("relative", "Compute relative path.", vec![
            param("from", "string", true, "From path"),
            param("to", "string", true, "To path"),
        ], "string", "Relative path"),
    ];
    for (name, desc, params, rtype, rdesc) in path_apis {
        register(JsApiDoc {
            namespace: "path".into(),
            name: name.into(),
            action: None,
            description: desc.into(),
            params,
            returns: ret(rtype, rdesc),
            source: "js_prelude".into(),
        });
    }

    // ── runtime ──
    register(JsApiDoc {
        namespace: "runtime".into(),
        name: "inspect".into(),
        action: Some("runtime_inspect".into()),
        description: "Inspect all global variables in the JS state.".into(),
        params: vec![],
        returns: ret("object", "Array of global variable descriptors: name, type, keys, value"),
        source: "rust_core".into(),
    });
    register(JsApiDoc {
        namespace: "runtime".into(),
        name: "fetch".into(),
        action: Some("fetch".into()),
        description: "Alias for web.fetch.".into(),
        params: vec![
            param("url", "string", true, "URL"),
            param("opts", "object | null", false, "Options"),
        ],
        returns: ret("object", "{ status, ok, body, headers }"),
        source: "js_prelude".into(),
    });
    register(JsApiDoc {
        namespace: "runtime".into(),
        name: "sleep".into(),
        action: Some("sleep".into()),
        description: "Alias for web.sleep.".into(),
        params: vec![
            param("ms", "number", false, "Milliseconds"),
        ],
        returns: ret("null", "None"),
        source: "js_prelude".into(),
    });
    register(JsApiDoc {
        namespace: "runtime".into(),
        name: "storage".into(),
        action: None,
        description: "Alias for web.storage.".into(),
        params: vec![],
        returns: ret("object", "Storage API object"),
        source: "js_prelude".into(),
    });
    register(JsApiDoc {
        namespace: "runtime".into(),
        name: "clipboard".into(),
        action: None,
        description: "Alias for web.clipboard.".into(),
        params: vec![],
        returns: ret("object", "Clipboard API object"),
        source: "js_prelude".into(),
    });
    register(JsApiDoc {
        namespace: "runtime".into(),
        name: "notifications".into(),
        action: None,
        description: "Alias for web.notifications.".into(),
        params: vec![],
        returns: ret("object", "Notifications API object"),
        source: "js_prelude".into(),
    });

    // ── sidepanel ──
    let sidepanel_apis = [
        ("snapshot", "sidepanel_snapshot_text", "Take a DOM snapshot of the sidepanel and return readable text.", vec![
            param("opts", "object | null", false, "Options: max_nodes, interactive_only, etc."),
        ], "string", "Readable accessibility tree with refIds"),
        ("snapshot_data", "sidepanel_snapshot_data", "Take a DOM snapshot of the sidepanel and return structured data.", vec![
            param("opts", "object | null", false, "Options: max_nodes, interactive_only, etc."),
        ], "object", "Structured snapshot with nodes, url, title, viewport"),
        ("click", "sidepanel_click", "Click an element by refId in the sidepanel.", vec![
            param("ref_id", "string", true, "Element refId from snapshot"),
        ], "null", "None"),
        ("dblclick", "sidepanel_dblclick", "Double-click an element by refId in the sidepanel.", vec![
            param("ref_id", "string", true, "Element refId from snapshot"),
        ], "null", "None"),
        ("fill", "sidepanel_fill", "Fill an input element by refId with a value in the sidepanel.", vec![
            param("ref_id", "string", true, "Element refId from snapshot"),
            param("value", "string", true, "Text to fill"),
        ], "null", "None"),
        ("type", "sidepanel_type", "Append text to an input element by refId in the sidepanel.", vec![
            param("ref_id", "string", true, "Element refId from snapshot"),
            param("text", "string", true, "Text to append"),
        ], "null", "None"),
        ("press", "sidepanel_press", "Press a keyboard key in the sidepanel.", vec![
            param("key", "string", true, "Key name: Enter, Escape, ArrowDown, etc."),
        ], "null", "None"),
        ("select", "sidepanel_select", "Select an option in a dropdown by refId and value in the sidepanel.", vec![
            param("ref_id", "string", true, "Element refId from snapshot"),
            param("value", "string", true, "Option value to select"),
        ], "null", "None"),
        ("check", "sidepanel_check", "Check or uncheck a checkbox by refId in the sidepanel.", vec![
            param("ref_id", "string", true, "Element refId from snapshot"),
            param("checked", "boolean", false, "Checked state (default true)"),
        ], "null", "None"),
        ("hover", "sidepanel_hover", "Hover over an element by refId in the sidepanel.", vec![
            param("ref_id", "string", true, "Element refId from snapshot"),
        ], "null", "None"),
        ("unhover", "sidepanel_unhover", "Move mouse away from any hovered element in the sidepanel.", vec![], "null", "None"),
        ("scroll", "sidepanel_scroll", "Scroll the sidepanel by direction and amount.", vec![
            param("direction", "string", false, "up, down, left, right (default down)"),
            param("amount", "number", false, "Pixels to scroll (default 300)"),
        ], "null", "None"),
        ("scroll_to", "sidepanel_scroll_to", "Scroll to an element by refId in the sidepanel.", vec![
            param("ref_id", "string", true, "Element refId from snapshot"),
        ], "null", "None"),
        ("url", "sidepanel_url", "Get the sidepanel URL.", vec![], "string", "Current sidepanel URL"),
        ("title", "sidepanel_title", "Get the sidepanel document title.", vec![], "string", "Current sidepanel title"),
        ("wait", "sidepanel_wait", "Wait for a duration.", vec![
            param("ms", "number", false, "Milliseconds to wait (default 1000)"),
        ], "null", "None"),
        ("append", "sidepanel_append", "Append text to an input element by refId in the sidepanel.", vec![
            param("ref_id", "string", true, "Element refId from snapshot"),
            param("text", "string", true, "Text to append"),
        ], "null", "None"),
    ];
    for (name, action, desc, params, rtype, rdesc) in sidepanel_apis {
        register(JsApiDoc {
            namespace: "sidepanel".into(),
            name: name.into(),
            action: Some(action.into()),
            description: desc.into(),
            params,
            returns: ret(rtype, rdesc),
            source: "rust_core".into(),
        });
    }

    // ── host ──
    register(JsApiDoc {
        namespace: "host".into(),
        name: "call".into(),
        action: Some("host_call".into()),
        description: "Call a registered host handler by name.".into(),
        params: vec![
            param("action", "string", true, "Handler action name"),
            param("params", "object | null", false, "Parameters to pass to handler"),
        ],
        returns: ret("any", "Handler response"),
        source: "rust_core".into(),
    });

    // ── tab aliases ──
    let tab_aliases = [
        ("current", "Get the active tab ID.", vec![], "number | null", "Tab ID or null"),
        ("url", "Get the URL of a tab (defaults to current tab).", vec![
            param("tab_id", "number | null", false, "Tab ID"),
        ], "string | null", "URL or null"),
        ("title", "Get the title of a tab (defaults to current tab).", vec![
            param("tab_id", "number | null", false, "Tab ID"),
        ], "string | null", "Title or null"),
        ("open", "Create a new tab and return its ID.", vec![
            param("url", "string | null", false, "URL to open"),
        ], "number | null", "New tab ID or null"),
        ("focus", "Activate (focus) a tab (defaults to current tab).", vec![
            param("tab_id", "number | null", false, "Tab ID"),
        ], "number | null", "Focused tab ID or null"),
        ("reload", "Reload a tab (defaults to current tab).", vec![
            param("tab_id", "number | null", false, "Tab ID"),
        ], "number | null", "Reloaded tab ID or null"),
        ("query", "Alias for web.tab.query.", vec![
            param("query_info", "object", false, "Query filter"),
        ], "object", "Array of matching tabs"),
        ("create", "Alias for web.tab.create.", vec![
            param("create_properties", "object", false, "Tab properties"),
        ], "object", "Created tab object"),
        ("activate", "Alias for web.tab.activate.", vec![
            param("tab_id", "number", true, "Tab ID"),
        ], "boolean", "Whether activation succeeded"),
        ("close", "Alias for web.tab.close.", vec![
            param("tab_id", "number", true, "Tab ID"),
        ], "boolean", "Whether close succeeded"),
        ("execute_script", "Alias for web.tab.execute_script.", vec![
            param("tab_id", "number", true, "Tab ID"),
            param("script", "string | object", true, "Script to inject"),
        ], "object", "Injection results"),
        ("click", "Alias for web.tab.click.", vec![
            param("tab_id", "number", true, "Tab ID"),
            param("ref_id", "number", true, "Element refId"),
        ], "boolean", "Whether click succeeded"),
        ("fill", "Alias for web.tab.fill.", vec![
            param("tab_id", "number", true, "Tab ID"),
            param("ref_id", "number", true, "Element refId"),
            param("value", "string", true, "Text to fill"),
        ], "boolean", "Whether fill succeeded"),
        ("snapshot", "Alias for web.tab.snapshot. Returns human-readable text. Defaults to active tab.", vec![
            param("tab_id", "number", false, "Tab ID (defaults to active tab)"),
        ], "string", "Human-readable accessibility tree with refIds"),
        ("snapshot_text", "Alias for web.tab.snapshot_text. Defaults to active tab.", vec![
            param("tab_id", "number", false, "Tab ID (defaults to active tab)"),
        ], "string", "Human-readable accessibility tree with refIds"),
        ("snapshot_data", "Alias for web.tab.snapshot_data. Defaults to active tab.", vec![
            param("tab_id", "number", false, "Tab ID (defaults to active tab)"),
        ], "object", "Structured snapshot with nodes, url, title, viewport"),
        ("scroll_to", "Alias for web.tab.scroll_to.", vec![
            param("tab_id", "number", true, "Tab ID"),
            param("ref_id", "number", true, "Element refId"),
        ], "boolean", "Whether scroll succeeded"),
        ("evaluate", "Alias for web.tab.evaluate.", vec![
            param("tab_id", "number", true, "Tab ID"),
            param("script", "string", true, "JavaScript to evaluate"),
        ], "any", "Evaluation result"),
        ("back", "Alias for web.tab.back.", vec![
            param("tab_id", "number", true, "Tab ID"),
        ], "boolean", "Whether navigation succeeded"),
        ("wait_for_load", "Alias for web.tab.wait_for_load.", vec![
            param("tab_id", "number", true, "Tab ID"),
        ], "boolean", "Whether tab loaded"),
        ("fetch", "Alias for web.tab.fetch.", vec![
            param("tab_id", "number", true, "Tab ID"),
            param("url", "string", true, "URL"),
            param("opts", "object | null", false, "Options"),
        ], "object", "{ status, ok, body, headers }"),
    ];
    for (name, desc, params, rtype, rdesc) in tab_aliases {
        register(JsApiDoc {
            namespace: "tab".into(),
            name: name.into(),
            action: None,
            description: desc.into(),
            params,
            returns: ret(rtype, rdesc),
            source: "js_prelude".into(),
        });
    }
}

fn param(name: &str, js_type: &str, required: bool, description: &str) -> ParamDoc {
    ParamDoc {
        name: name.into(),
        js_type: js_type.into(),
        required,
        description: description.into(),
    }
}

fn ret(js_type: &str, description: &str) -> ReturnDoc {
    ReturnDoc {
        js_type: js_type.into(),
        description: description.into(),
    }
}
