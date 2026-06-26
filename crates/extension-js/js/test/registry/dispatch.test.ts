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
