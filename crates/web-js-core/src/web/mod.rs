use crate::utils::format_js_value;
use rquickjs::{
    function::Rest,
    Ctx, Value,
};
use std::cell::RefCell;
use std::rc::Rc;

pub(crate) fn register_web_module<'js>(
    ctx: Ctx<'js>,
    _host_state: Rc<RefCell<crate::state::HostState>>,
) -> rquickjs::Result<()> {
    // Register synchronous native helpers
    crate::web_api_sync! {
        ctx: ctx,
        action: "__webJsLog",
        namespace: "web",
        name: "log",
        doc: "Logs values to the console, returning the formatted message.",
        params: [
            args: "any", "optional", "Values to log",
        ],
        returns: "string" => "The formatted log message",
        handler: move |_ctx: Ctx<'js>, args: Rest<Value<'js>>| -> rquickjs::Result<String> {
            let parts: Vec<String> = args.0.iter().map(|a| format_js_value(a)).collect();
            let msg = parts.join("\t");
            Ok(msg)
        },
    };

    crate::web_api_sync! {
        ctx: ctx,
        action: "__webJsUrlParse",
        namespace: "web",
        name: "url_parse",
        doc: "Parses a URL string into its components.",
        params: [
            url: "string", "required", "URL string to parse",
        ],
        returns: "object" => "Parsed URL components (scheme, host, port, path, fragment, query)",
        handler: move |ctx: Ctx<'js>, args: Rest<Value<'js>>| -> rquickjs::Result<Value<'js>> {
            let url_str = args
                .0
                .get(0)
                .and_then(|v| v.as_string())
                .and_then(|s| s.to_string().ok())
                .unwrap_or_default();
            let parsed = match url::Url::parse(&url_str) {
                Ok(u) => u,
                Err(e) => {
                    return Err(rquickjs::Error::new_from_js_message(
                        "url",
                        "Url",
                        format!("invalid URL: {}", e),
                    ))
                }
            };

            let mut query = Vec::new();
            for (key, value) in parsed.query_pairs() {
                query.push(serde_json::json!({
                    "key": key.as_ref(),
                    "value": value.as_ref(),
                }));
            }

            let result = serde_json::json!({
                "scheme": parsed.scheme(),
                "host": parsed.host_str(),
                "port": parsed.port(),
                "path": parsed.path(),
                "fragment": parsed.fragment(),
                "query": query,
                "query_string": parsed.query(),
            });

            let json_str = serde_json::to_string(&result).map_err(|e| {
                rquickjs::Error::new_from_js_message("json", "Value", e.to_string())
            })?;
            ctx.json_parse(json_str)
        },
    };

    crate::web_api_sync! {
        ctx: ctx,
        action: "__webJsUrlEncode",
        namespace: "web",
        name: "url_encode",
        doc: "Encodes an object into a URL query string.",
        params: [
            params: "object", "required", "Object to encode",
        ],
        returns: "string" => "URL-encoded query string",
        handler: move |ctx: Ctx<'js>, args: Rest<Value<'js>>| -> rquickjs::Result<String> {
            let params_val = args
                .0
                .get(0)
                .cloned()
                .unwrap_or_else(|| Value::new_undefined(ctx.clone()));
            let json_str = ctx
                .json_stringify(&params_val)
                .ok()
                .flatten()
                .and_then(|s| s.to_string().ok())
                .unwrap_or_else(|| "{}".to_string());
            let json: serde_json::Value =
                serde_json::from_str(&json_str).unwrap_or(serde_json::Value::Null);

            let mut pairs = Vec::new();
            if let Some(map) = json.as_object() {
                for (key, val) in map.iter() {
                    let v = match val {
                        serde_json::Value::String(s) => s.clone(),
                        serde_json::Value::Number(n) => n.to_string(),
                        serde_json::Value::Bool(b) => b.to_string(),
                        _ => continue,
                    };
                    pairs.push(format!(
                        "{}={}",
                        url::form_urlencoded::byte_serialize(key.as_bytes())
                            .collect::<String>(),
                        url::form_urlencoded::byte_serialize(v.as_bytes()).collect::<String>()
                    ));
                }
            }
            let encoded = pairs.join("&");
            Ok(encoded)
        },
    };

    crate::web_api_sync! {
        ctx: ctx,
        action: "__webJsRuntimeInspect",
        namespace: "runtime",
        name: "inspect",
        doc: "Inspects the current JS runtime globals and returns their types and values.",
        params: [],
        returns: "object" => "Array of global variable entries with name, type, and value/keys",
        handler: move |ctx: Ctx<'js>, _args: Rest<Value<'js>>| -> rquickjs::Result<Value<'js>> {
            let global = ctx.globals();
            let mut entries = Vec::new();

            for key_res in global.own_keys::<String>(rquickjs::object::Filter::new().string()) {
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

                let mut entry = serde_json::json!({
                    "name": name,
                    "type": type_name,
                });

                if type_name == "object" && !value.is_null() {
                    if let Some(obj) = value.as_object() {
                        let obj_keys: Vec<String> =
                            obj.keys::<String>().filter_map(|k| k.ok()).collect();
                        if let Some(obj_map) = entry.as_object_mut() {
                            obj_map.insert(
                                "keys".to_string(),
                                serde_json::Value::Array(
                                    obj_keys
                                        .into_iter()
                                        .map(serde_json::Value::String)
                                        .collect(),
                                ),
                            );
                        }
                    }
                } else if type_name != "function" {
                    let formatted = format_js_value(&value);
                    if let Some(obj_map) = entry.as_object_mut() {
                        obj_map
                            .insert("value".to_string(), serde_json::Value::String(formatted));
                    }
                }

                entries.push(entry);
            }

            let result = serde_json::Value::Array(entries);
            let json_str = serde_json::to_string(&result).map_err(|e| {
                rquickjs::Error::new_from_js_message("json", "Value", e.to_string())
            })?;
            ctx.json_parse(json_str)
        },
    };

    crate::web_api_sync! {
        ctx: ctx,
        action: "__webJsSha256",
        namespace: "crypto",
        name: "sha256",
        doc: "Computes the SHA-256 hash of a message.",
        params: [
            message: "string", "required", "Message to hash",
        ],
        returns: "string" => "Hex-encoded SHA-256 hash",
        handler: move |_ctx: Ctx<'js>, args: Rest<Value<'js>>| -> rquickjs::Result<String> {
            let msg = args
                .0
                .get(0)
                .and_then(|v| v.as_string())
                .and_then(|s| s.to_string().ok())
                .unwrap_or_default();
            use sha2::{Digest, Sha256};
            let mut hasher = Sha256::new();
            hasher.update(msg.as_bytes());
            Ok(hasher
                .finalize()
                .iter()
                .map(|b| format!("{:02x}", b))
                .collect())
        },
    };

    crate::web_api_sync! {
        ctx: ctx,
        action: "__webJsMd5",
        namespace: "crypto",
        name: "md5",
        doc: "Computes the MD5 hash of a message.",
        params: [
            message: "string", "required", "Message to hash",
        ],
        returns: "string" => "Hex-encoded MD5 hash",
        handler: move |_ctx: Ctx<'js>, args: Rest<Value<'js>>| -> rquickjs::Result<String> {
            let msg = args
                .0
                .get(0)
                .and_then(|v| v.as_string())
                .and_then(|s| s.to_string().ok())
                .unwrap_or_default();
            use md5::{Digest, Md5};
            let mut hasher = Md5::new();
            hasher.update(msg.as_bytes());
            Ok(hasher
                .finalize()
                .iter()
                .map(|b| format!("{:02x}", b))
                .collect())
        },
    };

    crate::web_api_sync! {
        ctx: ctx,
        action: "__webJsHmacSha256",
        namespace: "crypto",
        name: "hmac_sha256",
        doc: "Computes the HMAC-SHA256 of a message with a key.",
        params: [
            key: "string", "required", "HMAC key",
            message: "string", "required", "Message to authenticate",
        ],
        returns: "string" => "Hex-encoded HMAC-SHA256",
        handler: move |_ctx: Ctx<'js>, args: Rest<Value<'js>>| -> rquickjs::Result<String> {
            let key = args
                .0
                .get(0)
                .and_then(|v| v.as_string())
                .and_then(|s| s.to_string().ok())
                .unwrap_or_default();
            let msg = args
                .0
                .get(1)
                .and_then(|v| v.as_string())
                .and_then(|s| s.to_string().ok())
                .unwrap_or_default();
            use hmac::{Hmac, Mac};
            use sha2::Sha256;
            type HmacSha256 = Hmac<Sha256>;
            let mut mac = HmacSha256::new_from_slice(key.as_bytes()).map_err(|e| {
                rquickjs::Error::new_from_js_message("hmac", "HmacSha256", e.to_string())
            })?;
            mac.update(msg.as_bytes());
            let result = mac.finalize();
            Ok(result
                .into_bytes()
                .iter()
                .map(|b| format!("{:02x}", b))
                .collect())
        },
    };

    crate::web_api_sync! {
        ctx: ctx,
        action: "__webJsHexEncode",
        namespace: "crypto",
        name: "hex_encode",
        doc: "Encodes a string to hexadecimal.",
        params: [
            message: "string", "required", "String to encode",
        ],
        returns: "string" => "Hex-encoded string",
        handler: move |_ctx: Ctx<'js>, args: Rest<Value<'js>>| -> rquickjs::Result<String> {
            let msg = args
                .0
                .get(0)
                .and_then(|v| v.as_string())
                .and_then(|s| s.to_string().ok())
                .unwrap_or_default();
            Ok(msg
                .as_bytes()
                .iter()
                .map(|b| format!("{:02x}", b))
                .collect())
        },
    };

    crate::web_api_sync! {
        ctx: ctx,
        action: "__webJsHexDecode",
        namespace: "crypto",
        name: "hex_decode",
        doc: "Decodes a hexadecimal string.",
        params: [
            hex: "string", "required", "Hex string to decode",
        ],
        returns: "string" => "Decoded string",
        handler: move |_ctx: Ctx<'js>, args: Rest<Value<'js>>| -> rquickjs::Result<String> {
            let hex = args
                .0
                .get(0)
                .and_then(|v| v.as_string())
                .and_then(|s| s.to_string().ok())
                .unwrap_or_default();
            if hex.len() % 2 != 0 {
                return Err(rquickjs::Error::new_from_js_message(
                    "hex",
                    "decode",
                    "invalid hex string: odd length",
                ));
            }
            let mut bytes = Vec::new();
            for i in (0..hex.len()).step_by(2) {
                match u8::from_str_radix(&hex[i..i + 2], 16) {
                    Ok(b) => bytes.push(b),
                    Err(_) => {
                        return Err(rquickjs::Error::new_from_js_message(
                            "hex",
                            "decode",
                            format!("invalid hex character at position {}", i),
                        ))
                    }
                }
            }
            Ok(String::from_utf8_lossy(&bytes).to_string())
        },
    };

    // Inject async API wrappers
    if let Err(e) = ctx.eval::<i32, _>("1+1") {
        let msg = if let rquickjs::Error::Exception = &e {
            let exc = ctx.catch();
            crate::utils::exception_to_string(&exc)
        } else {
            e.to_string()
        };
        return Err(rquickjs::Error::new_from_js_message(
            "web_module",
            "eval_test",
            msg,
        ));
    }

    let setup_js = include_str!("prelude.js");
    if let Err(e) = ctx.eval::<(), _>(setup_js) {
        let msg = if let rquickjs::Error::Exception = &e {
            let exc = ctx.catch();
            crate::utils::exception_to_string(&exc)
        } else {
            e.to_string()
        };
        return Err(rquickjs::Error::new_from_js_message(
            "web_module",
            "eval",
            msg,
        ));
    }

    Ok(())
}
