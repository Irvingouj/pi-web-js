// @vitest-environment node

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	dispatchContentScriptCall,
	registerContentScriptSpec,
} from "../../src/content-script/registry.js";

describe("dispatchContentScriptCall", () => {
	it("validates params and returns before invoking the handler", async () => {
		registerContentScriptSpec({
			registryAction: "page_click",
			handlerKey: "click",
			params: z.object({ refId: z.string().regex(/^e\d+$/) }),
			returns: z.null(),
		});

		let invoked = false;
		const result = await dispatchContentScriptCall(
			"page_click",
			"click",
			async () => {
				invoked = true;
				return null;
			},
			{},
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
		}
		expect(invoked).toBe(false);
	});

	it("rejects invalid refId formats", async () => {
		registerContentScriptSpec({
			registryAction: "page_click",
			handlerKey: "click",
			params: z.object({ refId: z.string().regex(/^e\d+$/) }),
			returns: z.null(),
		});

		for (const badRefId of [2, "2", "btn"]) {
			let invoked = false;
			const result = await dispatchContentScriptCall(
				"page_click",
				"click",
				async () => {
					invoked = true;
					return null;
				},
				{ refId: badRefId },
			);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe("E_INVALID_PARAMS");
			}
			expect(invoked).toBe(false);
		}
	});

	it("rejects actions without registered schemas", async () => {
		const result = await dispatchContentScriptCall(
			"missing_schema_action",
			"missing",
			async () => true,
			{},
		);
		expect(result).toEqual({
			ok: false,
			error: {
				message:
					"No schema registered for content-script action: missing_schema_action",
				code: "E_INTERNAL",
			},
		});
	});
});
