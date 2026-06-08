// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { inlineSnapshot } from "../src/content-script/snapshot.js";
import {
	getElementByRefId,
	throwElementNotFound,
} from "../src/content-script/dom-utils.js";
import {
	dispatchContentScriptCall,
	registerContentScriptSpec,
} from "../src/content-script/registry.js";
import { buildContentScriptSpecs } from "../src/content-script/schemas.js";
import { handlers } from "../src/content-script/handlers.js";

const mockAddListener = vi.fn();

declare global {
	var chrome: {
		runtime: {
			id: string;
			onMessage: {
				addListener: typeof mockAddListener;
			};
		};
	};
}

// Set up global chrome before any dynamic import
globalThis.chrome = {
	runtime: {
		id: "test-extension-id",
		onMessage: {
			addListener: mockAddListener,
		},
	},
};

// Polyfill CSS.escape for jsdom test environments where it is unavailable
if (typeof globalThis.CSS === "undefined" || !globalThis.CSS.escape) {
	(globalThis as unknown as Record<string, unknown>).CSS = {
		escape: (s: string) => s.replace(/([.*+?^${}()|[\]\\])/g, "\\$1"),
	};
}

// Import content-script to register the onMessage listener
await import("../src/content-script/index.js");

describe("content-script onMessage handler", () => {
	it("rejects messages from unauthorized senders", async () => {
		const sendResponse = vi.fn();
		const listener = mockAddListener.mock.calls[0][0];
		listener(
			{ action: "click", params: { refId: "e1" } },
			{ id: "malicious-extension" },
			sendResponse,
		);
		expect(sendResponse).toHaveBeenCalledWith({
			ok: false,
			error: "Unauthorized sender",
		});
	});

	it("routes direct action messages to the correct handler", async () => {
		const sendResponse = vi.fn();
		const listener = mockAddListener.mock.calls[0][0];
		listener(
			{ action: "ping" },
			{ id: globalThis.chrome.runtime.id },
			sendResponse,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(sendResponse).toHaveBeenCalledWith({ ok: true, value: { ok: true } });
	});

	it("returns error for unknown actions", async () => {
		const sendResponse = vi.fn();
		const listener = mockAddListener.mock.calls[0][0];
		listener(
			{ action: "unknown_action_xyz" },
			{ id: globalThis.chrome.runtime.id },
			sendResponse,
		);
		expect(sendResponse).toHaveBeenCalledWith({
			ok: false,
			error: "Unknown content script action: unknown_action_xyz",
		});
	});

	it("acks contract-ping messages without an action field", async () => {
		const sendResponse = vi.fn();
		const listener = mockAddListener.mock.calls[0][0];
		listener(
			{ type: "contract-ping" },
			{ id: globalThis.chrome.runtime.id },
			sendResponse,
		);
		expect(sendResponse).toHaveBeenCalledWith({ ok: true });
	});

	it("rejects messages with no action and no contract-ping type", async () => {
		const sendResponse = vi.fn();
		const listener = mockAddListener.mock.calls[0][0];
		listener(
			{ type: "other" },
			{ id: globalThis.chrome.runtime.id },
			sendResponse,
		);
		expect(sendResponse).toHaveBeenCalledWith({
			ok: false,
			error: "Missing action",
		});
	});

	it("routes registryCall messages to handlers", async () => {
		const sendResponse = vi.fn();
		const listener = mockAddListener.mock.calls[0][0];
		const returnValue = listener(
			{
				type: "registryCall",
				action: "ping",
				params: {},
				id: "call-1",
			},
			{ id: globalThis.chrome.runtime.id },
			sendResponse,
		);
		expect(returnValue).toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(sendResponse).toHaveBeenCalledOnce();
		const response = sendResponse.mock.calls[0][0] as {
			ok: boolean;
			value?: { ok: boolean };
		};
		expect(response.ok).toBe(true);
		expect(response.value).toEqual({ ok: true });
	});

	it("handles registryCallCancel without invoking handler", async () => {
		const sendResponse = vi.fn();
		const listener = mockAddListener.mock.calls[0][0];
		listener(
			{ type: "registryCallCancel", id: "call-cancel-1" },
			{ id: globalThis.chrome.runtime.id },
			sendResponse,
		);
		expect(sendResponse).toHaveBeenCalledWith({ ok: true });
	});

	it("routes async handlers and calls sendResponse when the promise resolves", async () => {
		const sendResponse = vi.fn();
		const listener = mockAddListener.mock.calls[0][0];
		const returnValue = listener(
			{ action: "snapshot", params: {} },
			{ id: globalThis.chrome.runtime.id },
			sendResponse,
		);
		// Async handlers must return true to keep the message channel open
		expect(returnValue).toBe(true);
		// sendResponse should not be called synchronously
		expect(sendResponse).not.toHaveBeenCalled();
		// Wait for the async snapshot to complete
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(sendResponse).toHaveBeenCalledOnce();
		const response = sendResponse.mock.calls[0][0] as { ok: boolean; value: { nodes: unknown[] } };
		expect(response.ok).toBe(true);
		expect(response.value.nodes).toBeDefined();
		expect(Array.isArray(response.value.nodes)).toBe(true);
	});
});

describe("snapshot refId contract", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("inlineSnapshot emits string refIds in e{N} format", () => {
		const btn1 = document.createElement("button");
		btn1.textContent = "First";
		const btn2 = document.createElement("button");
		btn2.textContent = "Second";
		document.body.appendChild(btn1);
		document.body.appendChild(btn2);

		const result = inlineSnapshot(500);
		expect(result.nodes).toHaveLength(2);
		expect(result.nodes[0].refId).toBe("e1");
		expect(result.nodes[1].refId).toBe("e2");
		expect(typeof result.nodes[0].refId).toBe("string");
		expect(result.nodes[0].refId).toMatch(/^e\d+$/);
	});

	it("inlineSnapshot sets data-ref-id attributes on DOM", () => {
		const btn = document.createElement("button");
		btn.textContent = "Click me";
		document.body.appendChild(btn);

		inlineSnapshot(500);
		expect(btn.getAttribute("data-ref-id")).toBe("e1");
	});

	it("inlineSnapshot snapshot text uses [e1] not [ref=", () => {
		const btn = document.createElement("button");
		btn.textContent = "Click me";
		document.body.appendChild(btn);

		const result = inlineSnapshot(500);
		expect(result.text).toContain("[e1]");
		expect(result.text).not.toContain("[ref=");
	});

	it("inlineSnapshot includes input value on form controls", () => {
		const input = document.createElement("input");
		input.type = "text";
		input.value = "typed";
		document.body.appendChild(input);

		const result = inlineSnapshot(500);
		expect(result.nodes.find((n) => n.tag === "input")?.value).toBe("typed");
	});

	it("snapshot → extract refId → click round-trip works", () => {
		const btn = document.createElement("button");
		btn.textContent = "Click me";
		let clicked = false;
		btn.addEventListener("click", () => {
			clicked = true;
		});
		document.body.appendChild(btn);

		const snapshot = inlineSnapshot(500);
		const refId = snapshot.nodes[0].refId;
		expect(refId).toMatch(/^e\d+$/);

		const el = getElementByRefId(refId);
		expect(el).toBe(btn);
		(el as HTMLElement).click();
		expect(clicked).toBe(true);
	});
});

describe("stale refId errors", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
	});

	it("throws E_STALE with recovery when refId is missing after DOM replace", async () => {
		const input = document.createElement("input");
		input.type = "text";
		document.body.appendChild(input);
		inlineSnapshot(500);
		const staleRefId = input.getAttribute("data-ref-id")!;
		input.remove();

		const result = await dispatchContentScriptCall(
			"page_fill",
			"fill",
			handlers.fill,
			{ refId: staleRefId, value: "x" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_STALE");
			expect(result.error.recovery?.[0]).toContain("snapshot_data");
			expect(result.error.details?.staleRefId).toBe(staleRefId);
		}
	});

	it("throwElementNotFound uses E_STALE for refId misses", () => {
		expect(() => throwElementNotFound("e99", undefined)).toThrow(/e99/);
		try {
			throwElementNotFound("e99", undefined);
		} catch (err) {
			expect((err as Error & { code?: string }).code).toBe("E_STALE");
		}
	});

	it("throwElementNotFound uses E_NOT_FOUND for label misses", () => {
		try {
			throwElementNotFound(undefined, "Missing label");
		} catch (err) {
			expect((err as Error & { code?: string }).code).toBe("E_NOT_FOUND");
			expect((err as Error).message).toContain('label "Missing label"');
		}
	});

	it("fill returns E_NOT_INTERACTABLE when value assignment has no effect", async () => {
		const input = document.createElement("input");
		input.setAttribute("data-ref-id", "e7");
		Object.defineProperty(input, "value", {
			get: () => "locked",
			set: () => {},
			configurable: true,
		});
		document.body.appendChild(input);

		const result = await dispatchContentScriptCall(
			"page_fill",
			"fill",
			handlers.fill,
			{ refId: "e7", value: "new" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_NOT_INTERACTABLE");
			expect(result.error.message).toContain("fill on e7");
		}
		document.body.removeChild(input);
	});

	it("select dispatches change event", async () => {
		const select = document.createElement("select");
		select.setAttribute("data-ref-id", "e8");
		const opt = document.createElement("option");
		opt.value = "b";
		select.appendChild(opt);
		document.body.appendChild(select);
		let changed = false;
		select.addEventListener("change", () => {
			changed = true;
		});

		const result = await dispatchContentScriptCall(
			"page_select",
			"select",
			handlers.select,
			{ refId: "e8", value: "b" },
		);
		expect(result.ok).toBe(true);
		expect(changed).toBe(true);
		document.body.removeChild(select);
	});

	it("check supports radio buttons and dispatches change", async () => {
		const radio = document.createElement("input");
		radio.type = "radio";
		radio.setAttribute("data-ref-id", "e9");
		document.body.appendChild(radio);
		let changed = false;
		radio.addEventListener("change", () => {
			changed = true;
		});

		const result = await dispatchContentScriptCall(
			"page_check",
			"check",
			handlers.check,
			{ refId: "e9", checked: true },
		);
		expect(result.ok).toBe(true);
		expect((radio as HTMLInputElement).checked).toBe(true);
		expect(changed).toBe(true);
		document.body.removeChild(radio);
	});
});
