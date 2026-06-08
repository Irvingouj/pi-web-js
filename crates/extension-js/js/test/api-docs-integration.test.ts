import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	getSerializableJsManifest,
	freezeJsRegistry,
	manifestEntryToWasm,
} from "../src/shared/tool-registry.js";
import "../src/main/runner/index.js";

const wasmPath = path.resolve(__dirname, "_real_wasm.js");

if (!fs.existsSync(wasmPath)) {
	throw new Error(
		`Real WASM symlink not found at ${wasmPath}. ` +
			"Run the pretest step (npm run pretest) to build the WASM bundle.",
	);
}

describe("apiDocs real WASM pipeline", () => {
	it("generate_markdown renders page.fill with real manifest data", async () => {
		const manifest = getSerializableJsManifest();
		freezeJsRegistry();

		const {
			ExtensionSession,
			registerJsCallBatch,
			freezeManifest,
		} = await import("./_real_wasm.js");

		const batch = manifest.map((entry) => ({
			entry: manifestEntryToWasm(entry),
			callback: () => Promise.resolve({ ok: true, value: null }),
		}));
		registerJsCallBatch(batch);
		freezeManifest();

		const session = new ExtensionSession();
		const markdown = session.apiDocs("markdown");

		expect(typeof markdown).toBe("string");
		expect(markdown).toContain("page.fill");
		expect(markdown).toContain("refId");
		expect(markdown).toContain("value");
		expect(markdown).toContain("Prerequisites");
		expect(markdown).toContain("Ensure the target tab is active and the content script is ready before mutating");
		expect(markdown).toContain("Notes");
		expect(markdown).toContain("Tags");
		expect(markdown).toContain("mutation");
		expect(markdown).toContain("write");
		expect(markdown).toContain("Related APIs");
	});
});
