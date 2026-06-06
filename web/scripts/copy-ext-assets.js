#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const publicDir = path.join(rootDir, "web", "public");

const assets = [
  { name: "content-script.js", srcDir: "crates/extension-js/js" },
  { name: "manifest.json", srcDir: "crates/extension-js/js" },
  { name: "background.js", srcDir: "crates/extension-js/js" },
  { name: "dom_semantic_tree.js", srcDir: "crates/dom-semantic-tree/js" },
];

for (const asset of assets) {
  const srcDir = path.join(rootDir, asset.srcDir);
  const distDir = path.join(srcDir, "dist");
  const pkgDir = path.join(srcDir, "pkg");
  const src = fs.existsSync(path.join(pkgDir, asset.name))
    ? path.join(pkgDir, asset.name)
    : fs.existsSync(path.join(distDir, asset.name))
      ? path.join(distDir, asset.name)
      : path.join(srcDir, asset.name);
  const dest = path.join(publicDir, asset.name);
  fs.copyFileSync(src, dest);
  console.log(`Copied ${src.replace(rootDir + "/", "")} → public/${asset.name}`);
}
