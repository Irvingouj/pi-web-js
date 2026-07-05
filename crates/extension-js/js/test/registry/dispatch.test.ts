// @vitest-environment node

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { dispatchValidated } from "../../src/shared/cross/dispatch.js";
import { MutationReturnSchema } from "../../src/shared/cross/schemas.js";

describe("dispatchValidated with MutationReturnSchema", () => {
	it("passes when handler returns null", async () => {
		const result = await dispatchValidated(
			z.object({}),
			MutationReturnSchema,
			async () => null,
			{},
			"page_fill",
		);
		expect(result).toEqual({ ok: true, value: null });
	});

	it("passes when handler returns a structured PageActionResult", async () => {
		const result = await dispatchValidated(
			z.object({}),
			MutationReturnSchema,
			async () => ({ ok: true as const, action: "page_fill" }),
			{},
			"page_fill",
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ ok: true, action: "page_fill" });
		}
	});

	it("fails with E_INVALID_RETURN when handler returns invalid structured result", async () => {
		const result = await dispatchValidated(
			z.object({}),
			MutationReturnSchema,
			async () => ({ ok: false, action: "page_fill" }),
			{},
			"page_fill",
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_RETURN");
		}
	});
});
describe("formatValidationError structured fields", () => {
	// Mimics the web.tab.dom param shape (tab_dom action).
	const tabDomSchema = z.object({
		tabId: z.number(),
		selector: z.string(),
		depth: z.number().int().min(0).max(10).optional(),
		includeHidden: z.boolean().optional(),
	});

	it("reports param.path/expected/receivedType/receivedPreview for bad nested field", async () => {
		const result = await dispatchValidated(
			tabDomSchema,
			z.any(),
			async () => null,
			{ tabId: "x", selector: "input" },
			"tab_dom",
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
			expect(result.error.publicName).toBe("web.tab.dom");
			expect(result.error.action).toBe("tab_dom");
			expect(result.error.param?.path).toBe("tabId");
			expect(result.error.param?.receivedType).toBe("string");
			expect(result.error.param?.receivedPreview).toBe('"x"');
		}
	});

	it("reports missing required field name", async () => {
		const result = await dispatchValidated(
			tabDomSchema,
			z.any(),
			async () => null,
			{ tabId: 1 },
			"tab_dom",
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
			expect(result.error.param?.path).toBe("selector");
		}
	});

	it("reports root mismatch when params is wrong type", async () => {
		const result = await dispatchValidated(
			tabDomSchema,
			z.any(),
			async () => null,
			"input",
			"tab_dom",
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
			expect(result.error.param?.path).toBe("root");
			expect(result.error.param?.receivedType).toBe("string");
		}
	});
});
