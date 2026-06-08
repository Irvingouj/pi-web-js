// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
	assertFillEffect,
	makeActionResult,
} from "../src/content-script/action-result.js";

describe("action-result", () => {
	it("makeActionResult includes click shape", () => {
		const btn = document.createElement("button");
		btn.setAttribute("data-ref-id", "e2");
		expect(makeActionResult("click", btn)).toEqual({
			ok: true,
			action: "click",
			refId: "e2",
		});
	});

	it("makeActionResult includes form state for inputs", () => {
		const input = document.createElement("input");
		input.setAttribute("data-ref-id", "e1");
		input.value = "hello";
		input.disabled = true;

		expect(makeActionResult("fill", input)).toEqual({
			ok: true,
			action: "fill",
			refId: "e1",
			value: "hello",
			disabled: true,
			readOnly: false,
		});
	});

	it("assertFillEffect throws E_NOT_INTERACTABLE when value did not change", () => {
		const input = document.createElement("input");
		input.setAttribute("data-ref-id", "e1");
		input.value = "old";

		expect(() => assertFillEffect("fill", input, "e1", "new")).toThrow(
			expect.objectContaining({
				code: "E_NOT_INTERACTABLE",
				message: "fill on e1 returned no effect.",
			}),
		);
	});

	it("assertFillEffect passes when value matches requested", () => {
		const input = document.createElement("input");
		input.setAttribute("data-ref-id", "e1");
		input.value = "hello";

		expect(() => assertFillEffect("fill", input, "e1", "hello")).not.toThrow();
	});
});
