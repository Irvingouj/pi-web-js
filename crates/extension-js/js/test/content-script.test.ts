// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { inlineSnapshot } from "../src/content-script/snapshot.js";
import { getElementByRefId } from "../src/content-script/dom-utils.js";

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
