import { describe, expect, it } from "vitest";
import { maybeStoreFetchResult } from "../src/worker/fetch-store.js";
import { takeBlob } from "../src/worker/binary-blob-store.js";

describe("maybeStoreFetchResult", () => {
	it("stores binary fetch results when store is true", () => {
		const stored = maybeStoreFetchResult(
			{ url: "https://example.com/x", store: true },
			{
				status: 200,
				ok: true,
				headers: {},
				body: "YQ==",
				bodyEncoding: "base64",
				byteLength: 1,
				contentType: "text/plain",
				finalUrl: "https://example.com/x",
			},
			"run-1",
		) as {
			bodyEncoding: string;
			handle?: string;
			body?: string;
		};

		expect(stored.bodyEncoding).toBe("handle");
		expect(stored.handle).toMatch(/^blob_/);
		expect(stored.body).toBeUndefined();
		expect(takeBlob("run-1", stored.handle!)).not.toBeNull();
	});

	it("leaves text responses unchanged even when store is true", () => {
		const value = {
			status: 200,
			ok: true,
			headers: {},
			body: "hello",
			bodyEncoding: "text" as const,
			byteLength: 5,
			contentType: "text/plain",
			finalUrl: "https://example.com/x",
		};
		expect(maybeStoreFetchResult({ store: true }, value, "run-1")).toEqual(value);
	});
});
