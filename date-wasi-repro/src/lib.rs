use rquickjs::{Context, Runtime, Value};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn run_date_probe() -> String {
    let rt = Runtime::new().expect("Failed to create QuickJS runtime");
    rt.set_max_stack_size(0);
    let context = Context::full(&rt).expect("Failed to create QuickJS context");

    let result = context.with(|ctx| {
        let probe_js = r#"
function codes(s) {
    return Array.from(s).map(function(c) { return c.charCodeAt(0); });
}

var d = new Date(0);
var iso = d.toISOString();

var result = {
    time: d.getTime(),
    utcYear: d.getUTCFullYear(),
    utcMonth: d.getUTCMonth(),
    utcDate: d.getUTCDate(),
    utcHours: d.getUTCHours(),
    utcMinutes: d.getUTCMinutes(),
    utcSeconds: d.getUTCSeconds(),
    isoLength: iso.length,
    isoCodes: codes(iso),
    isoJson: JSON.stringify(iso),
    objectJson: JSON.stringify({ last_played: iso })
};

JSON.stringify(result, null, 2);
"#;

        match ctx.eval::<String, _>(probe_js) {
            Ok(s) => s,
            Err(e) => format!("{{\"error\": \"{}\"}}", e),
        }
    });

    result
}

#[wasm_bindgen]
pub fn run_native_comparison() -> String {
    let rt = Runtime::new().expect("Failed to create QuickJS runtime");
    rt.set_max_stack_size(0);
    let context = Context::full(&rt).expect("Failed to create QuickJS context");

    let result = context.with(|ctx| {
        let probe_js = r#"
var d = new Date(0);
var iso = d.toISOString();

// Test if the issue is in string construction or Date math
var parts = [];
parts.push("getTime=" + d.getTime());
parts.push("getUTCFullYear=" + d.getUTCFullYear());
parts.push("getUTCMonth=" + d.getUTCMonth());
parts.push("getUTCDate=" + d.getUTCDate());
parts.push("getUTCHours=" + d.getUTCHours());
parts.push("getUTCMinutes=" + d.getUTCMinutes());
parts.push("getUTCSeconds=" + d.getUTCSeconds());
parts.push("getUTCMilliseconds=" + d.getUTCMilliseconds());
parts.push("toISOString.length=" + iso.length);
parts.push("toISOString.codes=" + Array.from(iso).map(function(c) { return c.charCodeAt(0); }).join(","));
parts.push("toISOString.json=" + JSON.stringify(iso));

// Also test string construction directly
var manual = "1970-01-01T00:00:00.000Z";
parts.push("manual.length=" + manual.length);
parts.push("manual.codes=" + Array.from(manual).map(function(c) { return c.charCodeAt(0); }).join(","));

parts.join("\n");
"#;

        match ctx.eval::<String, _>(probe_js) {
            Ok(s) => s,
            Err(e) => format!("ERROR: {}", e),
        }
    });

    result
}
