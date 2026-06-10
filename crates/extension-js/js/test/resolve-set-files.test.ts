import { describe, expect, it, vi } from "vitest";
import { storeBlob } from "../src/worker/binary-blob-store.js";
import { resolveSetFilesParams } from "../src/worker/resolve-set-files.js";

describe("resolveSetFilesParams", () => {
	it("passes url sources through as kind url", async () => {
		const result = await resolveSetFilesParams(
			"page_set_files",
			{
				refId: "e2",
				files: [{ url: "https://example.com/a.jpg", name: "a.jpg" }],
			},
			"run-1",
			vi.fn(),
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const files = (result.value as { files: unknown[] }).files;
			expect(files[0]).toEqual({
				kind: "url",
				url: "https://example.com/a.jpg",
				name: "a.jpg",
				mimeType: undefined,
			});
		}
	});

	it("reads path sources via injected reader", async () => {
		const readBase64 = vi.fn(async () => "YQ==");
		const result = await resolveSetFilesParams(
			"page_set_files",
			{
				refId: "e2",
				files: [{ path: "/tmp/a.txt" }],
			},
			"run-1",
			readBase64,
		);
		expect(readBase64).toHaveBeenCalledWith("/tmp/a.txt");
		expect(result.ok).toBe(true);
		if (result.ok) {
			const files = (result.value as { files: unknown[] }).files;
			expect(files[0]).toMatchObject({
				kind: "bytes",
				name: "a.txt",
				data: "YQ==",
			});
		}
	});

	it("resolves handle sources from blob store", async () => {
		const handle = storeBlob("run-1", new Uint8Array([97]), {
			mimeType: "text/plain",
		});
		const result = await resolveSetFilesParams(
			"page_set_files",
			{
				refId: "e2",
				files: [{ handle, name: "a.txt" }],
			},
			"run-1",
			vi.fn(),
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const files = (result.value as { files: unknown[] }).files;
			expect(files[0]).toMatchObject({
				kind: "bytes",
				name: "a.txt",
				data: "YQ==",
			});
		}
	});

	it("rejects unknown handles", async () => {
		const result = await resolveSetFilesParams(
			"page_set_files",
			{
				refId: "e2",
				files: [{ handle: "blob_missing" }],
			},
			"run-1",
			vi.fn(),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
		}
	});
});
