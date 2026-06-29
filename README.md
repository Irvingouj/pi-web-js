# pi-web-js

A JavaScript notebook + browser-agent runtime that runs **inside a Chrome
extension**. Cells execute in a sandboxed QuickJS WASM runtime and drive the
active tab through a content-script channel — observe, target, fetch, and save
without ever handing raw Chrome APIs or DOM execution to the model.

> **Status: WIP.** The current focus is the **extension-js** crate — the
> sidepanel runner, content-script registry, observation lease, and manifest
> docs. The `web-js` (plain web) target is a demo/playground only and is not
> the product.

## Repository layout

```
crates/
  extension-js/   # ← active focus. MV3 extension runtime (WASM + sidepanel + content script)
    js/           # TypeScript sidepanel, worker, content script, tests
    src/          # Rust WASM core
  web-js/         # Plain-web build (demo only, not the product)
  web-js-core/    # Shared QuickJS runtime + prelude (used by both targets)
  web-js-base/    # Shared base types
  web-fs/         # OPFS-backed virtual filesystem
  dom-semantic-tree/  # DOM → accessible semantic tree
web/              # Sidepanel UI (Preact + Vite), E2E tests, extension packaging
  dist/           # Built unpacked extension — load this in Chrome
  tests/e2e/extension/  # problems-*.spec.ts acceptance suite
scripts/
  build.js                # Unified WASM build (web | extension | dom)
  serve-testcases.mjs     # Local HTTP fixtures for E2E
testcases/        # Static HTML fixtures (dynamic-feed, large-dom, media-download, stale-ref, …)
docs/             # Architecture docs + archived planning
```

## Build & test

All commands run from the repo root unless noted.

```bash
# Build WASM for all targets (web + extension + dom)
node scripts/build.js

# Build only the extension WASM
node scripts/build.js extension

# Full extension build: WASM + sidepanel bundle + copy assets → web/dist/
cd web && npm run build:extension

# Load as unpacked extension: Chrome → chrome://extensions → Developer mode →
# Load unpacked → select web/dist/
```

### Tests

```bash
# Rust unit tests
cargo test -p web-js-core --lib
cargo test -p extension-js --lib

# extension-js TypeScript unit tests (Vitest, jsdom)
cd crates/extension-js/js && npm test

# Extension E2E (Playwright, real unpacked extension + testcase server)
cd web && npm run test:e2e:extension
```

The `problems-*.spec.ts` suite in `web/tests/e2e/extension/` is the
acceptance gate: dynamic-feed observation, large-DOM snapshots, stale-ref
targeting, image download+save, cold-tab consistency, and the docs contract.

## Context rules

See [`AGENTS.md`](./AGENTS.md) for the full contract. Short version:

- **Extension context is the only product.** Active when `chrome.runtime.id` is
  set. `web-js` is a playground.
- First-party `page.*` / `web.tab.*` DOM APIs go through the content-script
  registry channel — never internal `chrome.scripting.executeScript`.
- `chrome.*` and parity aliases transport opaque `NativeArgs` end-to-end; the
  bridge does not reshape arguments.
- All E2E tests mock `chrome.runtime.id` to trigger extension context.

## Changelog

See [`CHANGELOG.md`](./CHANGELOG.md) for shipped work across versions
(observation lease, `snapshot_query`, binary-safe fetch + fs pipeline, strict
manifest typing, cold-tab recovery, and more).

## License

Dual licensed under MIT or Apache-2.0 — see [`LICENSE`](./LICENSE).
