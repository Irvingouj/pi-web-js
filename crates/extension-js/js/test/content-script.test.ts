// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	getElementByRefId,
	throwElementNotFound,
} from "../src/content-script/dom-utils.js";
import { handlers } from "../src/content-script/handlers.js";
import {
	dispatchContentScriptCall,
	registerContentScriptSpec,
} from "../src/content-script/registry.js";
import { buildContentScriptSpecs } from "../src/content-script/schemas.js";
import { inlineSnapshot } from "../src/content-script/snapshot.js";

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

function installDataTransferPolyfill(): void {
	let usable = false;
	if (typeof globalThis.DataTransfer === "function") {
		try {
			new globalThis.DataTransfer();
			usable = true;
		} catch {
			usable = false;
		}
	}
	if (usable) {
		return;
	}

	class PolyfillDataTransfer {
		private readonly _files: File[] = [];

		items = {
			add: (file: File) => {
				this._files.push(file);
			},
			clear: () => {
				this._files.length = 0;
			},
			get length() {
				return this._files.length;
			},
		};

		get files(): FileList {
			const files = this._files;
			const fileList = {
				length: files.length,
				item: (index: number) => files[index] ?? null,
				[Symbol.iterator]: () => files[Symbol.iterator](),
			} as FileList;
			for (let i = 0; i < files.length; i++) {
				(fileList as FileList & Record<number, File>)[i] = files[i]!;
			}
			return fileList;
		}
	}

	globalThis.DataTransfer =
		PolyfillDataTransfer as unknown as typeof DataTransfer;
}

function installFileInputFilesPolyfill(): void {
	const proto = HTMLInputElement.prototype;
	const existing = Object.getOwnPropertyDescriptor(proto, "files");
	if (!existing) {
		return;
	}
	const fileListByInput = new WeakMap<HTMLInputElement, FileList>();
	Object.defineProperty(proto, "files", {
		get(this: HTMLInputElement) {
			return fileListByInput.get(this) ?? existing.get?.call(this) ?? null;
		},
		set(this: HTMLInputElement, value: FileList) {
			fileListByInput.set(this, value);
			try {
				existing.set?.call(this, value);
			} catch {
				// jsdom may reject programmatic file assignment
			}
		},
		configurable: true,
	});
}

installDataTransferPolyfill();
installFileInputFilesPolyfill();

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
		expect(sendResponse).toHaveBeenCalledWith({
			ok: true,
			value: { ok: true },
		});
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
			error: "Use registryCall for content-script actions",
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

	it("rejects bare DOM actions without registryCall", async () => {
		const sendResponse = vi.fn();
		const listener = mockAddListener.mock.calls[0][0];
		listener(
			{ action: "click", params: { refId: "e1" } },
			{ id: globalThis.chrome.runtime.id },
			sendResponse,
		);
		expect(sendResponse).toHaveBeenCalledWith({
			ok: false,
			error: "Use registryCall for content-script actions",
		});
	});

	it("registryCall page_snapshot resolves snapshot_text handler (string)", async () => {
		document.body.innerHTML = "<button>Go</button>";
		const sendResponse = vi.fn();
		const listener = mockAddListener.mock.calls[0][0];
		listener(
			{
				type: "registryCall",
				action: "page_snapshot",
				params: {},
				id: "snap-text-1",
			},
			{ id: globalThis.chrome.runtime.id },
			sendResponse,
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const response = sendResponse.mock.calls[0][0] as {
			ok: boolean;
			value: string;
		};
		expect(response.ok).toBe(true);
		expect(typeof response.value).toBe("string");
		expect(response.value).toContain("[e1]");
	});

	it("registryCall page_snapshot_data resolves snapshot handler (object)", async () => {
		document.body.innerHTML = "<button>Go</button>";
		const sendResponse = vi.fn();
		const listener = mockAddListener.mock.calls[0][0];
		listener(
			{
				type: "registryCall",
				action: "page_snapshot_data",
				params: {},
				id: "snap-data-1",
			},
			{ id: globalThis.chrome.runtime.id },
			sendResponse,
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const response = sendResponse.mock.calls[0][0] as {
			ok: boolean;
			value: { text: string; nodes: unknown[] };
		};
		expect(response.ok).toBe(true);
		expect(response.value.nodes).toBeDefined();
		expect(Array.isArray(response.value.nodes)).toBe(true);
		expect(response.value.text).toContain("[e1]");
	});

	it("registryCall tab_snapshot resolves snapshot_text handler (string)", async () => {
		document.body.innerHTML = "<button>Tab</button>";
		const sendResponse = vi.fn();
		const listener = mockAddListener.mock.calls[0][0];
		listener(
			{
				type: "registryCall",
				action: "tab_snapshot",
				params: { tabId: 1 },
				id: "tab-snap-text-1",
			},
			{ id: globalThis.chrome.runtime.id },
			sendResponse,
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const response = sendResponse.mock.calls[0][0] as {
			ok: boolean;
			value: string;
		};
		expect(response.ok).toBe(true);
		expect(typeof response.value).toBe("string");
		expect(response.value).toContain("[e1]");
	});

	it("registryCall tab_snapshot_data resolves snapshot handler (object)", async () => {
		document.body.innerHTML = "<button>Tab</button>";
		const sendResponse = vi.fn();
		const listener = mockAddListener.mock.calls[0][0];
		listener(
			{
				type: "registryCall",
				action: "tab_snapshot_data",
				params: { tabId: 1 },
				id: "tab-snap-data-1",
			},
			{ id: globalThis.chrome.runtime.id },
			sendResponse,
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const response = sendResponse.mock.calls[0][0] as {
			ok: boolean;
			value: { text: string; nodes: unknown[] };
		};
		expect(response.ok).toBe(true);
		expect(response.value.nodes).toBeDefined();
		expect(Array.isArray(response.value.nodes)).toBe(true);
		expect(response.value.text).toContain("[e1]");
	});
});

describe("snapshot_query handler", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("filter by role returns only matching nodes", async () => {
		document.body.innerHTML = "<button>A</button><a href='#'>B</a><h1>C</h1>";
		const sendResponse = vi.fn();
		const listener = mockAddListener.mock.calls[0][0];
		listener(
			{
				type: "registryCall",
				action: "page_snapshot_query",
				params: { filter: { role: "button" } },
				id: "sq-1",
			},
			{ id: globalThis.chrome.runtime.id },
			sendResponse,
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const response = sendResponse.mock.calls[0][0] as {
			ok: boolean;
			value: { nodes: Array<{ role: string }> };
		};
		expect(response.ok).toBe(true);
		expect(response.value.nodes).toHaveLength(1);
		expect(response.value.nodes[0].role).toBe("button");
	});

	it("filter by multiple roles", async () => {
		document.body.innerHTML =
			"<button>A</button><a href='#'>B</a><input type='text'>";
		const sendResponse = vi.fn();
		const listener = mockAddListener.mock.calls[0][0];
		listener(
			{
				type: "registryCall",
				action: "page_snapshot_query",
				params: { filter: { role: ["button", "link"] } },
				id: "sq-2",
			},
			{ id: globalThis.chrome.runtime.id },
			sendResponse,
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const response = sendResponse.mock.calls[0][0] as {
			ok: boolean;
			value: { nodes: Array<{ role: string }> };
		};
		expect(response.ok).toBe(true);
		expect(response.value.nodes).toHaveLength(2);
	});

	it("filter by tag", async () => {
		document.body.innerHTML = "<button>A</button><a href='#'>B</a>";
		const sendResponse = vi.fn();
		const listener = mockAddListener.mock.calls[0][0];
		listener(
			{
				type: "registryCall",
				action: "page_snapshot_query",
				params: { filter: { tag: "a" } },
				id: "sq-3",
			},
			{ id: globalThis.chrome.runtime.id },
			sendResponse,
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const response = sendResponse.mock.calls[0][0] as {
			ok: boolean;
			value: { nodes: Array<{ tag: string }> };
		};
		expect(response.ok).toBe(true);
		expect(response.value.nodes).toHaveLength(1);
		expect(response.value.nodes[0].tag).toBe("a");
	});

	it("filter by interactiveOnly excludes non-interactive", async () => {
		document.body.innerHTML =
			"<button>A</button><div>B</div><h1>C</h1><a href='#'>D</a>";
		const sendResponse = vi.fn();
		const listener = mockAddListener.mock.calls[0][0];
		listener(
			{
				type: "registryCall",
				action: "page_snapshot_query",
				params: { filter: { interactiveOnly: true } },
				id: "sq-4",
			},
			{ id: globalThis.chrome.runtime.id },
			sendResponse,
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const response = sendResponse.mock.calls[0][0] as {
			ok: boolean;
			value: { nodes: Array<{ role: string }> };
		};
		expect(response.ok).toBe(true);
		const roles = response.value.nodes.map((n: { role: string }) => n.role);
		expect(roles).not.toContain("heading");
		expect(roles).not.toContain("generic");
		expect(roles).toContain("button");
		expect(roles).toContain("link");
	});

	it("filter by text substring (case-insensitive)", async () => {
		document.body.innerHTML = "<button>Sign in</button><button>Cancel</button>";
		const sendResponse = vi.fn();
		const listener = mockAddListener.mock.calls[0][0];
		listener(
			{
				type: "registryCall",
				action: "page_snapshot_query",
				params: { filter: { text: "sign" } },
				id: "sq-5",
			},
			{ id: globalThis.chrome.runtime.id },
			sendResponse,
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const response = sendResponse.mock.calls[0][0] as {
			ok: boolean;
			value: { nodes: Array<{ text: string }> };
		};
		expect(response.ok).toBe(true);
		expect(response.value.nodes).toHaveLength(1);
		expect(response.value.nodes[0].text).toContain("Sign in");
	});

	it("filter by name substring", async () => {
		document.body.innerHTML =
			"<input aria-label='Email'><input aria-label='Password'>";
		const sendResponse = vi.fn();
		const listener = mockAddListener.mock.calls[0][0];
		listener(
			{
				type: "registryCall",
				action: "page_snapshot_query",
				params: { filter: { name: "email" } },
				id: "sq-6",
			},
			{ id: globalThis.chrome.runtime.id },
			sendResponse,
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const response = sendResponse.mock.calls[0][0] as {
			ok: boolean;
			value: { nodes: unknown[] };
		};
		expect(response.ok).toBe(true);
		expect(response.value.nodes).toHaveLength(1);
	});

	it("filter by href substring", async () => {
		document.body.innerHTML = "<a href='/docs'>Docs</a><a href='/api'>API</a>";
		const sendResponse = vi.fn();
		const listener = mockAddListener.mock.calls[0][0];
		listener(
			{
				type: "registryCall",
				action: "page_snapshot_query",
				params: { filter: { href: "/docs" } },
				id: "sq-7",
			},
			{ id: globalThis.chrome.runtime.id },
			sendResponse,
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const response = sendResponse.mock.calls[0][0] as {
			ok: boolean;
			value: { nodes: Array<{ href: string }> };
		};
		expect(response.ok).toBe(true);
		expect(response.value.nodes).toHaveLength(1);
	});

	it("combined filter with AND logic", async () => {
		document.body.innerHTML =
			"<button>OK</button><a href='/go'>Go</a><button>Cancel</button>";
		const sendResponse = vi.fn();
		const listener = mockAddListener.mock.calls[0][0];
		listener(
			{
				type: "registryCall",
				action: "page_snapshot_query",
				params: { filter: { role: "button", text: "ok" } },
				id: "sq-8",
			},
			{ id: globalThis.chrome.runtime.id },
			sendResponse,
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const response = sendResponse.mock.calls[0][0] as {
			ok: boolean;
			value: { nodes: Array<{ role: string; text: string }> };
		};
		expect(response.ok).toBe(true);
		expect(response.value.nodes).toHaveLength(1);
		expect(response.value.nodes[0].text).toContain("OK");
	});

	it("empty filter returns all nodes", async () => {
		document.body.innerHTML = "<button>A</button><a href='#'>B</a><h1>C</h1>";
		const _sendResponse = vi.fn();
		const listener = mockAddListener.mock.calls[0][0];
		// Get unfiltered count via snapshot_data
		listener(
			{
				type: "registryCall",
				action: "page_snapshot_data",
				params: {},
				id: "sq-base",
			},
			{ id: globalThis.chrome.runtime.id },
			vi.fn(),
		);
		await new Promise((resolve) => setTimeout(resolve, 10));

		const sendResponse2 = vi.fn();
		listener(
			{
				type: "registryCall",
				action: "page_snapshot_query",
				params: {},
				id: "sq-9",
			},
			{ id: globalThis.chrome.runtime.id },
			sendResponse2,
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const response = sendResponse2.mock.calls[0][0] as {
			ok: boolean;
			value: { nodes: unknown[] };
		};
		expect(response.ok).toBe(true);
		expect(response.value.nodes.length).toBeGreaterThan(0);
	});

	it("empty result returns empty nodes", async () => {
		document.body.innerHTML = "<div>text</div>";
		const sendResponse = vi.fn();
		const listener = mockAddListener.mock.calls[0][0];
		listener(
			{
				type: "registryCall",
				action: "page_snapshot_query",
				params: { filter: { role: "button" } },
				id: "sq-10",
			},
			{ id: globalThis.chrome.runtime.id },
			sendResponse,
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const response = sendResponse.mock.calls[0][0] as {
			ok: boolean;
			value: { nodes: unknown[] };
		};
		expect(response.ok).toBe(true);
		expect(response.value.nodes).toHaveLength(0);
	});

	it("returns url, title, viewport metadata", async () => {
		document.body.innerHTML = "<button>A</button>";
		const sendResponse = vi.fn();
		const listener = mockAddListener.mock.calls[0][0];
		listener(
			{
				type: "registryCall",
				action: "page_snapshot_query",
				params: { filter: { interactiveOnly: true } },
				id: "sq-11",
			},
			{ id: globalThis.chrome.runtime.id },
			sendResponse,
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const response = sendResponse.mock.calls[0][0] as {
			ok: boolean;
			value: {
				nodes: unknown[];
				url: string;
				title: string;
				viewport: { width: number; height: number };
			};
		};
		expect(response.ok).toBe(true);
		expect(typeof response.value.url).toBe("string");
		expect(typeof response.value.title).toBe("string");
		expect(response.value.viewport).toBeDefined();
		expect(typeof response.value.viewport.width).toBe("number");
	});

	it("returns E_SNAPSHOT when document.body is null", async () => {
		const originalBody = document.body;
		// Remove body by replacing it
		const parent = originalBody?.parentNode;
		if (parent) parent.removeChild(originalBody!);
		const sendResponse = vi.fn();
		const listener = mockAddListener.mock.calls[0][0];
		listener(
			{
				type: "registryCall",
				action: "page_snapshot_query",
				params: { filter: { role: "button" } },
				id: "sq-12",
			},
			{ id: globalThis.chrome.runtime.id },
			sendResponse,
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const response = sendResponse.mock.calls[0][0] as {
			ok: boolean;
			error?: { code: string };
		};
		expect(response.ok).toBe(false);
		expect(response.error?.code).toBe("E_SNAPSHOT");
		// Restore body
		if (parent && originalBody) parent.appendChild(originalBody);
	});

	it("limit caps results", async () => {
		document.body.innerHTML = Array.from(
			{ length: 10 },
			(_, i) => `<button>Btn${i}</button>`,
		).join("");
		const sendResponse = vi.fn();
		const listener = mockAddListener.mock.calls[0][0];
		listener(
			{
				type: "registryCall",
				action: "page_snapshot_query",
				params: { filter: { role: "button", limit: 3 } },
				id: "sq-13",
			},
			{ id: globalThis.chrome.runtime.id },
			sendResponse,
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const response = sendResponse.mock.calls[0][0] as {
			ok: boolean;
			value: { nodes: unknown[] };
		};
		expect(response.ok).toBe(true);
		expect(response.value.nodes).toHaveLength(3);
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

	it("inlineSnapshot includes status feedback in generic p elements", () => {
		const status = document.createElement("p");
		status.id = "status";
		status.textContent = "filled:Alice";
		document.body.appendChild(status);

		const result = inlineSnapshot(500);
		expect(result.text).toContain("filled:Alice");
		expect(
			result.nodes.some((n) => n.tag === "p" && n.name === "filled:Alice"),
		).toBe(true);
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

	it("click with stale refId returns E_STALE with candidates", async () => {
		const btn = document.createElement("button");
		btn.textContent = "Target";
		document.body.appendChild(btn);
		const otherBtn = document.createElement("button");
		otherBtn.textContent = "Other";
		document.body.appendChild(otherBtn);
		inlineSnapshot(500);
		const staleRefId = btn.getAttribute("data-ref-id")!;
		btn.remove();

		const result = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ refId: staleRefId },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_STALE");
			expect(result.error.details?.staleRefId).toBe(staleRefId);
			expect(Array.isArray(result.error.details?.candidates)).toBe(true);
			expect(result.error.details?.candidates.length).toBeGreaterThan(0);
		}
	});

	it("fill with stale refId returns E_STALE", async () => {
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
			expect(result.error.details?.staleRefId).toBe(staleRefId);
		}
	});

	it("fill disabled input returns E_NOT_INTERACTABLE", async () => {
		const input = document.createElement("input");
		input.setAttribute("data-ref-id", "e98");
		input.disabled = true;
		document.body.appendChild(input);

		const result = await dispatchContentScriptCall(
			"page_fill",
			"fill",
			handlers.fill,
			{ refId: "e98", value: "hello" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_NOT_INTERACTABLE");
			expect(result.error.message).toContain("fill");
		}
		document.body.removeChild(input);
	});

	it("click disabled element returns E_NOT_INTERACTABLE", async () => {
		const btn = document.createElement("button");
		btn.setAttribute("data-ref-id", "e99");
		btn.textContent = "Disabled";
		btn.disabled = true;
		document.body.appendChild(btn);

		const result = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ refId: "e99" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_NOT_INTERACTABLE");
			expect(result.error.message).toContain("click");
		}
		document.body.removeChild(btn);
	});

	it("click on aria-disabled element returns E_NOT_INTERACTABLE", async () => {
		document.body.innerHTML = `<button aria-disabled="true" data-ref-id="e1">Click</button>`;
		const result = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ refId: "e1" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_NOT_INTERACTABLE");
		}
	});

	it("find by non-existent label returns label-not-found error", async () => {
		const result = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ label: "NonExistentLabelXYZ" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_NOT_FOUND");
			expect(result.error.message).toContain("NonExistentLabelXYZ");
		}
	});

	it.each([
		["down", { top: 300, left: 0 }],
		["up", { top: -300, left: 0 }],
		["right", { top: 0, left: 300 }],
		["left", { top: 0, left: -300 }],
	])("scroll %s calls scrollBy with correct offsets", (direction, expected) => {
		const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
		handlers.scroll({ direction, amount: 300 });
		expect(scrollBy).toHaveBeenCalledWith({
			...expected,
			behavior: "smooth",
		});
		scrollBy.mockRestore();
	});

	it("append returns E_NOT_INTERACTABLE when value assignment has no effect", async () => {
		const input = document.createElement("input");
		input.setAttribute("data-ref-id", "e9");
		Object.defineProperty(input, "value", {
			get: () => "locked",
			set: () => {},
			configurable: true,
		});
		document.body.appendChild(input);

		const result = await dispatchContentScriptCall(
			"page_append",
			"append",
			handlers.append,
			{ refId: "e9", text: "more" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_NOT_INTERACTABLE");
			expect(result.error.message).toContain("append on e9");
		}
		document.body.removeChild(input);
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

	it("find returns matching elements with refId and role", async () => {
		document.body.innerHTML = "<h1>Title</h1>";
		const result = await dispatchContentScriptCall(
			"page_find",
			"find",
			handlers.find,
			{ selector: "h1" },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toHaveLength(1);
			expect(result.value[0].tag).toBe("h1");
			expect(result.value[0].refId).toMatch(/^e\d+$/);
			expect(result.value[0].text).toBe("Title");
			expect(result.value[0].role).toBe("heading");
		}
	});

	it("extract returns requested fields", async () => {
		document.title = "Page";
		const result = await dispatchContentScriptCall(
			"page_extract",
			"extract",
			handlers.extract,
			{ fields: ["title"] },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ title: "Page" });
		}
	});

	it("snapshot_text returns text only", async () => {
		document.body.innerHTML = "<button>Go</button>";
		const result = await dispatchContentScriptCall(
			"page_snapshot_text",
			"snapshot_text",
			handlers.snapshot_text,
			{ max_nodes: 50 },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(typeof result.value).toBe("string");
			expect(result.value).toContain("Go");
		}
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

describe("set_files handler", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
	});

	it("attaches a file to input[type=file] from resolved bytes", async () => {
		const input = document.createElement("input");
		input.type = "file";
		input.setAttribute("data-ref-id", "e1");
		let changed = false;
		input.addEventListener("change", () => {
			changed = true;
		});
		document.body.appendChild(input);

		const result = await dispatchContentScriptCall(
			"page_set_files",
			"set_files",
			handlers.set_files,
			{
				refId: "e1",
				files: [
					{
						kind: "bytes",
						name: "hello.txt",
						data: "aGVsbG8=",
						mimeType: "text/plain",
					},
				],
			},
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const value = result.value as {
				fileCount?: number;
				fileNames?: string[];
			};
			expect(value.fileCount).toBe(1);
			expect(value.fileNames).toEqual(["hello.txt"]);
		}
		expect(input.files?.length).toBe(1);
		expect(input.files?.[0]?.name).toBe("hello.txt");
		expect(input.files?.[0]?.size).toBe(5);
		expect(changed).toBe(true);
	});

	it("attaches a file from resolved url", async () => {
		const input = document.createElement("input");
		input.type = "file";
		input.setAttribute("data-ref-id", "e2");
		document.body.appendChild(input);
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(new Uint8Array([97]), {
				status: 200,
				headers: { "content-type": "text/plain" },
			}),
		);

		const result = await dispatchContentScriptCall(
			"page_set_files",
			"set_files",
			handlers.set_files,
			{
				refId: "e2",
				files: [
					{
						kind: "url",
						url: "https://example.com/a.txt",
						name: "a.txt",
					},
				],
			},
		);
		fetchMock.mockRestore();
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(input.files?.[0]?.name).toBe("a.txt");
		}
	});

	it("rejects non-file inputs with E_NOT_INTERACTABLE", async () => {
		const input = document.createElement("input");
		input.type = "text";
		input.setAttribute("data-ref-id", "e3");
		document.body.appendChild(input);

		const result = await dispatchContentScriptCall(
			"page_set_files",
			"set_files",
			handlers.set_files,
			{
				refId: "e3",
				files: [
					{
						kind: "bytes",
						name: "x.txt",
						data: "YQ==",
						mimeType: "text/plain",
					},
				],
			},
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_NOT_INTERACTABLE");
		}
	});

	it("rejects invalid base64 with E_INVALID_PARAMS", async () => {
		const input = document.createElement("input");
		input.type = "file";
		input.setAttribute("data-ref-id", "e4");
		document.body.appendChild(input);

		const result = await dispatchContentScriptCall(
			"page_set_files",
			"set_files",
			handlers.set_files,
			{
				refId: "e4",
				files: [
					{
						kind: "bytes",
						name: "bad.bin",
						data: "!!!",
						mimeType: "application/octet-stream",
					},
				],
			},
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
		}
	});

	it("rejects missing refId and label", async () => {
		const result = await dispatchContentScriptCall(
			"page_set_files",
			"set_files",
			handlers.set_files,
			{
				files: [
					{
						kind: "bytes",
						name: "x.txt",
						data: "YQ==",
						mimeType: "text/plain",
					},
				],
			},
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
		}
	});
});
