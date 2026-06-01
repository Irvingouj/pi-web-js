# Date.toISOString() WASM/WASI Reproduction

Minimal reproduction of the `Date.toISOString()` bug observed in the web-js runtime.

## Problem

In the web-js notebook runtime (QuickJS compiled to WASM32 with WASI libc):
- `new Date(0).toISOString()` returns `"\0\0\0"` (3 NUL bytes)
- Expected: `"1970-01-01T00:00:00.000Z"` (24 chars)

In standalone QuickJS (native `qjs`):
- `new Date(0).toISOString()` returns the correct ISO string

## Hypothesis

The bug is in the **WASM build/runtime layer**, not upstream QuickJS:
1. WASI libc `gmtime_r` / `strftime` may return incorrect results
2. QuickJS's Date string formatting may interact badly with WASM string bridge
3. The `rust-alloc` + `disable-assertions` feature combo may hide memory issues

## Build

```bash
chmod +x build.sh
./build.sh
```

This builds the Rust crate for `wasm32-unknown-unknown` and generates wasm-bindgen bindings.

## Test

```bash
# Serve the test page
python3 -m http.server 8000

# Open in browser
open http://localhost:8000/test.html
```

## Files

- `src/lib.rs` - Rust code that creates a QuickJS context and runs JS probes
- `test.html` - Browser page that loads the WASM module and displays results
- `build.sh` - Build script using cargo + wasm-bindgen

## Expected Output (if bug reproduced)

```json
{
  "time": 0,
  "utcYear": 1970,
  "utcMonth": 0,
  "utcDate": 1,
  "isoLength": 3,
  "isoCodes": [0, 0, 0],
  "isoJson": "\"\\u0000\\u0000\\u0000\"",
  "objectJson": "{\"last_played\":\"\\u0000\\u0000\\u0000\"}"
}
```

## Expected Output (if no bug)

```json
{
  "time": 0,
  "utcYear": 1970,
  "utcMonth": 0,
  "utcDate": 1,
  "isoLength": 24,
  "isoCodes": [49, 57, 55, 48, 45, 48, 49, 45, 48, 49, 84, 48, 48, 58, 48, 48, 58, 48, 48, 46, 48, 48, 48, 90],
  "isoJson": "\"1970-01-01T00:00:00.000Z\"",
  "objectJson": "{\"last_played\":\"1970-01-01T00:00:00.000Z\"}"
}
```

## Next Steps After Reproduction

1. **If bug reproduces here**: The issue is in the core QuickJS WASM build or WASI libc. Check:
   - `wasm-objdump -x` for time-related symbols
   - WASI libc version (`wasi-libc --version`)
   - rquickjs version and features

2. **If bug does NOT reproduce here**: The issue is in web-js's additional layers:
   - JS prelude or polyfills
   - wasm-bindgen bridge
   - Console/output transport
   - Session initialization code

## References

- [QuickJS](https://bellard.org/quickjs/) - Official QuickJS engine
- [rquickjs](https://docs.rs/rquickjs) - Rust bindings
- [WASI libc](https://github.com/WebAssembly/wasi-libc) - WebAssembly libc implementation
- [web-js](https://github.com/your-repo/web-js) - The project where this bug was originally observed
