import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const wasmPath = path.resolve(__dirname, "_real_wasm.js");

if (!fs.existsSync(wasmPath)) {
	throw new Error(
		`Real WASM symlink not found at ${wasmPath}. ` +
			"Run the pretest step (npm run pretest) to build the WASM bundle.",
	);
}

describe("runtime binary globals (T-017)", () => {
	it("Uint8Array and ArrayBuffer exist in QuickJS runtime", async () => {
		const { ExtensionSession } = await import("./_real_wasm.js");
		const session = new ExtensionSession();

		const result = session.load_library(`
			var u8 = new Uint8Array([1, 2, 3]);
			var ab = new ArrayBuffer(4);
			print("Uint8Array: " + (typeof Uint8Array !== "undefined"));
			print("ArrayBuffer: " + (typeof ArrayBuffer !== "undefined"));
			print("u8.length: " + u8.length);
			print("ab.byteLength: " + ab.byteLength);
		`);

		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(result.stdout).toContain("Uint8Array: true");
			expect(result.stdout).toContain("ArrayBuffer: true");
			expect(result.stdout).toContain("u8.length: 3");
			expect(result.stdout).toContain("ab.byteLength: 4");
		}
	});

	it("atob and btoa exist and work in QuickJS runtime", async () => {
		const { ExtensionSession } = await import("./_real_wasm.js");
		const session = new ExtensionSession();

		const result = session.load_library(`
			var encoded = btoa("hello");
			var decoded = atob(encoded);
			print("btoa: " + (typeof btoa !== "undefined"));
			print("atob: " + (typeof atob !== "undefined"));
			print("encoded: " + encoded);
			print("decoded: " + decoded);
		`);

		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(result.stdout).toContain("btoa: true");
			expect(result.stdout).toContain("atob: true");
			expect(result.stdout).toContain("encoded: aGVsbG8=");
			expect(result.stdout).toContain("decoded: hello");
		}
	});

	it("TextEncoder and TextDecoder exist in QuickJS runtime", async () => {
		const { ExtensionSession } = await import("./_real_wasm.js");
		const session = new ExtensionSession();

		const result = session.load_library(`
			var encoder = new TextEncoder();
			var decoder = new TextDecoder();
			var bytes = encoder.encode("hello");
			var text = decoder.decode(bytes);
			print("TextEncoder: " + (typeof TextEncoder !== "undefined"));
			print("TextDecoder: " + (typeof TextDecoder !== "undefined"));
			print("bytes.length: " + bytes.length);
			print("text: " + text);
		`);

		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(result.stdout).toContain("TextEncoder: true");
			expect(result.stdout).toContain("TextDecoder: true");
			expect(result.stdout).toContain("bytes.length: 5");
			expect(result.stdout).toContain("text: hello");
		}
	});
});
