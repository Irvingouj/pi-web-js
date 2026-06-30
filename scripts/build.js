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
// rquickjs-sys compiles QuickJS C, which needs a libc. wasm32-unknown-unknown
// is OS-less (correct for wasm-bindgen --target web), so it has no libc — we
// provide wasi-libc and define __wasi__ to satisfy its header guard.
// We also enable rquickjs's `bindgen` feature (see Cargo.toml) so FFI bindings
// are generated at build time via libclang — the published rquickjs-sys 0.11.0
// does NOT ship a wasm32-unknown-unknown.rs pre-generated binding file.
//  - macOS dev: Homebrew llvm + wasi-libc (flat include layout).
//  - Linux CI:  wasi-sdk under /opt (per-target include subdir + needs -D__wasi__).
const wasmEnv = {};
const homebrewClang = "/opt/homebrew/opt/llvm/bin/clang";
const homebrewSysroot = "/opt/homebrew/Cellar/wasi-libc/32/share/wasi-sysroot";
const homebrewOk = (() => {
  try {
    fs.accessSync(homebrewClang, fs.constants.X_OK);
    fs.accessSync(homebrewSysroot);
    return true;
  } catch {
    return false;
  }
})();
if (homebrewOk) {
  wasmEnv.CC = homebrewClang;
  wasmEnv.CFLAGS = `--sysroot=${homebrewSysroot}`;
  // bindgen-rs (libclang) needs the same sysroot for header parsing.
  wasmEnv.BINDGEN_EXTRA_CLANG_ARGS = `--sysroot=${homebrewSysroot} -D__wasi__`;
} else {
  const sdkDir = fs.readdirSync("/opt").find((d) => d.startsWith("wasi-sdk-"));
  if (sdkDir) {
    const root = path.join("/opt", sdkDir);
    const sysroot = path.join(root, "share/wasi-sysroot");
    wasmEnv.CC = path.join(root, "bin/clang");
    // wasi-sdk-24 ships stdlib.h only under per-target subdirs; point -I at
    // wasm32-wasi and define __wasi__ so the headers' guard compiles.
    wasmEnv.CFLAGS = `--sysroot=${sysroot} -I${sysroot}/include/wasm32-wasi -D__wasi__`;
    wasmEnv.BINDGEN_EXTRA_CLANG_ARGS = `--sysroot=${sysroot} -I${sysroot}/include/wasm32-wasi -D__wasi__`;
    // bindgen-rs finds libclang via LIBCLANG_PATH.
    wasmEnv.LIBCLANG_PATH = path.join(root, "lib");
  }
}
const env = {
  ...process.env,
  ...wasmEnv,
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
    outDir: "crates/extension-js/js/pkg",
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

async function buildTarget(target, release = false) {
  const profile = release ? "release" : "debug";
  console.log(`\n🔧 Building ${target.name} (${profile})...`);

  const wasmPath = path.join(
    rootDir,
    `target/wasm32-unknown-unknown/${profile}`,
    target.wasm,
  );
  const outDir = path.join(rootDir, target.outDir);

  const cargoCmd = (() => {
    const buildSub = release ? "build --release" : "build";
    try {
      execSync("rustup run stable cargo --version", { stdio: "ignore", env });
      return `rustup run stable cargo ${buildSub} --target wasm32-unknown-unknown -p ${target.crate}`;
    } catch {
      return `cargo ${buildSub} --target wasm32-unknown-unknown -p ${target.crate}`;
    }
  })();
  run(cargoCmd);

  ensureDir(outDir);
  run(
    `wasm-bindgen --target web --out-dir ${target.outDir} ${wasmPath}`,
    rootDir,
  );

  const bundleScript = path.join(rootDir, "scripts/bundle-wasm.js");
  if (fs.existsSync(bundleScript)) {
    run(`node ${bundleScript} ${target.outDir} ${target.cratePrefix}`, rootDir);
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
  const srcTree = path.join(srcDir, "src");
  const hasTsSources = fs.existsSync(srcTree);
  if (hasTsSources) {
    // runner.ts imports generated.js — copy the source so tsc can resolve it.
    const generatedSrc = path.join(rootDir, "web/src/types/generated.ts");
    const generatedTmp = path.join(srcDir, "src/shared/generated.ts");
    let generatedCopied = false;
    if (fs.existsSync(generatedSrc) && !fs.existsSync(generatedTmp)) {
      fs.mkdirSync(path.dirname(generatedTmp), { recursive: true });
      fs.copyFileSync(generatedSrc, generatedTmp);
      generatedCopied = true;
    }
    try {
      execSync("tsc", { cwd: srcDir, stdio: "inherit" });
      console.log("  Compiled TypeScript sources");
      // Strip ESM marker from content-script.js so it works as a classic MV3 script
      function stripEsmMarker(filePath) {
        if (fs.existsSync(filePath)) {
          let cs = fs.readFileSync(filePath, "utf-8");
          cs = cs.replace(/export\s*\{\s*\};?\s*$/, "");
          fs.writeFileSync(filePath, cs);
          console.log(`  Stripped ESM marker from ${path.relative(srcDir, filePath)}`);
        }
      }
      stripEsmMarker(path.join(srcDir, "pkg/content-script.js"));
    } catch (e) {
      console.error("  TypeScript compilation failed:", e.message);
      process.exit(1);
    } finally {
      if (generatedCopied && fs.existsSync(generatedTmp)) {
        fs.unlinkSync(generatedTmp);
      }
    }
  }

  for (const file of ["content-script.js", "manifest.json", "background.js", "icon.svg"]) {
    const pkgCandidate = path.join(srcDir, "pkg", file);
    const distCandidate =
      file === "content-script.js"
        ? path.join(distDir, "content-script/index.js")
        : path.join(distDir, file);
    const src = fs.existsSync(pkgCandidate)
      ? pkgCandidate
      : fs.existsSync(distCandidate)
        ? distCandidate
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
const release = args.includes("--release") || args.includes("release");
(async () => {
  if (buildWeb) await buildTarget(targets[0], release);
  if (buildExt) await buildTarget(targets[1], release);
  if (buildDom) await buildTarget(targets[2], release);
  if (buildExt) copyExtensionAssets();

  console.log("\n🎉 All builds complete!");
})();
