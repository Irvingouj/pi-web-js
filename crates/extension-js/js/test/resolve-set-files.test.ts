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

	it("returns E_INVALID_PARAMS when reader rejects for missing path", async () => {
		const readBase64 = vi
			.fn()
			.mockRejectedValue(new Error("NotFoundError: /missing"));
		const result = await resolveSetFilesParams(
			"page_set_files",
			{ refId: "e2", files: [{ path: "/missing" }] },
			"run-1",
			readBase64,
		);
		expect(readBase64).toHaveBeenCalledWith("/missing");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
			expect(result.error.message).toContain("/missing");
		}
	});

	it("preserves order and names for mixed url + path + handle sources", async () => {
		const handle = storeBlob("run-mix", new Uint8Array([97, 98, 99]), {
			mimeType: "text/plain",
		});
		const readBase64 = vi.fn(async () => "ZGF0YQ==");
		const result = await resolveSetFilesParams(
			"page_set_files",
			{
				refId: "e2",
				files: [
					{ url: "https://example.com/x.jpg", name: "x.jpg" },
					{ path: "/tmp/y.bin", name: "y.bin" },
					{ handle, name: "z.txt" },
				],
			},
			"run-mix",
			readBase64,
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const files = (result.value as { files: unknown[] }).files;
			expect(files.length).toBe(3);
			expect(files[0]).toMatchObject({ kind: "url", name: "x.jpg" });
			expect(files[1]).toMatchObject({
				kind: "bytes",
				name: "y.bin",
				data: "ZGF0YQ==",
			});
			expect(files[2]).toMatchObject({
				kind: "bytes",
				name: "z.txt",
				data: "YWJj",
			});
		}
	});
});
