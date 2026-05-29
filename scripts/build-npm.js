#!/usr/bin/env node
/**
 * Build JS/TS packages for npm publishing.
 * Compiles .ts sources with tsc, copies WASM bundles and static assets into dist/.
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const packages = {
  dom: {
    dir: "crates/dom-semantic-tree/js",
    wasm: ["dom_semantic_tree.js", "dom_semantic_tree.d.ts"],
    extra: ["README.md"],
  },
  web: {
    dir: "crates/web-js/js",
    wasm: ["web_js.js", "web_js.d.ts"],
    extra: ["README.md"],
  },
  extension: {
    dir: "crates/extension-js/js",
    wasm: ["extension_js.js", "extension_js.d.ts"],
    extra: [
      "content-script.js",
      "background.js",
      "manifest.json",
      "README.md",
    ],
  },
};

const target = process.argv[2];
if (!target || !packages[target]) {
  console.error("Usage: node scripts/build-npm.js [dom|web|extension]");
  process.exit(1);
}

const pkg = packages[target];
const absDir = path.resolve(rootDir, pkg.dir);

// Clean dist/
const distDir = path.join(absDir, "dist");
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true });
}

// Run tsc
execSync("tsc", { cwd: absDir, stdio: "inherit" });

// Strip ESM marker from content-script.js so it works as a classic MV3 script
function stripEsmMarker(filePath) {
  if (fs.existsSync(filePath)) {
    let cs = fs.readFileSync(filePath, "utf-8");
    cs = cs.replace(/export\s*\{\s*\};?\s*$/, "");
    fs.writeFileSync(filePath, cs);
    console.log(`  Stripped ESM marker from ${path.basename(filePath)}`);
  }
}
stripEsmMarker(path.join(absDir, "content-script.js"));
stripEsmMarker(path.join(distDir, "content-script.js"));

// Copy WASM bundles and static assets into dist/
for (const file of [...pkg.wasm, ...pkg.extra]) {
  const dest = path.join(distDir, file);
  if (fs.existsSync(dest)) {
    console.log(`  Already in dist/: ${file}`);
    continue;
  }
  const src = path.join(absDir, file);
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`  Copied ${file} → dist/`);
  } else {
    console.warn(`  Skipped missing file: ${file}`);
  }
}

// Patch worker URL in compiled output: .ts → .js
const indexJs = path.join(distDir, "index.js");
const indexDts = path.join(distDir, "index.d.ts");
if (fs.existsSync(indexJs)) {
  let content = fs.readFileSync(indexJs, "utf-8");
  content = content.replace(/new URL\("\.\/worker\.ts"/g, 'new URL("./worker.js"');
  fs.writeFileSync(indexJs, content);
  console.log("  Patched worker URL in dist/index.js");
}
if (fs.existsSync(indexDts)) {
  let content = fs.readFileSync(indexDts, "utf-8");
  content = content.replace(/new URL\("\.\/worker\.ts"/g, 'new URL("./worker.js"');
  fs.writeFileSync(indexDts, content);
  console.log("  Patched worker URL in dist/index.d.ts");
}

console.log(`✅ ${target} JS built in ${distDir}`);
