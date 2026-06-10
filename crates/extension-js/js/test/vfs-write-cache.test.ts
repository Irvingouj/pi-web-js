import { describe, expect, it } from "vitest";
import {
	cacheVfsWriteBase64,
	clearVfsWriteCache,
	takeCachedVfsWriteBase64,
} from "../src/worker/vfs-write-cache.js";

describe("vfs-write-cache", () => {
	it("stores and takes cached base64 by path", () => {
		clearVfsWriteCache();
		cacheVfsWriteBase64("/tmp/a.bin", "YQ==");
		expect(takeCachedVfsWriteBase64("/tmp/a.bin")).toBe("YQ==");
		expect(takeCachedVfsWriteBase64("/tmp/a.bin")).toBeUndefined();
	});

	it("clearVfsWriteCache removes all entries", () => {
		cacheVfsWriteBase64("/tmp/a.bin", "YQ==");
		clearVfsWriteCache();
		expect(takeCachedVfsWriteBase64("/tmp/a.bin")).toBeUndefined();
	});
});
