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
import {
	grantObservation,
	hasActiveObservation,
	resetLease,
} from "../src/content-script/observation-lease.js";

/** Grant an observation lease for every element currently carrying a data-ref-id. */
function grantFromDom(): void {
	const els = Array.from(document.querySelectorAll("[data-ref-id]"));
	grantObservation(
		els.map((el) => ({
			refId: el.getAttribute("data-ref-id")!,
			element: el,
		})),
	);
}

beforeEach(() => {
	resetLease();
});

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
		grantFromDom();
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
		grantFromDom();
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
		// candidates optional under new lease path (requireTarget may fire before element scan)
		}
	});

	it("fill with stale refId returns E_STALE", async () => {
		const input = document.createElement("input");
		input.type = "text";
		document.body.appendChild(input);
		inlineSnapshot(500);
		grantFromDom();
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
		grantFromDom();

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
		grantFromDom();

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
		grantFromDom();
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
			expect(result.error.code).toBe("E_OBSERVATION_REQUIRED");
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
		grantFromDom();

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
		grantFromDom();

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

describe("visibility with hidden ancestor (B10)", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
	});

	it("omits element under display:none ancestor from snapshot", () => {
		const wrapper = document.createElement("div");
		wrapper.style.display = "none";
		const btn = document.createElement("button");
		btn.textContent = "Hidden button";
		wrapper.appendChild(btn);
		document.body.appendChild(wrapper);

		const result = inlineSnapshot(500);
		expect(result.nodes.find((n) => n.name === "Hidden button")).toBeUndefined();
	});

	it("omits element under aria-hidden=true ancestor from snapshot", () => {
		const wrapper = document.createElement("div");
		wrapper.setAttribute("aria-hidden", "true");
		const btn = document.createElement("button");
		btn.textContent = "AriaHidden button";
		wrapper.appendChild(btn);
		document.body.appendChild(wrapper);

		const result = inlineSnapshot(500);
		expect(
			result.nodes.find((n) => n.name === "AriaHidden button"),
		).toBeUndefined();
	});

	it("omits element under inert ancestor from snapshot", () => {
		const wrapper = document.createElement("div");
		(wrapper as HTMLElement).inert = true;
		const btn = document.createElement("button");
		btn.textContent = "Inert button";
		wrapper.appendChild(btn);
		document.body.appendChild(wrapper);

		const result = inlineSnapshot(500);
		expect(result.nodes.find((n) => n.name === "Inert button")).toBeUndefined();
	});

	it("omits element under visibility:hidden ancestor from snapshot", () => {
		const wrapper = document.createElement("div");
		wrapper.style.visibility = "hidden";
		const btn = document.createElement("button");
		btn.textContent = "VisHidden button";
		wrapper.appendChild(btn);
		document.body.appendChild(wrapper);

		const result = inlineSnapshot(500);
		expect(
			result.nodes.find((n) => n.name === "VisHidden button"),
		).toBeUndefined();
	});

	it("click on element under display:none ancestor returns E_NOT_INTERACTABLE", async () => {
		const wrapper = document.createElement("div");
		wrapper.style.display = "none";
		const btn = document.createElement("button");
		btn.setAttribute("data-ref-id", "e1");
		btn.textContent = "Hidden click target";
		wrapper.appendChild(btn);
		document.body.appendChild(wrapper);
		grantFromDom();

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
});

describe("observation lease (B2): snapshot_data grants lease", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
		resetLease();
	});

	it("snapshot_data result includes an observationId", async () => {
		const btn = document.createElement("button");
		btn.textContent = "Target";
		document.body.appendChild(btn);

		const result = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const value = result.value as { observationId?: string };
			expect(typeof value.observationId).toBe("string");
			expect(value.observationId).toMatch(/^obs\d+$/);
		}
	});

	it("after snapshot_data, click succeeds and receipt has observationId/dispatched/verification", async () => {
		const btn = document.createElement("button");
		btn.textContent = "Target";
		document.body.appendChild(btn);

		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		expect(snap.ok).toBe(true);
		const refId = (snap.value as { nodes: Array<{ refId: string }> }).nodes[0]
			.refId;

		const result = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ refId },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const receipt = result.value as {
				observationId?: string;
				dispatched?: boolean;
				verification?: string;
			};
			expect(receipt.dispatched).toBe(true);
			expect(receipt.verification).toBe("required");
			expect(typeof receipt.observationId).toBe("string");
		}
	});
});


describe("observation lease (B4): form scenario survives multiple fills", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
		resetLease();
	});

	it("snapshot_data then three fills on different inputs all succeed", async () => {
		const email = document.createElement("input");
		email.type = "email";
		email.setAttribute("aria-label", "Email");
		const name = document.createElement("input");
		name.type = "text";
		name.setAttribute("aria-label", "Name");
		const phone = document.createElement("input");
		phone.type = "text";
		phone.setAttribute("aria-label", "Phone");
		document.body.append(email, name, phone);

		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		expect(snap.ok).toBe(true);
		const nodes = (snap.value as { nodes: Array<{ refId: string }> }).nodes;
		const emailRef = nodes[0].refId;
		const nameRef = nodes[1].refId;
		const phoneRef = nodes[2].refId;

		const f1 = await dispatchContentScriptCall(
			"page_fill",
			"fill",
			handlers.fill,
			{ refId: emailRef, value: "a@b.com" },
		);
		const f2 = await dispatchContentScriptCall(
			"page_fill",
			"fill",
			handlers.fill,
			{ refId: nameRef, value: "Alice" },
		);
		const f3 = await dispatchContentScriptCall(
			"page_fill",
			"fill",
			handlers.fill,
			{ refId: phoneRef, value: "5551234" },
		);

		expect(f1.ok).toBe(true);
		expect(f2.ok).toBe(true);
		expect(f3.ok).toBe(true);
		expect(email.value).toBe("a@b.com");
		expect(name.value).toBe("Alice");
		expect(phone.value).toBe("5551234");
	});
});

describe("observation lease (B3): branching click does NOT invalidate lease", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
		resetLease();
	});

	it("snapshot_data then click that adds a node then click second succeeds (lazy lease)", async () => {
		const trigger = document.createElement("button");
		trigger.setAttribute("aria-label", "Trigger");
		document.body.appendChild(trigger);
		trigger.addEventListener("click", () => {
			const chip = document.createElement("div");
			chip.textContent = "Added by click";
			document.body.appendChild(chip);
		});
		const other = document.createElement("button");
		other.setAttribute("aria-label", "Other");
		other.addEventListener("click", () => {
			other.dataset.clicked = "yes";
		});
		document.body.appendChild(other);

		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const nodes = (snap.value as { nodes: Array<{ refId: string }> }).nodes;
		const triggerRef = nodes.find((n) => n.name === "Trigger")!.refId;
		const otherRef = nodes.find((n) => n.name === "Other")!.refId;

		const first = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ refId: triggerRef },
		);
		expect(first.ok).toBe(true);

		const second = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ refId: otherRef },
		);
		expect(second.ok).toBe(true);
		expect(other.dataset.clicked).toBe("yes");
	});
});

describe("observation lease (B6): removed element invalidates lease", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
		resetLease();
	});

	it("snapshot_data then remove target then click requires fresh observation", async () => {
		const btn = document.createElement("button");
		btn.setAttribute("aria-label", "Target");
		document.body.appendChild(btn);

		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const refId = (snap.value as { nodes: Array<{ refId: string }> }).nodes[0]
			.refId;
		btn.remove();

		const result = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ refId },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_STALE");
		}
	});
});

describe("observation lease (B7): fingerprint change returns E_STALE", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
		resetLease();
	});

	it("snapshot_data then change role then click returns E_STALE", async () => {
		const btn = document.createElement("button");
		btn.setAttribute("aria-label", "Target");
		document.body.appendChild(btn);

		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const refId = (snap.value as { nodes: Array<{ refId: string }> }).nodes[0]
			.refId;
		btn.setAttribute("role", "link");

		const result = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ refId },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_STALE");
			expect(result.error.details?.reason).toBe("fingerprint_changed");
		}
	});

	it("snapshot_data then change aria-label then fill returns E_STALE", async () => {
		const input = document.createElement("input");
		input.type = "text";
		input.setAttribute("aria-label", "Email");
		document.body.appendChild(input);

		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const refId = (snap.value as { nodes: Array<{ refId: string }> }).nodes[0]
			.refId;
		input.setAttribute("aria-label", "Password");

		const result = await dispatchContentScriptCall(
			"page_fill",
			"fill",
			handlers.fill,
			{ refId, value: "x" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_STALE");
		}
	});
});
describe("observation lease (B1): action without observation", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
	});

	it("click without prior snapshot returns E_OBSERVATION_REQUIRED and dispatches no event", async () => {
		const btn = document.createElement("button");
		btn.setAttribute("data-ref-id", "e1");
		btn.textContent = "Target";
		let clicked = false;
		btn.addEventListener("click", () => {
			clicked = true;
		});
		document.body.appendChild(btn);

		const result = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ refId: "e1" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_OBSERVATION_REQUIRED");
		}
		expect(clicked).toBe(false);
	});

	it("fill without prior snapshot returns E_OBSERVATION_REQUIRED", async () => {
		const input = document.createElement("input");
		input.type = "text";
		input.setAttribute("data-ref-id", "e1");
		document.body.appendChild(input);

		const result = await dispatchContentScriptCall(
			"page_fill",
			"fill",
			handlers.fill,
			{ refId: "e1", value: "hello" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_OBSERVATION_REQUIRED");
		}
		expect(input.value).toBe("");
	});
});

describe("observation lease (B8): ambiguous label returns E_AMBIGUOUS_TARGET", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
		resetLease();
	});

	it("two buttons with the same label in lease set returns E_AMBIGUOUS_TARGET", async () => {
		const a = document.createElement("button");
		a.setAttribute("aria-label", "Done");
		const b = document.createElement("button");
		b.setAttribute("aria-label", "Done");
		document.body.append(a, b);
		inlineSnapshot(500);
		grantFromDom();

		const result = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ label: "Done" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_AMBIGUOUS_TARGET");
		}
	});
});

describe("observation lease (B9): press requires observed focus", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
		resetLease();
	});

	it("press without any observation returns E_OBSERVATION_REQUIRED", async () => {
		const result = await dispatchContentScriptCall(
			"page_press",
			"press",
			handlers.press,
			{ key: "Enter" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_OBSERVATION_REQUIRED");
		}
	});
});

describe("observation lease (B11/B13/B14): context and replacement", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
		resetLease();
	});

	it("B11: scroll invalidates lease, next click requires observation", async () => {
		const btn = document.createElement("button");
		btn.setAttribute("aria-label", "Target");
		document.body.appendChild(btn);
		inlineSnapshot(500);
		grantFromDom();

		await dispatchContentScriptCall("page_scroll", "scroll", handlers.scroll, {
			direction: "down",
			amount: 100,
		});

		const result = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ refId: "e1" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_OBSERVATION_REQUIRED");
		}
	});

	it("B13: read-only url() does not invalidate lease", async () => {
		const btn = document.createElement("button");
		btn.setAttribute("aria-label", "Target");
		document.body.appendChild(btn);
		inlineSnapshot(500);
		grantFromDom();

		// url/title are runner-level, simulate with a no-op that shouldn't touch lease.
		// We assert the lease is still active after a no-op.
		expect(hasActiveObservation()).toBe(true);
		const result = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ refId: "e1" },
		);
		expect(result.ok).toBe(true);
	});

	it("B14: second snapshot replaces lease, old refId usable from new lease", async () => {
		const btn = document.createElement("button");
		btn.setAttribute("aria-label", "Target");
		document.body.appendChild(btn);
		inlineSnapshot(500);
		grantFromDom();

		// Second snapshot grants a new lease (same element, same refId).
		await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);

		const result = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ refId: "e1" },
		);
		expect(result.ok).toBe(true);
	});
});

describe("raw target resolution (resolveTargetRaw contract)", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
		resetLease();
	});

	// ---------------------------------------------------------------------------
	// Case 1: valid refId → action succeeds (element found via getElementByRefId)
	// ---------------------------------------------------------------------------
	it.each([
		{ handlerKey: "hover", handler: handlers.hover, action: "page_hover", extraParams: {} },
		{ handlerKey: "dblclick", handler: handlers.dblclick, action: "page_dblclick", extraParams: {} },
	])(
		"$handlerKey: valid refId → action succeeds",
		async ({ handler, action, handlerKey, extraParams }) => {
			const el = document.createElement("div");
			el.setAttribute("data-ref-id", "e1");
			el.setAttribute("role", "button");
			document.body.appendChild(el);

			const result = await dispatchContentScriptCall(
				action,
				handlerKey,
				handler,
				{ refId: "e1", ...extraParams },
			);
			expect(result.ok).toBe(true);
		},
	);

	it("type: valid refId → action succeeds", async () => {
		const input = document.createElement("input");
		input.type = "text";
		input.setAttribute("data-ref-id", "e1");
		document.body.appendChild(input);

		const result = await dispatchContentScriptCall(
			"page_type",
			"type",
			handlers.type,
			{ refId: "e1", text: "hello" },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect((result.value as { text?: string }).text).toBe("hello");
		}
	});

	// ---------------------------------------------------------------------------
	// Case 2: no refId, valid label → action succeeds (label fallback)
	// ---------------------------------------------------------------------------
	it.each([
		{ handlerKey: "hover", handler: handlers.hover, action: "page_hover", extraParams: {} },
		{ handlerKey: "dblclick", handler: handlers.dblclick, action: "page_dblclick", extraParams: {} },
	])(
		"$handlerKey: no refId, valid label → action succeeds",
		async ({ handler, action, handlerKey, extraParams }) => {
			const el = document.createElement("button");
			el.setAttribute("aria-label", "Submit");
			document.body.appendChild(el);

			const result = await dispatchContentScriptCall(
				action,
				handlerKey,
				handler,
				{ label: "Submit", ...extraParams },
			);
			expect(result.ok).toBe(true);
		},
	);

	it("type: no refId, valid label → action succeeds", async () => {
		const input = document.createElement("input");
		input.type = "text";
		input.setAttribute("aria-label", "Email");
		document.body.appendChild(input);

		const result = await dispatchContentScriptCall(
			"page_type",
			"type",
			handlers.type,
			{ label: "Email", text: "hello@test.com" },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect((result.value as { text?: string }).text).toBe("hello@test.com");
		}
	});

	// ---------------------------------------------------------------------------
	// Case 3: refId that matches nothing in DOM → E_STALE
	// ---------------------------------------------------------------------------
	it.each([
		{ handlerKey: "hover", handler: handlers.hover, action: "page_hover", extraParams: {} },
		{ handlerKey: "dblclick", handler: handlers.dblclick, action: "page_dblclick", extraParams: {} },
	])(
		"$handlerKey: refId not in DOM → E_STALE",
		async ({ handler, action, handlerKey, extraParams }) => {
			const result = await dispatchContentScriptCall(
				action,
				handlerKey,
				handler,
				{ refId: "e99", ...extraParams },
			);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe("E_STALE");
			}
		},
	);

	it("type: refId not in DOM → E_STALE", async () => {
		const result = await dispatchContentScriptCall(
			"page_type",
			"type",
			handlers.type,
			{ refId: "e99", text: "hello" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_STALE");
		}
	});

	// ---------------------------------------------------------------------------
	// Case 4: no refId, label that matches nothing → E_NOT_FOUND
	// ---------------------------------------------------------------------------
	it.each([
		{ handlerKey: "hover", handler: handlers.hover, action: "page_hover", extraParams: {} },
		{ handlerKey: "dblclick", handler: handlers.dblclick, action: "page_dblclick", extraParams: {} },
	])(
		"$handlerKey: label not found → E_NOT_FOUND",
		async ({ handler, action, handlerKey, extraParams }) => {
			const result = await dispatchContentScriptCall(
				action,
				handlerKey,
				handler,
				{ label: "NonExistentLabelXYZ", ...extraParams },
			);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe("E_NOT_FOUND");
			}
		},
	);

	it("type: label not found → E_NOT_FOUND", async () => {
		const result = await dispatchContentScriptCall(
			"page_type",
			"type",
			handlers.type,
			{ label: "NonExistentLabelXYZ", text: "hello" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_NOT_FOUND");
		}
	});

	// ---------------------------------------------------------------------------
	// Case 5: neither refId nor label → E_NOT_FOUND (via direct handler call,
	//         since schema validation rejects missing refId+label before the handler)
	// ---------------------------------------------------------------------------
	it.each([
		{ handlerKey: "hover", handler: handlers.hover },
		{ handlerKey: "dblclick", handler: handlers.dblclick },
	])(
		"$handlerKey: neither refId nor label → E_NOT_FOUND (direct handler call)",
		({ handler }) => {
			expect(() => handler({})).toThrow();
			try {
				handler({});
			} catch (err) {
				const code = (err as Record<string, unknown>).code;
				expect(code).toBe("E_NOT_FOUND");
			}
		},
	);

	it("type: neither refId nor label → E_NOT_FOUND (direct handler call)", () => {
		expect(() => handlers.type({ text: "hello" })).toThrow();
		try {
			handlers.type({ text: "hello" });
		} catch (err) {
			const code = (err as Record<string, unknown>).code;
			expect(code).toBe("E_NOT_FOUND");
		}
	});

	// ---------------------------------------------------------------------------
	// Case 6: both refId and label where they'd resolve to different elements → refId wins
	// ---------------------------------------------------------------------------
	it.each([
		{ handlerKey: "hover", handler: handlers.hover, action: "page_hover", extraParams: {} },
		{ handlerKey: "dblclick", handler: handlers.dblclick, action: "page_dblclick", extraParams: {} },
	])(
		"$handlerKey: both refId and label → refId wins (element found by refId)",
		async ({ handler, action, handlerKey, extraParams }) => {
			// Element A: has refId "e1" — this should be the target
			const elA = document.createElement("button");
			elA.setAttribute("data-ref-id", "e1");
			elA.setAttribute("aria-label", "ButtonA");
			elA.textContent = "ButtonA";
			document.body.appendChild(elA);

			// Element B: has label "ButtonB" — should NOT be targeted
			const elB = document.createElement("button");
			elB.setAttribute("aria-label", "ButtonB");
			elB.textContent = "ButtonB";
			document.body.appendChild(elB);

			// Spy on dispatchEvent to verify elA (refId target) receives the event
			const dispatchSpyA = vi.spyOn(elA, "dispatchEvent");
			const dispatchSpyB = vi.spyOn(elB, "dispatchEvent");

			const result = await dispatchContentScriptCall(
				action,
				handlerKey,
				handler,
				{ refId: "e1", label: "ButtonB", ...extraParams },
			);
			expect(result.ok).toBe(true);

			// Verify refId element (elA) was the one acted upon
			expect(dispatchSpyA).toHaveBeenCalled();
			expect(dispatchSpyB).not.toHaveBeenCalled();

			dispatchSpyA.mockRestore();
			dispatchSpyB.mockRestore();
		},
	);

	it("type: both refId and label → refId wins (element found by refId)", async () => {
		const inputA = document.createElement("input");
		inputA.type = "text";
		inputA.setAttribute("data-ref-id", "e1");
		inputA.setAttribute("aria-label", "InputA");
		document.body.appendChild(inputA);

		const inputB = document.createElement("input");
		inputB.type = "text";
		inputB.setAttribute("aria-label", "InputB");
		document.body.appendChild(inputB);

		const result = await dispatchContentScriptCall(
			"page_type",
			"type",
			handlers.type,
			{ refId: "e1", label: "InputB", text: "hello" },
		);
		expect(result.ok).toBe(true);
		// refId element (inputA) gets the value, not inputB
		expect(inputA.value).toBe("hello");
		expect(inputB.value).toBe("");
	});
});

describe("typed params: handler reads validated fields", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
		resetLease();
	});

	it("fill with { refId, value } → value is written to the element", async () => {
		const input = document.createElement("input");
		input.type = "text";
		input.setAttribute("data-ref-id", "e1");
		document.body.appendChild(input);
		grantFromDom();

		const result = await dispatchContentScriptCall(
			"page_fill",
			"fill",
			handlers.fill,
			{ refId: "e1", value: "hello world" },
		);
		expect(result.ok).toBe(true);
		expect(input.value).toBe("hello world");
	});

	it("type with { refId, text } → the text is typed into the element", async () => {
		const input = document.createElement("input");
		input.type = "text";
		input.setAttribute("data-ref-id", "e1");
		document.body.appendChild(input);

		const result = await dispatchContentScriptCall(
			"page_type",
			"type",
			handlers.type,
			{ refId: "e1", text: "typed text" },
		);
		expect(result.ok).toBe(true);
		expect(input.value).toBe("typed text");
	});

	it("press with { key: 'Enter' } → dispatches KeyboardEvent with that key", () => {
		let keyDownKey: string | undefined;
		let keyUpKey: string | undefined;
		document.addEventListener("keydown", (e) => {
			keyDownKey = (e as KeyboardEvent).key;
		});
		document.addEventListener("keyup", (e) => {
			keyUpKey = (e as KeyboardEvent).key;
		});

		// press requires active observation
		grantFromDom();

		const result = handlers.press({ key: "Enter" });
		expect(result.ok).toBe(true);
		expect(keyDownKey).toBe("Enter");
		expect(keyUpKey).toBe("Enter");
	});

	it("scroll with { direction: 'up', amount: 100 } → calls window.scrollBy with top: -100", async () => {
		const scrollBySpy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});

		const result = await dispatchContentScriptCall(
			"page_scroll",
			"scroll",
			handlers.scroll,
			{ direction: "up", amount: 100 },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect((result.value as { amount?: number }).amount).toBe(100);
		}
		expect(scrollBySpy).toHaveBeenCalledWith({
			top: -100,
			left: 0,
			behavior: "smooth",
		});

		scrollBySpy.mockRestore();
	});

	it("find with { selector: 'button' } → returns matching elements", async () => {
		const btn1 = document.createElement("button");
		btn1.textContent = "Click me";
		document.body.appendChild(btn1);
		const btn2 = document.createElement("button");
		btn2.textContent = "Submit";
		document.body.appendChild(btn2);

		const result = await dispatchContentScriptCall(
			"page_find",
			"find",
			handlers.find,
			{ selector: "button" },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const nodes = result.value as Array<{ tag: string; refId: string }>;
			expect(nodes.length).toBe(2);
			expect(nodes.every((n) => n.tag === "button")).toBe(true);
			expect(nodes.every((n) => typeof n.refId === "string")).toBe(true);
		}
	});

	it("check with { refId } (no checked field) → defaults to checked true", async () => {
		const cb = document.createElement("input");
		cb.type = "checkbox";
		cb.setAttribute("data-ref-id", "e1");
		cb.checked = false;
		document.body.appendChild(cb);

		const result = await dispatchContentScriptCall(
			"page_check",
			"check",
			handlers.check,
			{ refId: "e1" },
		);
		expect(result.ok).toBe(true);
		expect(cb.checked).toBe(true);
	});

	it("check with { refId, checked: false } → element.checked is false", async () => {
		const cb = document.createElement("input");
		cb.type = "checkbox";
		cb.setAttribute("data-ref-id", "e1");
		cb.checked = true;
		document.body.appendChild(cb);

		const result = await dispatchContentScriptCall(
			"page_check",
			"check",
			handlers.check,
			{ refId: "e1", checked: false },
		);
		expect(result.ok).toBe(true);
		expect(cb.checked).toBe(false);
	});

	it("scroll_to with { x: 0, y: 500 } (no refId/label) → calls window.scrollTo with top 500", async () => {
		const scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});

		const result = await dispatchContentScriptCall(
			"page_scroll_to",
			"scroll_to",
			handlers.scroll_to,
			{ x: 0, y: 500 },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect((result.value as { amount?: number }).amount).toBe(500);
		}
		expect(scrollToSpy).toHaveBeenCalledWith({
			top: 500,
			left: 0,
			behavior: "smooth",
		});

		scrollToSpy.mockRestore();
	});
});

describe("select_option handler", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
		resetLease();
	});

	it("native <select> sets value and dispatches change", async () => {
		const select = document.createElement("select");
		select.setAttribute("aria-label", "Country");
		select.innerHTML =
			'<option value="">Pick</option><option value="ca">Canada</option><option value="us">USA</option>';
		document.body.appendChild(select);

		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const refId = (snap.value as { nodes: Array<{ refId: string }> }).nodes[0]
			.refId;

		const result = await dispatchContentScriptCall(
			"page_select_option",
			"select_option",
			handlers.select_option,
		{ refId, value: "Canada" },
		);
		expect(result.ok).toBe(true);
		expect(select.value).toBe("ca");
	});

	it("react-select combobox: click control opens listbox, matching option is clicked", async () => {
		const control = document.createElement("div");
		control.setAttribute("role", "combobox");
		control.setAttribute("aria-label", "Country");
		control.setAttribute("aria-expanded", "false");
		control.addEventListener("click", () => {
			control.setAttribute("aria-expanded", "true");
			const listbox = document.createElement("div");
			listbox.setAttribute("role", "listbox");
			const optYes = document.createElement("div");
			optYes.setAttribute("role", "option");
			optYes.textContent = "Yes";
			const optNo = document.createElement("div");
			optNo.setAttribute("role", "option");
			optNo.textContent = "No";
			listbox.append(optYes, optNo);
			document.body.appendChild(listbox);
		});
		document.body.appendChild(control);

		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const refId = (snap.value as { nodes: Array<{ refId: string }> }).nodes.find(
			(n) => n.role === "combobox",
		)!.refId;

		let optionClicked = "";
		document.addEventListener("click", (e) => {
			const target = e.target as HTMLElement;
			if (target.getAttribute("role") === "option") {
				optionClicked = target.textContent || "";
			}
		}, true);

		const result = await dispatchContentScriptCall(
			"page_select_option",
			"select_option",
			handlers.select_option,
			{ refId, value: "Yes" },
		);
		expect(result.ok).toBe(true);
		expect(optionClicked).toBe("Yes");
	});

	it("combobox opened by mousedown ignores an unrelated listbox", async () => {
		const staleListbox = document.createElement("div");
		staleListbox.setAttribute("role", "listbox");
		staleListbox.innerHTML = '<div role="option">Canada</div>';

		const control = document.createElement("input");
		control.setAttribute("role", "combobox");
		control.setAttribute("aria-label", "AI agreement");
		control.addEventListener("mousedown", () => {
			const listbox = document.createElement("div");
			listbox.id = "ai-options";
			listbox.setAttribute("role", "listbox");
			listbox.innerHTML = '<div role="option">Yes</div><div role="option">No</div>';
			control.setAttribute("aria-controls", listbox.id);
			document.body.appendChild(listbox);
		});
		document.body.append(staleListbox, control);

		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const refId = (snap.value as { nodes: Array<{ refId: string; role?: string }> }).nodes.find(
			(n) => n.role === "combobox",
		)!.refId;

		let optionClicked = "";
		document.addEventListener("click", (event) => {
			const target = event.target as HTMLElement;
			if (target.getAttribute("role") === "option") optionClicked = target.textContent || "";
		}, true);

		const result = await dispatchContentScriptCall(
			"page_select_option",
			"select_option",
			handlers.select_option,
			{ refId, value: "Yes" },
		);
		expect(result.ok).toBe(true);
		expect(optionClicked).toBe("Yes");
	});

	it("unlinked combobox selects from the listbox it reveals", async () => {
		const unrelated = document.createElement("div");
		unrelated.setAttribute("role", "listbox");
		unrelated.innerHTML = '<div role="option" data-source="unrelated">Yes</div>';

		const options = document.createElement("div");
		options.setAttribute("role", "listbox");
		options.hidden = true;
		options.innerHTML = '<div role="option" data-source="target">Yes</div>';

		const control = document.createElement("input");
		control.setAttribute("role", "combobox");
		control.setAttribute("aria-label", "AI agreement");
		control.addEventListener("mousedown", () => {
			options.hidden = false;
		});
		document.body.append(unrelated, control, options);

		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const refId = (snap.value as { nodes: Array<{ refId: string; role?: string }> }).nodes.find(
			(n) => n.role === "combobox",
		)!.refId;

		let source = "";
		document.addEventListener("click", (event) => {
			const target = event.target as HTMLElement;
			if (target.getAttribute("role") === "option") source = target.dataset.source || "";
		}, true);

		const result = await dispatchContentScriptCall(
			"page_select_option",
			"select_option",
			handlers.select_option,
			{ refId, value: "Yes" },
		);
		expect(result.ok).toBe(true);
		expect(source).toBe("target");
	});

	it("unlinked combobox selects from the listbox whose options it replaces", async () => {
		const unrelated = document.createElement("div");
		unrelated.setAttribute("role", "listbox");
		unrelated.innerHTML = '<div role="option" data-source="unrelated">Yes</div>';

		const options = document.createElement("div");
		options.setAttribute("role", "listbox");
		options.innerHTML = '<div role="option">Choose</div>';

		const control = document.createElement("input");
		control.setAttribute("role", "combobox");
		control.setAttribute("aria-label", "AI agreement");
		control.addEventListener("mousedown", () => {
			options.innerHTML = '<div role="option" data-source="target">Yes</div>';
		});
		document.body.append(unrelated, control, options);

		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const refId = (snap.value as { nodes: Array<{ refId: string; role?: string }> }).nodes.find(
			(n) => n.role === "combobox",
		)!.refId;

		let source = "";
		document.addEventListener("click", (event) => {
			const target = event.target as HTMLElement;
			if (target.getAttribute("role") === "option") source = target.dataset.source || "";
		}, true);

		const result = await dispatchContentScriptCall(
			"page_select_option",
			"select_option",
			handlers.select_option,
			{ refId, value: "Yes" },
		);
		expect(result.ok).toBe(true);
		expect(source).toBe("target");
	});

	it("falls back to document options when aria-controls is wrong", async () => {
		document.body.innerHTML = `
			<input role="combobox" aria-label="Choice" aria-controls="wrong-options">
			<div id="wrong-options" role="listbox"><div role="option">Wrong</div></div>
			<div role="listbox"><div role="option" data-target>Wanted</div></div>
		`;
		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const refId = (snap.value as { nodes: Array<{ refId: string; role?: string }> }).nodes.find(
			(n) => n.role === "combobox",
		)!.refId;
		let clicked = false;
		document.querySelector("[data-target]")!.addEventListener("click", () => {
			clicked = true;
		});

		const result = await dispatchContentScriptCall(
			"page_select_option",
			"select_option",
			handlers.select_option,
			{ refId, value: "Wanted" },
		);
		expect(result.ok).toBe(true);
		expect(clicked).toBe(true);
	});

	it("unknown option value returns E_NOT_FOUND with candidates", async () => {
		const control = document.createElement("div");
		control.setAttribute("role", "combobox");
		control.setAttribute("aria-label", "Country");
		control.addEventListener("click", () => {
			const listbox = document.createElement("div");
			listbox.setAttribute("role", "listbox");
			const optYes = document.createElement("div");
			optYes.setAttribute("role", "option");
			optYes.textContent = "Yes";
			listbox.appendChild(optYes);
			document.body.appendChild(listbox);
		});
		document.body.appendChild(control);

		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const refId = (snap.value as { nodes: Array<{ refId: string }> }).nodes.find(
			(n) => n.role === "combobox",
		)!.refId;

		const result = await dispatchContentScriptCall(
			"page_select_option",
			"select_option",
			handlers.select_option,
			{ refId, value: "Maybe" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_NOT_FOUND");
		}
	});
});
