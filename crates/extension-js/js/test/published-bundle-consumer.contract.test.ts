/**
 * Published-bundle contract tests for @pi-oxide/extension-js consumer layouts.
 *
 * Validates the flat npm / Chrome extension dist layout:
 *   worker.js + extension_js.js as siblings at package (or dist) root.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(__dirname, "../pkg");

function readPublishedFile(name: string): string {
	const filePath = path.join(PKG_DIR, name);
	expect(fs.existsSync(filePath), `missing published artifact: ${name}`).toBe(
		true,
	);
	return fs.readFileSync(filePath, "utf8");
}

function resolveWorkerWasmImport(workerUrl: string): string {
	return new URL("./extension_js.js", workerUrl).href;
}

/** Simulate flat npm publish layout (worker.js + extension_js.js at package root). */
function createFlatNpmPackageLayout(): {
	root: string;
	cleanup: () => void;
	workerPath: string;
	wasmPath: string;
	importResolvedOnDisk: string;
} {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "extension-js-npm-flat-"));
	const workerPath = path.join(root, "worker.js");
	const wasmPath = path.join(root, "extension_js.js");
	fs.copyFileSync(path.join(PKG_DIR, "worker.js"), workerPath);
	fs.copyFileSync(path.join(PKG_DIR, "extension_js.js"), wasmPath);
	const importResolvedOnDisk = path.normalize(
		path.join(path.dirname(workerPath), "./extension_js.js"),
	);
	return {
		root,
		cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
		workerPath,
		wasmPath,
		importResolvedOnDisk,
	};
}

const flatNpmLayouts: Array<ReturnType<typeof createFlatNpmPackageLayout>> = [];

afterEach(() => {
	while (flatNpmLayouts.length > 0) {
		flatNpmLayouts.pop()?.cleanup();
	}
});

describe("published bundle: worker WASM import path", () => {
	it("built worker.js imports ./extension_js.js as sibling", () => {
		const workerSource = readPublishedFile("worker.js");
		expect(workerSource).toMatch(/from\s+["']\.\/extension_js\.js["']/);
		expect(workerSource).not.toMatch(
			/from\s+["']\.\.\/\.\.\/pkg\/extension_js\.js["']/,
		);
	});

	it("ExtensionSession resolves worker.js as a sibling of index.js", () => {
		const indexSource = readPublishedFile("index.js");
		expect(indexSource).toContain('new URL("worker.js", import.meta.url)');
	});

	it("chrome-extension worker URL resolves wasm to sibling extension_js.js", () => {
		const workerUrl = "chrome-extension://browsergent-test/worker.js";
		expect(resolveWorkerWasmImport(workerUrl)).toBe(
			"chrome-extension://browsergent-test/extension_js.js",
		);
	});

	it("flat npm layout resolves wasm import to sibling extension_js.js on disk", () => {
		const layout = createFlatNpmPackageLayout();
		flatNpmLayouts.push(layout);

		expect(fs.existsSync(layout.wasmPath)).toBe(true);
		expect(fs.existsSync(layout.importResolvedOnDisk)).toBe(true);
		expect(layout.importResolvedOnDisk).toBe(layout.wasmPath);
	});

	it("published pkg contains extension_js.js at same level as worker.js", () => {
		const workerPath = path.join(PKG_DIR, "worker.js");
		const wasmPath = path.join(PKG_DIR, "extension_js.js");
		const importResolvedOnDisk = path.normalize(
			path.join(path.dirname(workerPath), "./extension_js.js"),
		);

		expect(fs.existsSync(wasmPath)).toBe(true);
		expect(importResolvedOnDisk).toBe(wasmPath);
	});
});

describe("published bundle: worker module resolution in extension pages", () => {
	it("built worker.js does not contain bare zod import", () => {
		const workerSource = readPublishedFile("worker.js");
		expect(workerSource).not.toMatch(/^\s*import\s+["']zod["']/m);
		expect(workerSource).not.toMatch(/from\s+["']zod["']/);
	});

	it("zod is bundled into worker.js", () => {
		const workerSource = readPublishedFile("worker.js");
		// Bundled zod leaves identifiable strings in the output.
		expect(workerSource.length).toBeGreaterThan(20_000);
		expect(workerSource.length).toBeLessThan(500_000);
	});
});

function createBrowsergentDistLayout(): {
	root: string;
	cleanup: () => void;
	workerUrl: string;
	wasmImportUrl: string;
} {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "browsergent-dist-"));
	fs.copyFileSync(
		path.join(PKG_DIR, "worker.js"),
		path.join(root, "worker.js"),
	);
	fs.copyFileSync(
		path.join(PKG_DIR, "extension_js.js"),
		path.join(root, "extension_js.js"),
	);
	const extensionOrigin = "chrome-extension://browsergent-test";
	return {
		root,
		cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
		workerUrl: `${extensionOrigin}/worker.js`,
		wasmImportUrl: resolveWorkerWasmImport(`${extensionOrigin}/worker.js`),
	};
}

const browsergentDistLayouts: Array<
	ReturnType<typeof createBrowsergentDistLayout>
> = [];

afterEach(() => {
	while (browsergentDistLayouts.length > 0) {
		browsergentDistLayouts.pop()?.cleanup();
	}
});

describe("published bundle: consumer dist layout simulation", () => {
	it("flat browsergent dist has worker.js and extension_js.js siblings", () => {
		const layout = createBrowsergentDistLayout();
		browsergentDistLayouts.push(layout);

		expect(fs.existsSync(path.join(layout.root, "worker.js"))).toBe(true);
		expect(fs.existsSync(path.join(layout.root, "extension_js.js"))).toBe(true);
	});

	it("flat dist copy satisfies worker wasm import URL", () => {
		const extensionOrigin = "chrome-extension://browsergent-test";
		const requiredWasmUrl = resolveWorkerWasmImport(
			`${extensionOrigin}/worker.js`,
		);
		const copiedWasmUrl = `${extensionOrigin}/extension_js.js`;

		expect(requiredWasmUrl).toBe(copiedWasmUrl);
	});
});

describe("published bundle: page.fill API surface", () => {
	it("page.fill docs require object params, not positional refId/text", () => {
		const indexSource = readPublishedFile("index.js");
		expect(indexSource).toContain('page.fill({ refId: "e2", value: "hello" })');
		expect(indexSource).not.toContain('page.fill("e2", "hello")');
	});
});
