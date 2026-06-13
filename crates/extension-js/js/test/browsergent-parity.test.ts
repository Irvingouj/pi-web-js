/**
 * Reproduces failure modes seen in Browsergent E2E (golden-path / js-playbook).
 * Passing here means extension-js behaves as designed; fix consumers, not runtime.
 */
// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { handlers } from "../src/content-script/handlers.js";
import {
	dispatchContentScriptCall,
	registerContentScriptSpec,
} from "../src/content-script/registry.js";
import { buildContentScriptSpecs } from "../src/content-script/schemas.js";
import { inlineSnapshot } from "../src/content-script/snapshot.js";

if (typeof globalThis.CSS === "undefined" || !globalThis.CSS.escape) {
	(globalThis as unknown as Record<string, unknown>).CSS = {
		escape: (s: string) => s.replace(/([.*+?^${}()|[\]\\])/g, "\\$1"),
	};
}

describe("Browsergent parity: snapshot_data contract", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("returns nodes[], not elements[] (js-playbook used wrong field)", () => {
		const input = document.createElement("input");
		input.type = "text";
		input.id = "field";
		document.body.appendChild(input);

		const data = inlineSnapshot(500);
		expect(Array.isArray(data.nodes)).toBe(true);
		expect(data.nodes[0]?.tag).toBe("input");
		expect(data.nodes[0]?.refId).toMatch(/^e\d+$/);
		expect("elements" in data).toBe(false);
	});

	it("snapshot_data → fill round-trip works with nodes[].refId", async () => {
		vi.stubGlobal("chrome", { runtime: { id: "ext" } });
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}

		const input = document.createElement("input");
		input.type = "text";
		input.id = "field";
		document.body.appendChild(input);

		const data = inlineSnapshot(500);
		const node = data.nodes.find((n) => n.tag === "input");
		expect(node).toBeDefined();

		const result = await dispatchContentScriptCall(
			"page_fill",
			"fill",
			handlers.fill,
			{ refId: node!.refId, value: "hello" },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toMatchObject({
				ok: true,
				action: "fill",
				refId: node!.refId,
				value: "hello",
			});
		}
		expect((input as HTMLInputElement).value).toBe("hello");
	});
});

describe("Browsergent parity: 0.4 object-only page.fill API", () => {
	beforeEach(() => {
		vi.stubGlobal("chrome", { runtime: { id: "ext" } });
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
	});

	it("rejects positional page.fill(refId, value) like golden-path mock used", async () => {
		const result = await dispatchContentScriptCall(
			"page_fill",
			"fill",
			handlers.fill,
			"1",
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
		}
	});

	it("rejects positional array [refId, value]", async () => {
		const result = await dispatchContentScriptCall(
			"page_fill",
			"fill",
			handlers.fill,
			["1", "test@example.com"],
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
		}
	});
});

describe("Browsergent parity: refId format", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		vi.stubGlobal("chrome", { runtime: { id: "ext" } });
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
	});

	it("hardcoded refId '1' is rejected; snapshot assigns e1 (golden-path mock)", async () => {
		const input = document.createElement("input");
		input.type = "text";
		document.body.appendChild(input);
		inlineSnapshot(500);
		expect(input.getAttribute("data-ref-id")).toBe("e1");

		const result = await dispatchContentScriptCall(
			"page_fill",
			"fill",
			handlers.fill,
			{ refId: "1", value: "test@example.com" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
		}
	});
});
