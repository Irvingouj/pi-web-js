#!/bin/bash
set -e

echo "🔧 Building date-wasi-repro WASM target..."

# Build the Rust crate for wasm32 target
rustup run stable cargo build --target wasm32-unknown-unknown --release

# Generate wasm-bindgen bindings
wasm-bindgen \
  --target web \
  --out-dir pkg \
  target/wasm32-unknown-unknown/release/date_wasi_repro.wasm

# Inject env stubs (same as web-js bundle-wasm.js)
node inject-env-stubs.js pkg date_wasi_repro

echo "✅ Build complete. Files in ./pkg/"
echo ""
echo "To test in browser:"
echo "  python3 -m http.server 8000"
echo "  open http://localhost:8000/test.html"
