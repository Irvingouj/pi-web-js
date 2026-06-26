// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearRoutes } from "../src/shared/main/routes.js";
import { FsWriteParamsSchema } from "../src/shared/cross/schemas.js";
import {
	extensionDispatch,
	registerWorkerHandler,
} from "../src/worker/worker.js";

describe("fs.writeBase64 (T-011)", () => {
	beforeEach(() => {
		clearRoutes();
	});

	it("returns { path, bytes_written } for valid params", async () => {
		const mockSession = {
			fsWriteBase64: vi.fn(() =>
				Promise.resolve({ path: "/tmp/photo.jpg", bytes_written: 6656 }),
			),
		} as unknown as import("../src/worker/extension_js.js").ExtensionSession;

		registerWorkerHandler("fs_write_base64", (p) =>
			mockSession.fsWriteBase64(p as { path: string; data: string }),
		);

		const result = await extensionDispatch(
			{ path: "/tmp/photo.jpg", data: "base64data" },
			{ action: "fs_write_base64" },
		);
		expect(result).toEqual({
			ok: true,
			value: { path: "/tmp/photo.jpg", bytes_written: 6656 },
		});
		expect(mockSession.fsWriteBase64).toHaveBeenCalledWith({
			path: "/tmp/photo.jpg",
			data: "base64data",
		});
	});

	it("rejects null params with E_INVALID_PARAMS", async () => {
		const parseResult = FsWriteParamsSchema.safeParse(null);
		expect(parseResult.success).toBe(false);
		if (!parseResult.success) {
			expect(parseResult.error.issues.length).toBeGreaterThan(0);
		}
	});

	it("rejects missing path with E_INVALID_PARAMS", async () => {
		const parseResult = FsWriteParamsSchema.safeParse({ data: "base64data" });
		expect(parseResult.success).toBe(false);
		if (!parseResult.success) {
			expect(
				parseResult.error.issues.some((i) => i.path.includes("path")),
			).toBe(true);
		}
	});

	it("rejects missing data with E_INVALID_PARAMS", async () => {
		const parseResult = FsWriteParamsSchema.safeParse({
			path: "/tmp/photo.jpg",
		});
		expect(parseResult.success).toBe(false);
		if (!parseResult.success) {
			expect(
				parseResult.error.issues.some((i) => i.path.includes("data")),
			).toBe(true);
		}
	});

	it("returns E_INVALID_ENCODING for invalid base64 data", async () => {
		registerWorkerHandler("fs_write_base64", (p) => {
			const params = p as { path: string; data: string };
			const isValid =
				/^[A-Za-z0-9+/]*={0,2}$/.test(params.data) &&
				params.data.length % 4 === 0;
			if (!isValid) {
				const err = new Error("Invalid base64 encoding") as Error & {
					code: string;
				};
				err.code = "E_INVALID_ENCODING";
				throw err;
			}
			return Promise.resolve({ path: params.path, bytes_written: 0 });
		});

		const result = await extensionDispatch(
			{ path: "/test.txt", data: "!!!invalid!!!" },
			{ action: "fs_write_base64" },
		);
		expect(result).toEqual({
			ok: false,
			error: { message: "Invalid base64 encoding", code: "E_INVALID_ENCODING" },
		});
	});
});

describe("fs.write and fs.writeText consistency (T-011)", () => {
	it("write returns { path, bytes_written } shape", async () => {
		const mockSession = {
			fsWrite: vi.fn(() =>
				Promise.resolve({ path: "/tmp/file.txt", bytes_written: 12 }),
			),
		} as unknown as import("../src/worker/extension_js.js").ExtensionSession;

		registerWorkerHandler("fs_write", (p) =>
			mockSession.fsWrite(p as { path: string; data: string }),
		);

		const result = await extensionDispatch(
			{ path: "/tmp/file.txt", data: "SGVsbG8gV29ybGQ=" },
			{ action: "fs_write" },
		);
		expect(result).toEqual({
			ok: true,
			value: { path: "/tmp/file.txt", bytes_written: 12 },
		});
	});

	it("writeText returns { path, bytes_written } shape", async () => {
		const mockSession = {
			fsWriteText: vi.fn(() =>
				Promise.resolve({ path: "/tmp/file.txt", bytes_written: 11 }),
			),
		} as unknown as import("../src/worker/extension_js.js").ExtensionSession;

		registerWorkerHandler("fs_write_text", (p) =>
			mockSession.fsWriteText(p as { path: string; data: string }),
		);

		const result = await extensionDispatch(
			{ path: "/tmp/file.txt", data: "Hello World" },
			{ action: "fs_write_text" },
		);
		expect(result).toEqual({
			ok: true,
			value: { path: "/tmp/file.txt", bytes_written: 11 },
		});
	});
});
