// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { handlers } from "../src/content-script/handlers.js";
import {
	dispatchContentScriptCall,
	registerContentScriptSpec,
} from "../src/content-script/registry.js";
import { buildContentScriptSpecs } from "../src/content-script/schemas.js";

// Polyfill CSS.escape for jsdom test environments where it is unavailable
if (typeof globalThis.CSS === "undefined" || !globalThis.CSS.escape) {
	(globalThis as unknown as Record<string, unknown>).CSS = {
		escape: (s: string) => s.replace(/([.*+?^${}()|[\]\\])/g, "\\$1"),
	};
}

function makeBinaryResponse(
	contentType: string,
	body: Uint8Array,
	status = 200,
): Response {
	return new Response(body.buffer as ArrayBuffer, {
		status,
		headers: { "Content-Type": contentType },
	});
}

function makeTextResponse(
	body: string,
	status = 200,
	contentType = "text/html",
): Response {
	return new Response(body, {
		status,
		headers: { "Content-Type": contentType },
	});
}

describe("fetch binary detection (T-010)", () => {
	beforeEach(() => {
		vi.stubGlobal("chrome", { runtime: { id: "ext" } });
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
	});

	it("JPEG fetch returns bodyEncoding: base64", async () => {
		const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
		vi.stubGlobal(
			"fetch",
			vi.fn(() => Promise.resolve(makeBinaryResponse("image/jpeg", jpegBytes))),
		);

		const result = await dispatchContentScriptCall(
			"page_fetch",
			"fetch",
			handlers.fetch,
			{ url: "http://example.com/photo.jpg" },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.bodyEncoding).toBe("base64");
			expect(result.value.contentType).toBe("image/jpeg");
			expect(result.value.byteLength).toBe(6);
			expect(result.value.status).toBe(200);
			expect(result.value.ok).toBe(true);
		}
	});

	it("base64 body has no replacement chars (U+FFFD)", async () => {
		// JPEG bytes that would be corrupted if read as UTF-8 text
		const jpegBytes = new Uint8Array([
			0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
			0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
			0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
			0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
			0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
			0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
			0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
			0x3c, 0x2e, 0x33, 0x34, 0x32, 0x01, 0x09, 0x0a, 0x0a, 0x0e, 0x0d, 0x0e,
			0x1c, 0x10, 0x10, 0x1c, 0x32, 0x26, 0x22, 0x26, 0x32, 0x32, 0x32, 0x32,
			0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32,
			0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32,
			0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32,
			0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32,
			0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32, 0x32,
		]);
		vi.stubGlobal(
			"fetch",
			vi.fn(() => Promise.resolve(makeBinaryResponse("image/jpeg", jpegBytes))),
		);

		const result = await dispatchContentScriptCall(
			"page_fetch",
			"fetch",
			handlers.fetch,
			{ url: "http://example.com/photo.jpg" },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.bodyEncoding).toBe("base64");
			expect(result.value.body).not.toContain("\uFFFD");
			// Verify round-trip: decode base64 and compare bytes
			const decoded = atob(result.value.body);
			expect(decoded.length).toBe(jpegBytes.length);
			for (let i = 0; i < jpegBytes.length; i++) {
				expect(decoded.charCodeAt(i)).toBe(jpegBytes[i]);
			}
		}
	});

	it("byteLength matches actual bytes for binary response", async () => {
		const binaryData = new Uint8Array(1024);
		for (let i = 0; i < 1024; i++) {
			binaryData[i] = i % 256;
		}
		vi.stubGlobal(
			"fetch",
			vi.fn(() =>
				Promise.resolve(
					makeBinaryResponse("application/octet-stream", binaryData),
				),
			),
		);

		const result = await dispatchContentScriptCall(
			"page_fetch",
			"fetch",
			handlers.fetch,
			{ url: "http://example.com/data.bin" },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.byteLength).toBe(1024);
			expect(result.value.bodyEncoding).toBe("base64");
			const decoded = atob(result.value.body);
			expect(decoded.length).toBe(1024);
		}
	});

	it("text responses still work with bodyEncoding: text", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(() =>
				Promise.resolve(makeTextResponse("<html><body>Hello</body></html>")),
			),
		);

		const result = await dispatchContentScriptCall(
			"page_fetch",
			"fetch",
			handlers.fetch,
			{ url: "http://example.com/" },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.bodyEncoding).toBe("text");
			expect(result.value.body).toBe("<html><body>Hello</body></html>");
			expect(result.value.byteLength).toBe(
				"<html><body>Hello</body></html>".length,
			);
			expect(result.value.status).toBe(200);
			expect(result.value.ok).toBe(true);
		}
	});

	it.each([
		["audio/mpeg", new Uint8Array([0x49, 0x44, 0x33])],
		[
			"video/mp4",
			new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]),
		],
		["application/zip", new Uint8Array([0x50, 0x4b, 0x03, 0x04])],
	])("binary content-type %s returns base64", async (contentType, body) => {
		vi.stubGlobal(
			"fetch",
			vi.fn(() => Promise.resolve(makeBinaryResponse(contentType, body))),
		);

		const result = await dispatchContentScriptCall(
			"page_fetch",
			"fetch",
			handlers.fetch,
			{ url: "http://example.com/asset" },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.bodyEncoding).toBe("base64");
			expect(result.value.contentType).toBe(contentType);
		}
	});

	it("mislabeled JPEG as text/plain with null bytes returns base64", async () => {
		const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
		vi.stubGlobal(
			"fetch",
			vi.fn(() => Promise.resolve(makeBinaryResponse("text/plain", jpegBytes))),
		);

		const result = await dispatchContentScriptCall(
			"page_fetch",
			"fetch",
			handlers.fetch,
			{ url: "http://example.com/photo.jpg" },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.bodyEncoding).toBe("base64");
			expect(result.value.byteLength).toBe(6);
		}
	});

	it("application/pdf returns base64", async () => {
		const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
		vi.stubGlobal(
			"fetch",
			vi.fn(() =>
				Promise.resolve(makeBinaryResponse("application/pdf", pdfBytes)),
			),
		);

		const result = await dispatchContentScriptCall(
			"page_fetch",
			"fetch",
			handlers.fetch,
			{ url: "http://example.com/doc.pdf" },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.bodyEncoding).toBe("base64");
			expect(result.value.contentType).toBe("application/pdf");
		}
	});

	it("includes finalUrl from response.url", async () => {
		// In jsdom, Response.url is read-only and set by the fetch implementation.
		// We verify the field exists and is a string; in a real browser it would be the final URL.
		vi.stubGlobal(
			"fetch",
			vi.fn(() =>
				Promise.resolve(
					new Response("ok", {
						status: 200,
						headers: { "Content-Type": "text/plain" },
					}),
				),
			),
		);

		const result = await dispatchContentScriptCall(
			"page_fetch",
			"fetch",
			handlers.fetch,
			{ url: "http://example.com/" },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(typeof result.value.finalUrl).toBe("string");
		}
	});

	it("includes response headers as record", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(() =>
				Promise.resolve(
					new Response("ok", {
						status: 200,
						headers: {
							"Content-Type": "text/plain",
							"X-Custom": "value",
						},
					}),
				),
			),
		);

		const result = await dispatchContentScriptCall(
			"page_fetch",
			"fetch",
			handlers.fetch,
			{ url: "http://example.com/" },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.headers).toEqual({
				"content-type": "text/plain",
				"x-custom": "value",
			});
		}
	});
});
