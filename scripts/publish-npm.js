#!/usr/bin/env node
/**
 * Publish @pi-oxide/extension-js to npm from the built pkg/ directory.
 *
 * Why this exists: v0.12.0 shipped a tarball containing only package.json.
 * The publish manifest (npm-package.json) lives at the crate root, but the
 * built artifacts live in pkg/. Running `npm publish` from the crate root
 * with no files next to it produced an empty package. This script syncs the
 * manifest into pkg/, verifies every declared file exists on disk, then
 * publishes from pkg/ — failing loud if anything is missing.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const crateRoot = path.resolve(__dirname, "../crates/extension-js/js");
const pkgDir = path.join(crateRoot, "pkg");
const manifestSrc = path.join(crateRoot, "npm-package.json");

const manifest = JSON.parse(fs.readFileSync(manifestSrc, "utf-8"));
const required = manifest.files ?? [];
const missing = required.filter((f) => {
	if (f.includes("*")) {
		return !fs.readdirSync(pkgDir).some((entry) => entry.endsWith(f.slice(1)));
	}
	return !fs.existsSync(path.join(pkgDir, f));
});

if (missing.length > 0) {
	console.error(
		`✘ Refusing to publish: missing declared files in pkg/: ${missing.join(", ")}`,
	);
	console.error(
		`  Run \`node scripts/build.js extension\` then \`cd crates/extension-js/js && npm run build\` first.`,
	);
	process.exit(1);
}

const pkgJson = { ...manifest };
delete pkgJson.sideEffects;
const dest = path.join(pkgDir, "package.json");
fs.writeFileSync(dest, `${JSON.stringify(pkgJson, null, "\t")}\n`);
console.log(`✓ Staged publish manifest → ${path.relative(crateRoot, dest)} (v${manifest.version})`);

const dryRun = process.argv.includes("--dry-run");
const cmd = `npm publish${dryRun ? " --dry-run" : ""}`;
console.log(`$ ${cmd} (cwd: ${path.relative(crateRoot, pkgDir)})`);
execSync(cmd, { cwd: pkgDir, stdio: "inherit" });
console.log(`✅ Published @pi-oxide/extension-js@${manifest.version}${dryRun ? " (dry-run)" : ""}`);