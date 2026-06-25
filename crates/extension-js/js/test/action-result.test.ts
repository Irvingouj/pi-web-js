// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
	assertFillEffect,
	makeActionResult,
} from "../src/content-script/action-result.js";
import { handlers } from "../src/content-script/handlers.js";
import {
	grantObservation,
	resetLease,
} from "../src/content-script/observation-lease.js";

beforeEach(() => {
	resetLease();
});

function grantFromDom() {
	const els = Array.from(document.querySelectorAll("[data-ref-id]"));
	grantObservation(
		els.map((el) => ({ refId: el.getAttribute("data-ref-id")!, element: el })),
	);
}

// Polyfill CSS.escape for jsdom test environments where it is unavailable
if (typeof globalThis.CSS === "undefined" || !globalThis.CSS.escape) {
	(globalThis as unknown as Record<string, unknown>).CSS = {
		escape: (s: string) => s.replace(/([.*+?^${}()|[\]\\])/g, "\\$1"),
	};
}

// Polyfill scrollIntoView for jsdom
if (typeof Element.prototype.scrollIntoView === "undefined") {
	Element.prototype.scrollIntoView = () => {};
}

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

describe("T-015: mutation handlers return PageActionResult", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("click returns PageActionResult with ok, action, refId", () => {
		const btn = document.createElement("button");
		btn.setAttribute("data-ref-id", "e1");
		document.body.appendChild(btn);
		grantFromDom();
		const result = handlers.click({ refId: "e1" });
		expect(result).toMatchObject({ ok: true, action: "click", refId: "e1" });
	});

	it("fill returns PageActionResult with ok, action, refId, value", () => {
		const input = document.createElement("input");
		input.setAttribute("data-ref-id", "e1");
		document.body.appendChild(input);
		grantFromDom();
		const result = handlers.fill({ refId: "e1", value: "hello" });
		expect(result).toMatchObject({
			ok: true,
			action: "fill",
			refId: "e1",
			value: "hello",
		});
	});

	it("type returns PageActionResult with ok, action, refId, text", () => {
		const input = document.createElement("input");
		input.setAttribute("data-ref-id", "e1");
		document.body.appendChild(input);
		const result = handlers.type({ refId: "e1", text: "hello" });
		expect(result).toMatchObject({
			ok: true,
			action: "type",
			refId: "e1",
			text: "hello",
		});
	});

	it("append returns PageActionResult with ok, action, refId, text", () => {
		const input = document.createElement("input");
		input.setAttribute("data-ref-id", "e1");
		input.value = "hello";
		document.body.appendChild(input);
		const result = handlers.append({ refId: "e1", text: " world" });
		expect(result).toMatchObject({
			ok: true,
			action: "append",
			refId: "e1",
			text: "hello world",
		});
	});
	it("press returns PageActionResult with ok, action, key", () => {
		grantObservation([]);
		const result = handlers.press({ key: "Enter" });
		expect(result).toMatchObject({ ok: true, action: "press", key: "Enter" });
	});

	it("select returns PageActionResult with ok, action, refId, value", () => {
		const select = document.createElement("select");
		select.setAttribute("data-ref-id", "e1");
		const opt = document.createElement("option");
		opt.value = "b";
		select.appendChild(opt);
		document.body.appendChild(select);
		const result = handlers.select({ refId: "e1", value: "b" });
		expect(result).toMatchObject({
			ok: true,
			action: "select",
			refId: "e1",
			value: "b",
		});
	});

	it("check returns PageActionResult with ok, action, refId, checked", () => {
		const checkbox = document.createElement("input");
		checkbox.type = "checkbox";
		checkbox.setAttribute("data-ref-id", "e1");
		document.body.appendChild(checkbox);
		const result = handlers.check({ refId: "e1", checked: true });
		expect(result).toMatchObject({
			ok: true,
			action: "check",
			refId: "e1",
			checked: true,
		});
	});

	it("hover returns PageActionResult with ok, action, refId", () => {
		const btn = document.createElement("button");
		btn.setAttribute("data-ref-id", "e1");
		document.body.appendChild(btn);
		const result = handlers.hover({ refId: "e1" });
		expect(result).toMatchObject({ ok: true, action: "hover", refId: "e1" });
	});

	it("unhover returns PageActionResult with ok, action", () => {
		const result = handlers.unhover();
		expect(result).toMatchObject({ ok: true, action: "unhover" });
	});

	it("scroll returns PageActionResult with ok, action, direction, amount", () => {
		const result = handlers.scroll({ direction: "down", amount: 300 });
		expect(result).toMatchObject({
			ok: true,
			action: "scroll",
			direction: "down",
			amount: 300,
		});
	});

	it("scroll_to returns PageActionResult with ok, action, refId", () => {
		const btn = document.createElement("button");
		btn.setAttribute("data-ref-id", "e1");
		document.body.appendChild(btn);
		const result = handlers.scroll_to({ refId: "e1" });
		expect(result).toMatchObject({
			ok: true,
			action: "scroll_to",
			refId: "e1",
		});
	});

	it("dblclick returns PageActionResult with ok, action, refId", () => {
		const btn = document.createElement("button");
		btn.setAttribute("data-ref-id", "e1");
		document.body.appendChild(btn);
		const result = handlers.dblclick({ refId: "e1" });
		expect(result).toMatchObject({ ok: true, action: "dblclick", refId: "e1" });
	});

	it("successful dispatch with no effect is NOT reported as success", () => {
		const input = document.createElement("input");
		input.setAttribute("data-ref-id", "e1");
		Object.defineProperty(input, "value", {
			get: () => "locked",
			set: () => {},
			configurable: true,
		});
		document.body.appendChild(input);
		grantFromDom();
		expect(() => handlers.fill({ refId: "e1", value: "new" })).toThrow();
	});
});
