// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
	PageActionResultSchema,
	MutationReturnSchema,
} from "../src/shared/schemas.js";

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
