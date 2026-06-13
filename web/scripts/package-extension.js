#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const outDir = path.join(rootDir, "package");

const manifestPath = path.join(distDir, "manifest.json");
if (!fs.existsSync(manifestPath)) {
	console.error("❌ dist/manifest.json not found. Run `npm run build` first.");
	process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const version = manifest.version || "0.1.0";
const name = manifest.name || "extension";
const safeName = name.toLowerCase().replace(/\s+/g, "-");
const zipName = `${safeName}-${version}.zip`;

if (!fs.existsSync(outDir)) {
	fs.mkdirSync(outDir, { recursive: true });
}

const zipPath = path.join(outDir, zipName);

// Use native zip on macOS/Linux; fallback to a Node implementation would need archiver
// For now, just call the system zip command.
try {
	execSync(`zip -r "${zipPath}" .`, { cwd: distDir, stdio: "inherit" });
	console.log(`\n✅ Extension packaged: ${zipPath}`);
	console.log(
		`   Load as unpacked: chrome://extensions → Developer mode → Load unpacked → ${distDir}`,
	);
} catch (_err) {
	console.error("❌ Failed to create zip. Make sure `zip` is installed.");
	console.error("   You can manually zip the contents of:", distDir);
	process.exit(1);
}
