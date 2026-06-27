#!/usr/bin/env node
// Tiny static server for the QuickJS bench. Serves crates/web-js/js/ so that
// <bench/bench.html> can import <web_js.js> (wasm is base64-inlined in it).
//
// Sets COOP/COEP so the page is cross-origin isolated — this enables
// performance.measureUserAgentSpecificMemory() for a browser-accounted memory
// total (the primary metric, wasm linear-memory byteLength, works regardless).
//
//   node crates/web-js/js/bench/serve.mjs
//   PORT=9000 node crates/web-js/js/bench/serve.mjs

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, ".."); // crates/web-js/js
const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? "9393");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
    let p = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === "/" || p.endsWith("/")) p = path.join(p, "bench", "bench.html");
    const norm = path.normalize(p);
    if (!norm.startsWith(ROOT) || !existsSync(norm) || !statSync(norm).isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    const body = await readFile(norm);
    res.writeHead(200, {
      "content-type": MIME[path.extname(norm).toLowerCase()] ?? "application/octet-stream",
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-embedder-policy": "require-corp",
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(err instanceof Error ? err.message : String(err));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`QuickJS bench served from ${ROOT}`);
  console.log(`→ http://${HOST}:${PORT}/bench/bench.html`);
});
