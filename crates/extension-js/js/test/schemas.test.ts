// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
	dispatchContentScriptCall,
	registerContentScriptSpec,
} from "../src/content-script/registry.js";
import {
	FetchParamsSchema,
	FsWriteParamsSchema,
	MutationReturnSchema,
	PageActionResultSchema,
	PageFillParamsSchema,
	PageSetFilesParamsSchema,
	PageSnapshotQueryParamsSchema,
	TabSnapshotQueryParamsSchema,
} from "../src/shared/cross/schemas.js";
import {
	extensionDispatch,
	registerWorkerHandlerValidated,
} from "../src/worker/worker.js";

describe("PageActionResultSchema", () => {
	it("parses a valid structured result", () => {
		const result = PageActionResultSchema.parse({
			ok: true,
			action: "page_fill",
		});
		expect(result).toEqual({ ok: true, action: "page_fill" });
	});

	it("parses a valid structured result with all optional fields", () => {
		const result = PageActionResultSchema.parse({
			ok: true,
			action: "page_click",
			refId: "e2",
			tag: "button",
			role: "button",
			value: "clicked",
			checked: true,
			key: "Enter",
		});
		expect(result).toEqual({
			ok: true,
			action: "page_click",
			refId: "e2",
			tag: "button",
			role: "button",
			value: "clicked",
			checked: true,
			key: "Enter",
		});
	});

	it("fails when ok is not literal true", () => {
		const result = PageActionResultSchema.safeParse({
			ok: false,
			action: "page_fill",
		});
		expect(result.success).toBe(false);
	});

	it("fails when action is missing", () => {
		const result = PageActionResultSchema.safeParse({ ok: true });
		expect(result.success).toBe(false);
	});

	it("fails when ok is missing", () => {
		const result = PageActionResultSchema.safeParse({
			action: "page_fill",
		});
		expect(result.success).toBe(false);
	});

	it("rejects invalid refId format", () => {
		const result = PageActionResultSchema.safeParse({
			ok: true,
			action: "page_click",
			refId: "invalid",
		});
		expect(result.success).toBe(false);
	});
});

describe("MutationReturnSchema", () => {
	it("accepts a valid PageActionResult", () => {
		const result = MutationReturnSchema.parse({
			ok: true,
			action: "page_fill",
		});
		expect(result).toEqual({ ok: true, action: "page_fill" });
	});

	it("accepts null", () => {
		const result = MutationReturnSchema.parse(null);
		expect(result).toBeNull();
	});

	it("rejects an invalid structured result", () => {
		const result = MutationReturnSchema.safeParse({
			ok: false,
			action: "page_fill",
		});
		expect(result.success).toBe(false);
	});
});

describe("invalid parameter shapes produce E_INVALID_PARAMS (T-018)", () => {
	it("fetch rejects null params", () => {
		const result = FetchParamsSchema.safeParse(null);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.length).toBeGreaterThan(0);
		}
	});

	it("fetch rejects string instead of object", () => {
		const result = FetchParamsSchema.safeParse("http://example.com");
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some((i) => i.path.length === 0)).toBe(true);
		}
	});

	it("fetch rejects missing url", () => {
		const result = FetchParamsSchema.safeParse({ method: "GET" });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some((i) => i.path.includes("url"))).toBe(
				true,
			);
		}
	});

	it("fill rejects positional string", () => {
		const result = PageFillParamsSchema.safeParse("e2");
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.length).toBeGreaterThan(0);
		}
	});

	it("fill rejects positional number", () => {
		const result = PageFillParamsSchema.safeParse(42);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.length).toBeGreaterThan(0);
		}
	});

	it("fill rejects missing refId and label", () => {
		const result = PageFillParamsSchema.safeParse({ value: "hello" });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(
				result.error.issues.some((i) => i.message.includes("refId or label")),
			).toBe(true);
		}
	});

	it("setFiles rejects positional string", () => {
		const result = PageSetFilesParamsSchema.safeParse("e2");
		expect(result.success).toBe(false);
	});

	it("setFiles rejects empty files array", () => {
		const result = PageSetFilesParamsSchema.safeParse({
			refId: "e2",
			files: [],
		});
		expect(result.success).toBe(false);
	});

	it("setFiles rejects legacy data field", () => {
		const result = PageSetFilesParamsSchema.safeParse({
			refId: "e2",
			files: [{ name: "a.txt", data: "YQ==" }],
		});
		expect(result.success).toBe(false);
	});

	it("setFiles accepts url source", () => {
		const result = PageSetFilesParamsSchema.safeParse({
			refId: "e2",
			files: [{ url: "https://example.com/a.txt", name: "a.txt" }],
		});
		expect(result.success).toBe(true);
	});

	it("setFiles accepts path source", () => {
		const result = PageSetFilesParamsSchema.safeParse({
			refId: "e2",
			files: [{ path: "/tmp/a.txt" }],
		});
		expect(result.success).toBe(true);
	});

	it("setFiles accepts handle source", () => {
		const result = PageSetFilesParamsSchema.safeParse({
			refId: "e2",
			files: [{ handle: "blob_1", name: "a.txt" }],
		});
		expect(result.success).toBe(true);
	});

	it("setFiles rejects multiple sources on one file", () => {
		const result = PageSetFilesParamsSchema.safeParse({
			refId: "e2",
			files: [{ url: "https://example.com/a.txt", path: "/tmp/a.txt" }],
		});
		expect(result.success).toBe(false);
	});

	it("fs.writeBase64 rejects null params", () => {
		const result = FsWriteParamsSchema.safeParse(null);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.length).toBeGreaterThan(0);
		}
	});

	it("fs.writeBase64 rejects missing path", () => {
		const result = FsWriteParamsSchema.safeParse({ data: "base64data" });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some((i) => i.path.includes("path"))).toBe(
				true,
			);
		}
	});

	it("fs.writeBase64 rejects missing data", () => {
		const result = FsWriteParamsSchema.safeParse({ path: "/tmp/file.jpg" });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some((i) => i.path.includes("data"))).toBe(
				true,
			);
		}
	});

	it("fs.writeBase64 rejects string instead of object", () => {
		const result = FsWriteParamsSchema.safeParse("/tmp/file.jpg");
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some((i) => i.path.length === 0)).toBe(true);
		}
	});
});

describe("invalid parameter shapes produce E_INVALID_PARAMS through real dispatch path (T-018 integration)", () => {
	it("page_fetch via dispatchContentScriptCall rejects null params with E_INVALID_PARAMS", async () => {
		registerContentScriptSpec({
			registryAction: "page_fetch",
			handlerKey: "fetch",
			params: FetchParamsSchema,
			returns: PageActionResultSchema,
		});

		const result = await dispatchContentScriptCall(
			"page_fetch",
			"fetch",
			async () => ({ ok: true, action: "page_fetch" }),
			null,
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
			expect(result.error.message).toContain(
				"Invalid parameters for page_fetch",
			);
		}
	});

	it("page_fetch via dispatchContentScriptCall rejects missing url with E_INVALID_PARAMS", async () => {
		registerContentScriptSpec({
			registryAction: "page_fetch_missing_url",
			handlerKey: "fetch",
			params: FetchParamsSchema,
			returns: PageActionResultSchema,
		});

		const result = await dispatchContentScriptCall(
			"page_fetch_missing_url",
			"fetch",
			async () => ({ ok: true, action: "page_fetch" }),
			{ method: "GET" },
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
			expect(result.error.message).toContain("url");
		}
	});

	it("page_fetch via dispatchContentScriptCall preserves options field", async () => {
		registerContentScriptSpec({
			registryAction: "page_fetch_options",
			handlerKey: "fetch",
			params: FetchParamsSchema,
			returns: PageActionResultSchema,
		});

		const handler = vi.fn(async () => ({ ok: true, action: "page_fetch" }));

		const result = await dispatchContentScriptCall(
			"page_fetch_options",
			"fetch",
			handler,
			{
				url: "https://example.com",
				options: {
					method: "POST",
					headers: { "X-Custom": "value" },
					body: "data",
				},
			},
		);

		expect(result.ok).toBe(true);
		expect(handler).toHaveBeenCalled();
		const validatedParams = handler.mock.calls[0][0] as Record<string, unknown>;
		expect(validatedParams.url).toBe("https://example.com");
		expect(validatedParams.options).toEqual({
			method: "POST",
			headers: { "X-Custom": "value" },
			body: "data",
		});
	});

	it("fs_write_base64 via extensionDispatch rejects null params with E_INVALID_PARAMS", async () => {
		registerWorkerHandlerValidated(
			"fs_write_base64",
			FsWriteParamsSchema,
			async () => ({ path: "/tmp/file.jpg", bytes_written: 100 }),
		);

		const result = await extensionDispatch(null, { action: "fs_write_base64" });

		expect(result).toEqual({
			ok: false,
			error: {
				message: expect.stringContaining(
					"Invalid parameters for fs_write_base64",
				),
				code: "E_INVALID_PARAMS",
			},
		});
	});

	it("fs_write_base64 via extensionDispatch rejects missing path with E_INVALID_PARAMS", async () => {
		registerWorkerHandlerValidated(
			"fs_write_base64_missing_path",
			FsWriteParamsSchema,
			async () => ({ path: "/tmp/file.jpg", bytes_written: 100 }),
		);

		const result = await extensionDispatch(
			{ data: "base64data" },
			{ action: "fs_write_base64_missing_path" },
		);

		expect(result).toEqual({
			ok: false,
			error: {
				message: expect.stringContaining("path"),
				code: "E_INVALID_PARAMS",
			},
		});
	});

	it("fs_write_base64 via extensionDispatch rejects missing data with E_INVALID_PARAMS", async () => {
		registerWorkerHandlerValidated(
			"fs_write_base64_missing_data",
			FsWriteParamsSchema,
			async () => ({ path: "/tmp/file.jpg", bytes_written: 100 }),
		);

		const result = await extensionDispatch(
			{ path: "/tmp/file.jpg" },
			{ action: "fs_write_base64_missing_data" },
		);

		expect(result).toEqual({
			ok: false,
			error: {
				message: expect.stringContaining("data"),
				code: "E_INVALID_PARAMS",
			},
		});
	});
});

describe("PageSnapshotQueryParamsSchema", () => {
	it("parses valid params with role filter", () => {
		const result = PageSnapshotQueryParamsSchema.parse({
			filter: { role: "button" },
		});
		expect(result.filter).toEqual({ role: "button" });
	});

	it("parses valid params with multiple roles", () => {
		const result = PageSnapshotQueryParamsSchema.parse({
			filter: { role: ["button", "link"] },
		});
		expect(result.filter).toEqual({ role: ["button", "link"] });
	});

	it("parses valid params with interactiveOnly", () => {
		const result = PageSnapshotQueryParamsSchema.parse({
			filter: { interactiveOnly: true },
		});
		expect(result.filter).toEqual({ interactiveOnly: true });
	});

	it("parses valid params with max_nodes and filter", () => {
		const result = PageSnapshotQueryParamsSchema.parse({
			max_nodes: 100,
			filter: { tag: "a" },
		});
		expect(result.max_nodes).toBe(100);
		expect(result.filter).toEqual({ tag: "a" });
	});

	it("parses empty params", () => {
		const result = PageSnapshotQueryParamsSchema.parse({});
		expect(result).toEqual({});
	});

	it("rejects invalid interactiveOnly type", () => {
		const result = PageSnapshotQueryParamsSchema.safeParse({
			filter: { interactiveOnly: "yes" },
		});
		expect(result.success).toBe(false);
	});
});

describe("TabSnapshotQueryParamsSchema", () => {
	it("parses valid params with tabId and filter", () => {
		const result = TabSnapshotQueryParamsSchema.safeParse({
			tabId: 1,
			filter: { role: "button" },
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.tabId).toBe(1);
			expect(result.data.filter).toEqual({ role: "button" });
		}
	});

	it("rejects missing tabId", () => {
		const result = TabSnapshotQueryParamsSchema.safeParse({
			filter: { role: "button" },
		});
		expect(result.success).toBe(false);
	});

	it("rejects non-number tabId", () => {
		const result = TabSnapshotQueryParamsSchema.safeParse({
			tabId: "bad",
			filter: { role: "button" },
		});
		expect(result.success).toBe(false);
	});
});
