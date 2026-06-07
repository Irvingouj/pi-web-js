// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
	PageScrollToParamsSchema,
	TabScrollToParamsSchema,
} from "../src/shared/schemas.js";

describe("scroll_to param schemas", () => {
	it("PageScrollToParamsSchema accepts coordinates without refId", () => {
		const result = PageScrollToParamsSchema.safeParse({ x: 0, y: 100 });
		expect(result.success).toBe(true);
	});

	it("PageScrollToParamsSchema accepts refId target", () => {
		const result = PageScrollToParamsSchema.safeParse({ refId: "e1" });
		expect(result.success).toBe(true);
	});

	it("PageScrollToParamsSchema rejects empty object", () => {
		const result = PageScrollToParamsSchema.safeParse({});
		expect(result.success).toBe(false);
	});

	it("TabScrollToParamsSchema accepts coordinates without refId", () => {
		const result = TabScrollToParamsSchema.safeParse({
			tabId: 1,
			x: 0,
			y: 100,
		});
		expect(result.success).toBe(true);
	});
});
