import { describe, expect, it } from "vitest";
import {
	clearAllBlobStores,
	clearRun,
	storeBlob,
	takeBlob,
} from "../src/worker/binary-blob-store.js";

describe("binary-blob-store", () => {
	it("stores and takes blobs per run", () => {
		const bytes = new Uint8Array([1, 2, 3]);
		const handle = storeBlob("run-1", bytes, { mimeType: "text/plain" });
		const taken = takeBlob("run-1", handle);
		expect(taken?.bytes).toEqual(bytes);
		expect(taken?.mimeType).toBe("text/plain");
		expect(takeBlob("run-1", handle)).toBeNull();
	});

	it("clears a run store", () => {
		const handle = storeBlob("run-2", new Uint8Array([9]));
		clearRun("run-2");
		expect(takeBlob("run-2", handle)).toBeNull();
	});

	it("clearAllBlobStores removes every run", () => {
		const h1 = storeBlob("a", new Uint8Array([1]));
		const h2 = storeBlob("b", new Uint8Array([2]));
		clearAllBlobStores();
		expect(takeBlob("a", h1)).toBeNull();
		expect(takeBlob("b", h2)).toBeNull();
	});
});
