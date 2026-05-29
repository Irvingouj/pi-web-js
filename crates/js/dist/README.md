# @pi-oxide/dom-semantic-tree

DOM-derived semantic tree extractor for browser agents. Self-contained WebAssembly module that extracts interactive elements from web pages.

## Installation

```bash
npm install @pi-oxide/dom-semantic-tree
```

## Usage

```typescript
import { init, collectDocument, formatSnapshot } from "@pi-oxide/dom-semantic-tree";

await init();

const snapshot = collectDocument({ max_nodes: 500 });
console.log(formatSnapshot(snapshot, "text"));
```

## API

- `init()` — Initialize the WASM module. Must be called once before other APIs.
- `collectDocument(options)` — Collect all interactive elements from the full document.
- `collectElement(root, options)` — Collect interactive elements from a specific DOM subtree.
- `formatSnapshot(snapshot, format?)` — Format a snapshot as text or JSON.
- `version()` — Returns the package version string.

## License

LicenseRef-PiccoloNotebook-Fair-BYOK-1.0
