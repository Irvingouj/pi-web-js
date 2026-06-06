// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
	parseAsyncError,
	unwrapContentScriptMessage,
} from "../../src/shared/registry/content-script-response.js";

describe("parseAsyncError", () => {
	it("preserves structured validation errors", () => {
		expect(
			parseAsyncError({
				message: "Invalid parameters for page_click: ...",
				code: "E_INVALID_PARAMS",
				category: "validation",
			}),
		).toEqual({
			message: "Invalid parameters for page_click: ...",
			code: "E_INVALID_PARAMS",
			category: "validation",
		});
	});

	it("maps legacy string errors to E_CONTENT_SCRIPT", () => {
		expect(parseAsyncError("Unknown content script action: foo")).toEqual({
			message: "Unknown content script action: foo",
			code: "E_CONTENT_SCRIPT",
			category: "resource",
		});
	});

	it("uses E_CONTENT_SCRIPT when structured error omits code", () => {
		expect(parseAsyncError({ message: "handler blew up" })).toEqual({
			message: "handler blew up",
			code: "E_CONTENT_SCRIPT",
			category: "resource",
		});
	});
});

describe("unwrapContentScriptMessage", () => {
	it("passes through structured failures unchanged", () => {
		expect(
			unwrapContentScriptMessage({
				ok: false,
				error: {
					message: "bad return",
					code: "E_INVALID_RETURN",
					category: "validation",
				},
			}),
		).toEqual({
			ok: false,
			error: {
				message: "bad return",
				code: "E_INVALID_RETURN",
				category: "validation",
			},
		});
	});

	it("unwraps successful registry responses", () => {
		expect(
			unwrapContentScriptMessage({ ok: true, value: { nodes: [] } }),
		).toEqual({ ok: true, value: { nodes: [] } });
	});
});
