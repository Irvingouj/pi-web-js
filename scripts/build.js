#!/usr/bin/env node
/**
 * Unified WASM build CLI
 * Builds web-js and extension-js WASM targets, bundles them with base64
 * embedded WASM, and copies extension assets to web/public/.
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// Dynamically discover Rust toolchain via rustup, with fallback to PATH.
let rustBinDir = "";
try {
  const rustcPath = execSync("rustup which rustc", {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
  }).trim();
  rustBinDir = path.dirname(rustcPath);
} catch {
  // rustup not available — rely on cargo/rustc already in PATH
}
const env = {
  ...process.env,
  PATH: rustBinDir ? `${rustBinDir}:${process.env.PATH}` : process.env.PATH,
  ...(rustBinDir ? { RUSTC: path.join(rustBinDir, "rustc") } : {}),
};

function run(cmd, cwd = rootDir) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd, env, stdio: "inherit" });
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const targets = [
  {
    name: "web-js",
    crate: "web-js",
    wasm: "web_js.wasm",
    outDir: "crates/web-js/pkg",
    cratePrefix: "web_js",
  },
  {
    name: "extension-js",
    crate: "extension-js",
    wasm: "extension_js.wasm",
    outDir: "crates/extension-js/pkg",
    cratePrefix: "extension_js",
  },
  {
    name: "dom-semantic-tree",
    crate: "dom-semantic-tree",
    wasm: "dom_semantic_tree.wasm",
    outDir: "crates/dom-semantic-tree/pkg",
    cratePrefix: "dom_semantic_tree",
  },
];

async function buildTarget(target) {
  console.log(`\n🔧 Building ${target.name}...`);

  const wasmPath = path.join(
    rootDir,
    "target/wasm32-unknown-unknown/debug",
    target.wasm,
  );
  const outDir = path.join(rootDir, target.outDir);

  run(
    `rustup run stable cargo build --target wasm32-unknown-unknown -p ${target.crate}`,
  );

  ensureDir(outDir);
  run(
    `wasm-bindgen --target web --out-dir ${target.outDir} ${wasmPath}`,
    rootDir,
  );

  const bundleScript = path.join(rootDir, "scripts/bundle-wasm.js");
  if (fs.existsSync(bundleScript)) {
    run(`node ${bundleScript} ${target.outDir} ${target.cratePrefix}`, rootDir);
  }

  // Generate API docs by loading the self-contained WASM module in Node.js
  const jsFile = target.name === "web-js"
    ? "web_js.js"
    : target.name === "extension-js"
      ? "extension_js.js"
      : null;
  if (jsFile) {
    const jsPath = path.join(outDir, jsFile);
    if (fs.existsSync(jsPath)) {
      try {
        const wasmModule = await import(jsPath);
        if (typeof wasmModule.generateApiDocs === "function") {
          const md = wasmModule.generateApiDocs("markdown");
          const json = wasmModule.generateApiDocs("json");
          const jsDir = path.resolve(target.outDir, "../js");
          if (fs.existsSync(jsDir)) {
            fs.writeFileSync(path.join(jsDir, "API.md"), md);
            fs.writeFileSync(path.join(jsDir, "api.json"), json);
            console.log(`  API.md + api.json generated`);
          }
        }
      } catch (e) {
        console.warn(`  Doc generation skipped: ${e.message}`);
      }
    }
  }

  console.log(`✅ ${target.name} built`);
}

function copyExtensionAssets() {
  console.log("\n📦 Copying extension assets to web/public/...");
  const srcDir = path.join(rootDir, "crates/extension-js/js");
  const distDir = path.join(srcDir, "dist");
  const destDir = path.join(rootDir, "web/public");
  ensureDir(destDir);

  // Compile TypeScript sources if any .ts files need it.
  // runner.ts etc. are built by the web app pipeline; we only need tsc for
  // content-script.ts and other files referenced directly by the extension.
  const hasTsSources = fs.readdirSync(srcDir).some((f) => f.endsWith(".ts"));
  if (hasTsSources) {
    // runner.ts imports ./generated.js — copy the source so tsc can resolve it.
    const generatedSrc = path.join(rootDir, "web/src/types/generated.ts");
    const generatedTmp = path.join(srcDir, "generated.ts");
    let generatedCopied = false;
    if (fs.existsSync(generatedSrc) && !fs.existsSync(generatedTmp)) {
      fs.copyFileSync(generatedSrc, generatedTmp);
      generatedCopied = true;
    }
    try {
      execSync("tsc", { cwd: srcDir, stdio: "pipe" });
      console.log("  Compiled TypeScript sources");
      // Strip ESM marker from content-script.js so it works as a classic MV3 script
      // tsc may emit into dist/ (when outDir is set), so strip both locations
      function stripEsmMarker(filePath) {
        if (fs.existsSync(filePath)) {
          let cs = fs.readFileSync(filePath, "utf-8");
          cs = cs.replace(/export\s*\{\s*\};?\s*$/, "");
          fs.writeFileSync(filePath, cs);
          console.log(`  Stripped ESM marker from ${path.basename(filePath)}`);
        }
      }
      stripEsmMarker(path.join(srcDir, "content-script.js"));
      stripEsmMarker(path.join(distDir, "content-script.js"));
    } catch (e) {
      console.error("  TypeScript compilation failed:", e.message);
      process.exit(1);
    } finally {
      if (generatedCopied && fs.existsSync(generatedTmp)) {
        fs.unlinkSync(generatedTmp);
      }
    }
  }

  for (const file of ["content-script.js", "manifest.json", "background.js"]) {
    const src = fs.existsSync(path.join(distDir, file))
      ? path.join(distDir, file)
      : path.join(srcDir, file);
    const dest = path.join(destDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log(`  ${file} → web/public/`);
    }
  }

  const domTreeSrc = path.join(rootDir, "crates/dom-semantic-tree/js/dom_semantic_tree.js");
  const domTreeDest = path.join(destDir, "dom_semantic_tree.js");
  if (fs.existsSync(domTreeSrc)) {
    fs.copyFileSync(domTreeSrc, domTreeDest);
    console.log(`  dom_semantic_tree.js → web/public/`);
  }
}

const args = process.argv.slice(2);
const buildAll = args.length === 0;
const buildWeb = buildAll || args.includes("web");
const buildExt = buildAll || args.includes("extension");
const buildDom = buildAll || args.includes("dom");

(async () => {
  if (buildWeb) await buildTarget(targets[0]);
  if (buildExt) await buildTarget(targets[1]);
  if (buildDom) await buildTarget(targets[2]);
  if (buildExt) copyExtensionAssets();

  console.log("\n🎉 All builds complete!");
})();
