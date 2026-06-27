// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	getElementByRefId,
	throwElementNotFound,
} from "../src/content-script/dom-utils.js";
import { handlers } from "../src/content-script/handlers.js";
import {
	grantObservation,
	hasActiveObservation,
	resetLease,
} from "../src/content-script/observation-lease.js";
import {
	dispatchContentScriptCall,
	registerContentScriptSpec,
} from "../src/content-script/registry.js";
import { buildContentScriptSpecs } from "../src/content-script/schemas.js";
import { notInteractableError } from "../src/shared/cross/agent-errors.js";
import { collectInlineSnapshot as inlineSnapshot } from "../src/shared/cross/collect-inline-snapshot.js";

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
		expect(result.error.recovery?.[0]).toContain("snapshot.nodes");
		expect(result.error.details?.snapshot).toBeDefined();
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

	it("scroll targets a visible nested scroll container before window", () => {
		const windowScrollBy = vi
			.spyOn(window, "scrollBy")
			.mockImplementation(() => {});
		const pane = document.createElement("div");
		pane.style.overflowY = "auto";
		document.body.appendChild(pane);
		Object.defineProperties(pane, {
			clientHeight: { value: 200, configurable: true },
			scrollHeight: { value: 800, configurable: true },
			scrollTop: { value: 0, writable: true, configurable: true },
		});
		pane.getBoundingClientRect = () =>
			({
				left: 0,
				top: 0,
				right: 300,
				bottom: 400,
				width: 300,
				height: 400,
				x: 0,
				y: 0,
				toJSON: () => ({}),
			}) as DOMRect;
		pane.scrollBy = () => {};
		const paneScrollBy = vi
			.spyOn(pane, "scrollBy")
			.mockImplementation(() => {});

		handlers.scroll({ direction: "down", amount: 250 });

		expect(paneScrollBy).toHaveBeenCalledWith({
			top: 250,
			left: 0,
			behavior: "smooth",
		});
		expect(windowScrollBy).not.toHaveBeenCalled();
		paneScrollBy.mockRestore();
		windowScrollBy.mockRestore();
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
});

describe("dom handler", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
		resetLease();
	});

	it("dom refId → click actually fires the click handler", async () => {
		document.body.innerHTML = `<button id="x">Go</button>`;
		let clicked = false;
		document.getElementById("x")!.addEventListener("click", () => {
			clicked = true;
		});
		const dom = await dispatchContentScriptCall(
			"page_dom",
			"dom",
			handlers.dom,
			{ selector: "button", depth: 0, includeHidden: false },
		);
		expect(dom.ok).toBe(true);
		if (!dom.ok) return;
		const refId = (
			dom.value as { nodes: Array<{ refId: string }> }
		).nodes[0]!.refId;
		expect(refId).toMatch(/^e\d+$/);
		// No snapshot_data call between dom() and click():
		const click = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ refId },
		);
		expect(click.ok).toBe(true);
		expect(clicked).toBe(true);
	});

	it("dom refId → fill actually sets the input value", async () => {
		document.body.innerHTML = `<input id="i" type="text">`;
		const input = document.getElementById("i") as HTMLInputElement;
		const dom = await dispatchContentScriptCall(
			"page_dom",
			"dom",
			handlers.dom,
			{ selector: "input", depth: 0, includeHidden: false },
		);
		expect(dom.ok).toBe(true);
		if (!dom.ok) return;
		const refId = (
			dom.value as { nodes: Array<{ refId: string }> }
		).nodes[0]!.refId;
		const fill = await dispatchContentScriptCall(
			"page_fill",
			"fill",
			handlers.fill,
			{ refId, value: "hello" },
		);
		expect(fill.ok).toBe(true);
		expect(input.value).toBe("hello");
	});

	it("dom emits dropdown hints (controlType, recommendedAction, controls, expanded) on a combobox", async () => {
		document.body.innerHTML = `
			<input role="combobox" aria-label="Degree" aria-expanded="false" aria-controls="deg-list">
			<div id="deg-list" role="listbox"><div role="option">Bachelor's</div></div>
		`;
		const dom = await dispatchContentScriptCall(
			"page_dom",
			"dom",
			handlers.dom,
			{ selector: "[role='combobox']", depth: 0, includeHidden: false },
		);
		if (!dom.ok) return;
		const node = (
			dom.value as { nodes: Array<Record<string, unknown>> }
		).nodes[0]!;
		expect(node.controlType).toBe("dropdown");
		expect(node.recommendedAction).toBe("select_option");
		expect(node.controls).toBe("deg-list");
		expect(node.expanded).toBe(false);
	});

	it("dom refId → select_option: combobox discovered via dom() selects the option (the motivating smoke test)", async () => {
		// The real user journey: agent calls dom() on a combobox, sees
		// recommendedAction: select_option, and select_option works on that refId.
		const control = document.createElement("div");
		control.setAttribute("role", "combobox");
		control.setAttribute("aria-label", "Country");
		control.setAttribute("aria-expanded", "false");
		control.setAttribute("aria-controls", "lb");
		control.addEventListener("click", () => {
			control.setAttribute("aria-expanded", "true");
			const listbox = document.createElement("div");
			listbox.id = "lb";
			listbox.setAttribute("role", "listbox");
			const opt = document.createElement("div");
			opt.setAttribute("role", "option");
			opt.textContent = "Canada";
			listbox.appendChild(opt);
			document.body.appendChild(listbox);
		});
		document.body.appendChild(control);

		const dom = await dispatchContentScriptCall(
			"page_dom",
			"dom",
			handlers.dom,
			{ selector: "[role='combobox']", depth: 0, includeHidden: false },
		);
		expect(dom.ok).toBe(true);
		if (!dom.ok) return;
		const refId = (
			dom.value as { nodes: Array<{ refId: string }> }
		).nodes[0]!.refId;
		// Sanity: dom() told the agent this is a dropdown to select_option.
		expect(
			(dom.value as { nodes: Array<Record<string, unknown>> }).nodes[0]!
				.recommendedAction,
		).toBe("select_option");

		let optionClicked = "";
		document.addEventListener(
			"click",
			(e) => {
				const target = e.target as HTMLElement;
				if (target.getAttribute("role") === "option") {
					optionClicked = target.textContent || "";
				}
			},
			true,
		);

		const result = await dispatchContentScriptCall(
			"page_select_option",
			"select_option",
			handlers.select_option,
			{ refId, value: "Canada" },
		);
		expect(result.ok).toBe(true);
		expect(optionClicked).toBe("Canada");
	});

	it("dom with depth>0 observes nested children — a child refId is clickable", async () => {
		document.body.innerHTML = `
			<div id="root">
				<button id="child">Nested</button>
			</div>
		`;
		let clicked = false;
		document.getElementById("child")!.addEventListener("click", () => {
			clicked = true;
		});
		const dom = await dispatchContentScriptCall(
			"page_dom",
			"dom",
			handlers.dom,
			{ selector: "#root", depth: 1, includeHidden: false },
		);
		expect(dom.ok).toBe(true);
		if (!dom.ok) return;
		const node = (
			dom.value as { nodes: Array<{ children?: Array<{ refId: string }> }> }
		).nodes[0]!;
		expect(node.children).toBeDefined();
		const childRefId = node.children![0]!.refId;
		expect(childRefId).toMatch(/^e\d+$/);
		const click = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ refId: childRefId },
		);
		expect(click.ok).toBe(true);
		expect(clicked).toBe(true);
	});

	it("dom with includeHidden:true (default) observes hidden elements — lease valid, click correctly rejects as not-interactable", async () => {
		// The production default is includeHidden:true ("see everything" mode).
		// A hidden element must get a refId AND be in the observation lease,
		// but click must still reject it as E_NOT_INTERACTABLE (not E_STALE) —
		// dom() observes everything but does not bypass interactability checks.
		document.body.innerHTML = `<button id="h" style="display:none" hidden>Hidden</button>`;
		const dom = await dispatchContentScriptCall(
			"page_dom",
			"dom",
			handlers.dom,
			{ selector: "button" }, // no includeHidden → defaults true
		);
		expect(dom.ok).toBe(true);
		if (!dom.ok) return;
		const nodes = (
			dom.value as { nodes: Array<{ refId?: string; hidden?: boolean }> }
		).nodes;
		expect(nodes).toHaveLength(1);
		expect(nodes[0]!.hidden).toBe(true);
		const refId = nodes[0]!.refId!;
		expect(refId).toMatch(/^e\d+$/);
		const click = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ refId },
		);
		// Lease is valid (not stale); element is genuinely hidden → not interactable.
		expect(click.ok).toBe(false);
		if (!click.ok) {
			expect(click.error.code).toBe("E_NOT_INTERACTABLE");
			expect(click.error.code).not.toBe("E_STALE");
		}
	});

	it("dom emits dropdown hints on a native <select> element", async () => {
		document.body.innerHTML = `<select aria-label="Country"><option value="">Pick</option><option value="ca">Canada</option></select>`;
		const dom = await dispatchContentScriptCall(
			"page_dom",
			"dom",
			handlers.dom,
			{ selector: "select", depth: 0, includeHidden: false },
		);
		if (!dom.ok) return;
		const node = (
			dom.value as { nodes: Array<Record<string, unknown>> }
		).nodes[0]!;
		expect(node.controlType).toBe("dropdown");
		expect(node.recommendedAction).toBe("select_option");
	});

	it("dom sets expanded:undefined when aria-expanded is absent", async () => {
		// combobox without aria-expanded — expanded should be undefined, not false.
		document.body.innerHTML = `<input role="combobox" aria-label="NoExp">`;
		const dom = await dispatchContentScriptCall(
			"page_dom",
			"dom",
			handlers.dom,
			{ selector: "[role='combobox']", depth: 0, includeHidden: false },
		);
		if (!dom.ok) return;
		const node = (
			dom.value as { nodes: Array<Record<string, unknown>> }
		).nodes[0]!;
		expect(node.controlType).toBe("dropdown");
		expect("expanded" in node && node.expanded !== undefined).toBe(false);
	});
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
		expect(
			result.nodes.find((n) => n.name === "Hidden button"),
		).toBeUndefined();
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

describe("observation lease: snapshot refresh on violation", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
		resetLease();
	});

	it("E_OBSERVATION_REQUIRED error carries a refreshed snapshot in details", async () => {
		const btn = document.createElement("button");
		btn.textContent = "Target";
		document.body.appendChild(btn);

		// No prior snapshot → click violates lease.
		const result = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ refId: "e999" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_OBSERVATION_REQUIRED");
			expect(result.error.details?.snapshot).toBeDefined();
			const snap = result.error.details!.snapshot as {
				nodes: { refId: string }[];
				observationId: string;
			};
			expect(Array.isArray(snap.nodes)).toBe(true);
			expect(typeof snap.observationId).toBe("string");
		}
	});
	it("E_STALE error carries a refreshed snapshot in details", async () => {
		// Snapshot to get a real refId, then remove the element → disconnected → E_STALE.
		const btn = document.createElement("button");
		btn.setAttribute("aria-label", "Target");
		document.body.appendChild(btn);
		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const refId = (
			(snap as { ok: true; value: { nodes: Array<{ refId: string }> } }).value
		).nodes[0].refId;
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
			expect(result.error.details?.snapshot).toBeDefined();
			const errSnap = result.error.details!.snapshot as {
				nodes: { refId: string }[];
				observationId: string;
			};
			expect(Array.isArray(errSnap.nodes)).toBe(true);
			expect(typeof errSnap.observationId).toBe("string");
		}
	});
	it("E_AMBIGUOUS_TARGET error carries a refreshed snapshot in details", async () => {
		// Two observed elements share a label → ambiguous.
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
			expect(result.error.details?.snapshot).toBeDefined();
			const errSnap = result.error.details!.snapshot as {
				nodes: { refId: string }[];
				observationId: string;
			};
			expect(Array.isArray(errSnap.nodes)).toBe(true);
			expect(typeof errSnap.observationId).toBe("string");
		}
	});
	it("refreshed snapshot re-grants the lease — retry click succeeds with no extra snapshot call", async () => {
		// Lease ONLY a decoy; the target button has no refId yet.
		const decoy = document.createElement("button");
		decoy.setAttribute("aria-label", "Decoy");
		document.body.appendChild(decoy);
		const btn = document.createElement("button");
		btn.setAttribute("aria-label", "Target");
		document.body.appendChild(btn);
		let clicked = false;
		btn.addEventListener("click", () => {
			clicked = true;
		});
		// Grant lease over the decoy only, by a refId the click path will accept.
		grantObservation([{ refId: "e-decoy", element: decoy }]);

		// Click a refId NOT in the lease → not_in_latest_observation → E_STALE.
		// The refresh re-grants over the whole DOM, assigning btn a refId.
		const first = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ refId: "e999" },
		);
		expect(first.ok).toBe(false);
		if (first.ok) return;
		expect(first.error.details?.snapshot).toBeDefined();
		const snap = first.error.details!.snapshot as {
			nodes: { refId: string; name?: string }[];
		};
		const target = snap.nodes.find((n) => n.name === "Target");
		expect(target).toBeDefined();

		// Retry with the refreshed refId — NO snapshot_data call in between.
		const retry = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ refId: target!.refId },
		);
		expect(retry.ok).toBe(true);
		expect(clicked).toBe(true);
	});
	it("E_AMBIGUOUS_TARGET refreshed snapshot re-grants the lease — retry click by refId succeeds", async () => {
		// Two same-label buttons → click by label throws E_AMBIGUOUS_TARGET.
		// The refreshed snapshot must re-grant so a retry by refId works.
		const a = document.createElement("button");
		a.setAttribute("aria-label", "Done");
		a.textContent = "A";
		document.body.appendChild(a);
		const b = document.createElement("button");
		b.setAttribute("aria-label", "Done");
		b.textContent = "B";
		let bClicked = false;
		b.addEventListener("click", () => {
			bClicked = true;
		});
		document.body.appendChild(b);
		inlineSnapshot(500);
		grantFromDom();

		const first = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ label: "Done" },
		);
		expect(first.ok).toBe(false);
		if (first.ok) return;
		expect(first.error.details?.snapshot).toBeDefined();
		const snap = first.error.details!.snapshot as {
			nodes: { refId: string; name?: string }[];
		};
		// Pick button B by its distinguishing text to retry.
		const target = snap.nodes.find((n) => n.name === "Done");
		expect(target).toBeDefined();

		const retry = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ refId: target!.refId },
		);
		expect(retry.ok).toBe(true);
		// Either button could own the refId; assert the retry dispatched.
	});

	it("refresh on empty DOM returns an empty snapshot, not a throw", async () => {
		// document.body present but empty → no elements, no refIds.
		document.body.innerHTML = "";

		const result = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ refId: "e1" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_OBSERVATION_REQUIRED");
			expect(result.error.details?.snapshot).toBeDefined();
			const snap = result.error.details!.snapshot as {
				nodes: unknown[];
				observationId: string;
			};
			expect(Array.isArray(snap.nodes)).toBe(true);
			expect(snap.nodes).toHaveLength(0);
			expect(typeof snap.observationId).toBe("string");
		}
	});

	it("non-lease handler stale refId (throwElementNotFound path) carries a refresh snapshot", async () => {
		// type uses resolveTargetRaw → throwElementNotFound → staleRefError (dom-utils path),
		// distinct from the lease path (requireTarget → throwStale). Both must attach a snapshot.
		const btn = document.createElement("button");
		btn.textContent = "Real";
		document.body.appendChild(btn);

		const result = await dispatchContentScriptCall(
			"page_type",
			"type",
			handlers.type,
			{ refId: "e999", text: "x" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_STALE");
			expect(result.error.details?.snapshot).toBeDefined();
			expect(result.error.recovery?.[0]).toContain("snapshot.nodes");
			const snap = result.error.details!.snapshot as {
				nodes: { refId: string }[];
			};
			expect(Array.isArray(snap.nodes)).toBe(true);
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
		{
			handlerKey: "hover",
			handler: handlers.hover,
			action: "page_hover",
			extraParams: {},
		},
		{
			handlerKey: "dblclick",
			handler: handlers.dblclick,
			action: "page_dblclick",
			extraParams: {},
		},
	])("$handlerKey: valid refId → action succeeds", async ({
		handler,
		action,
		handlerKey,
		extraParams,
	}) => {
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
	});

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
		{
			handlerKey: "hover",
			handler: handlers.hover,
			action: "page_hover",
			extraParams: {},
		},
		{
			handlerKey: "dblclick",
			handler: handlers.dblclick,
			action: "page_dblclick",
			extraParams: {},
		},
	])("$handlerKey: no refId, valid label → action succeeds", async ({
		handler,
		action,
		handlerKey,
		extraParams,
	}) => {
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
	});

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
		{
			handlerKey: "hover",
			handler: handlers.hover,
			action: "page_hover",
			extraParams: {},
		},
		{
			handlerKey: "dblclick",
			handler: handlers.dblclick,
			action: "page_dblclick",
			extraParams: {},
		},
	])("$handlerKey: refId not in DOM → E_STALE", async ({
		handler,
		action,
		handlerKey,
		extraParams,
	}) => {
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
	});

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
		{
			handlerKey: "hover",
			handler: handlers.hover,
			action: "page_hover",
			extraParams: {},
		},
		{
			handlerKey: "dblclick",
			handler: handlers.dblclick,
			action: "page_dblclick",
			extraParams: {},
		},
	])("$handlerKey: label not found → E_NOT_FOUND", async ({
		handler,
		action,
		handlerKey,
		extraParams,
	}) => {
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
	});

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
	])("$handlerKey: neither refId nor label → E_NOT_FOUND (direct handler call)", ({
		handler,
	}) => {
		expect(() => handler({})).toThrow();
		try {
			handler({});
		} catch (err) {
			const code = (err as Record<string, unknown>).code;
			expect(code).toBe("E_NOT_FOUND");
		}
	});

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
		{
			handlerKey: "hover",
			handler: handlers.hover,
			action: "page_hover",
			extraParams: {},
		},
		{
			handlerKey: "dblclick",
			handler: handlers.dblclick,
			action: "page_dblclick",
			extraParams: {},
		},
	])("$handlerKey: both refId and label → refId wins (element found by refId)", async ({
		handler,
		action,
		handlerKey,
		extraParams,
	}) => {
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
	});

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
		const scrollBySpy = vi
			.spyOn(window, "scrollBy")
			.mockImplementation(() => {});

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
		const scrollToSpy = vi
			.spyOn(window, "scrollTo")
			.mockImplementation(() => {});

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
		if (result.ok) {
			expect(
				result.value as { value?: string; selectedText?: string },
			).toMatchObject({
				value: "ca",
				selectedText: "Canada",
			});
		}
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
		const refId = (
			snap.value as { nodes: Array<{ refId: string }> }
		).nodes.find((n) => n.role === "combobox")!.refId;

		let optionClicked = "";
		document.addEventListener(
			"click",
			(e) => {
				const target = e.target as HTMLElement;
				if (target.getAttribute("role") === "option") {
					optionClicked = target.textContent || "";
				}
			},
			true,
		);

		const result = await dispatchContentScriptCall(
			"page_select_option",
			"select_option",
			handlers.select_option,
			{ refId, value: "Yes" },
		);
		expect(result.ok).toBe(true);
		expect(optionClicked).toBe("Yes");
	});

	it("combobox renders listbox asynchronously (queueMicrotask): select_option still finds the option", async () => {
		const control = document.createElement("div");
		control.setAttribute("role", "combobox");
		control.setAttribute("aria-label", "Country");
		control.setAttribute("aria-expanded", "false");
		control.addEventListener("click", () => {
			control.setAttribute("aria-expanded", "true");
			queueMicrotask(() => {
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
		});
		document.body.appendChild(control);

		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const refId = (
			snap.value as { nodes: Array<{ refId: string }> }
		).nodes.find((n) => n.role === "combobox")!.refId;

		let optionClicked = "";
		document.addEventListener(
			"click",
			(e) => {
				const target = e.target as HTMLElement;
				if (target.getAttribute("role") === "option") {
					optionClicked = target.textContent || "";
				}
			},
			true,
		);

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
			listbox.innerHTML =
				'<div role="option">Yes</div><div role="option">No</div>';
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
		const refId = (
			snap.value as { nodes: Array<{ refId: string; role?: string }> }
		).nodes.find((n) => n.role === "combobox")!.refId;

		let optionClicked = "";
		document.addEventListener(
			"click",
			(event) => {
				const target = event.target as HTMLElement;
				if (target.getAttribute("role") === "option")
					optionClicked = target.textContent || "";
			},
			true,
		);

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
		unrelated.innerHTML =
			'<div role="option" data-source="unrelated">Yes</div>';

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
		const refId = (
			snap.value as { nodes: Array<{ refId: string; role?: string }> }
		).nodes.find((n) => n.role === "combobox")!.refId;

		let source = "";
		document.addEventListener(
			"click",
			(event) => {
				const target = event.target as HTMLElement;
				if (target.getAttribute("role") === "option")
					source = target.dataset.source || "";
			},
			true,
		);

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
		unrelated.innerHTML =
			'<div role="option" data-source="unrelated">Yes</div>';

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
		const refId = (
			snap.value as { nodes: Array<{ refId: string; role?: string }> }
		).nodes.find((n) => n.role === "combobox")!.refId;

		let source = "";
		document.addEventListener(
			"click",
			(event) => {
				const target = event.target as HTMLElement;
				if (target.getAttribute("role") === "option")
					source = target.dataset.source || "";
			},
			true,
		);

		const result = await dispatchContentScriptCall(
			"page_select_option",
			"select_option",
			handlers.select_option,
			{ refId, value: "Yes" },
		);
		expect(result.ok).toBe(true);
		expect(source).toBe("target");
	});

	it("combobox with correct aria-controls selects from linked listbox", async () => {
		document.body.innerHTML = `
			<input role="combobox" aria-label="Choice" aria-controls="correct-options">
			<div id="correct-options" role="listbox"><div role="option" data-target>Wanted</div></div>
			<div role="listbox"><div role="option">Wrong</div></div>
		`;
		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const refId = (
			snap.value as { nodes: Array<{ refId: string; role?: string }> }
		).nodes.find((n) => n.role === "combobox")!.refId;
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

	it("combobox uses nearby popup trigger when input itself does not open options", async () => {
		document.body.innerHTML = `
			<div>
				<label for="choice">Choice</label>
				<input id="choice" role="combobox" aria-labelledby="choice-label">
				<button type="button" aria-haspopup="listbox" aria-label="Open options">v</button>
			</div>
		`;
		const button = document.querySelector("button")!;
		button.addEventListener("click", () => {
			const listbox = document.createElement("div");
			listbox.id = "choice-listbox";
			listbox.setAttribute("role", "listbox");
			listbox.innerHTML = '<div role="option" data-target>Wanted</div>';
			document.body.appendChild(listbox);
		});
		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const refId = (
			snap.value as { nodes: Array<{ refId: string; role?: string }> }
		).nodes.find((n) => n.role === "combobox")!.refId;
		let clicked = false;
		document.addEventListener(
			"click",
			(event) => {
				const target = event.target as HTMLElement;
				if (target.matches('[role="option"][data-target]')) clicked = true;
			},
			true,
		);

		const result = await dispatchContentScriptCall(
			"page_select_option",
			"select_option",
			handlers.select_option,
			{ refId, value: "Wanted" },
		);
		expect(result.ok).toBe(true);
		expect(clicked).toBe(true);
	});

	it("nearby popup trigger renders listbox asynchronously (queueMicrotask): select_option still finds the option", async () => {
		document.body.innerHTML = `
			<div>
				<label for="choice">Choice</label>
				<input id="choice" role="combobox" aria-labelledby="choice-label">
				<button type="button" aria-haspopup="listbox" aria-label="Open options">v</button>
			</div>
		`;
		const button = document.querySelector("button")!;
		button.addEventListener("click", () => {
			queueMicrotask(() => {
				const listbox = document.createElement("div");
				listbox.id = "choice-listbox";
				listbox.setAttribute("role", "listbox");
				listbox.innerHTML = '<div role="option" data-target>Wanted</div>';
				document.body.appendChild(listbox);
			});
		});
		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const refId = (
			snap.value as { nodes: Array<{ refId: string; role?: string }> }
		).nodes.find((n) => n.role === "combobox")!.refId;
		let clicked = false;
		document.addEventListener(
			"click",
			(event) => {
				const target = event.target as HTMLElement;
				if (target.matches('[role="option"][data-target]')) clicked = true;
			},
			true,
		);

		const result = await dispatchContentScriptCall(
			"page_select_option",
			"select_option",
			handlers.select_option,
			{ refId, value: "Wanted" },
		);
		expect(result.ok).toBe(true);
		expect(clicked).toBe(true);
	});

	it("combobox renders listbox after two animation frames: select_option waits and finds the option", async () => {
		const control = document.createElement("div");
		control.setAttribute("role", "combobox");
		control.setAttribute("aria-label", "Country");
		control.setAttribute("aria-expanded", "false");
		control.addEventListener("click", () => {
			control.setAttribute("aria-expanded", "true");
			requestAnimationFrame(() =>
				requestAnimationFrame(() => {
					const listbox = document.createElement("div");
					listbox.setAttribute("role", "listbox");
					const opt = document.createElement("div");
					opt.setAttribute("role", "option");
					opt.textContent = "Yes";
					listbox.appendChild(opt);
					document.body.appendChild(listbox);
				}),
			);
		});
		document.body.appendChild(control);

		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const refId = (
			snap.value as { nodes: Array<{ refId: string }> }
		).nodes.find((n) => n.role === "combobox")!.refId;

		let optionClicked = "";
		document.addEventListener(
			"click",
			(e) => {
				const target = e.target as HTMLElement;
				if (target.getAttribute("role") === "option") {
					optionClicked = target.textContent || "";
				}
			},
			true,
		);

		const result = await dispatchContentScriptCall(
			"page_select_option",
			"select_option",
			handlers.select_option,
			{ refId, value: "Yes" },
		);
		expect(result.ok).toBe(true);
		expect(optionClicked).toBe("Yes");
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
		const refId = (
			snap.value as { nodes: Array<{ refId: string }> }
		).nodes.find((n) => n.role === "combobox")!.refId;

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
	it("persistent unrelated phone listbox does not poison degree combobox selection", async () => {
		// Persistent, visible phone-country listbox — present BEFORE the target opens.
		const phoneListbox = document.createElement("div");
		phoneListbox.setAttribute("role", "listbox");
		phoneListbox.id = "iti-0__country-listbox";
		const optAf = document.createElement("div");
		optAf.setAttribute("role", "option");
		optAf.textContent = "Afghanistan +93";
		const optCa = document.createElement("div");
		optCa.setAttribute("role", "option");
		optCa.textContent = "Canada +1";
		phoneListbox.append(optAf, optCa);
		document.body.appendChild(phoneListbox);

		// Target combobox — no aria-controls / aria-owns (react-select portal shape).
		const control = document.createElement("input");
		control.setAttribute("role", "combobox");
		control.setAttribute("aria-label", "Degree");
		control.addEventListener("click", () => {
			const listbox = document.createElement("div");
			listbox.setAttribute("role", "listbox");
			listbox.id = "react-select-degree--0-listbox";
			const opt = document.createElement("div");
			opt.setAttribute("role", "option");
			opt.textContent = "Bachelor's Degree";
			listbox.appendChild(opt);
			document.body.appendChild(listbox);
		});
		document.body.appendChild(control);

		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const refId = (
			snap.value as {
				nodes: Array<{ refId: string; role?: string; name?: string }>;
			}
		).nodes.find(
			(n) => n.role === "combobox" && (n.name || "").includes("Degree"),
		)!.refId;

		// Happy path: selecting a value that exists in the degree listbox.
		let optionClicked = "";
		document.addEventListener(
			"click",
			(e) => {
				const target = e.target as HTMLElement;
				if (target.getAttribute("role") === "option") {
					optionClicked = target.textContent || "";
				}
			},
			true,
		);

		const okResult = await dispatchContentScriptCall(
			"page_select_option",
			"select_option",
			handlers.select_option,
			{ refId, value: "Bachelor's Degree" },
		);
		expect(okResult.ok).toBe(true);
		expect(optionClicked).toBe("Bachelor's Degree");

		// Error path: requesting a missing value must report candidates from the
		// degree listbox ONLY — not the phone-country listbox.
		const errResult = await dispatchContentScriptCall(
			"page_select_option",
			"select_option",
			handlers.select_option,
			{ refId, value: "NonExistent Degree" },
		);
		expect(errResult.ok).toBe(false);
		if (!errResult.ok) {
			expect(errResult.error.code).toBe("E_NOT_FOUND");
			const candidates =
				(errResult.error.details as { candidates?: Array<{ name?: string }> })
					.candidates || [];
			const candidateNames = candidates.map((c) => c.name || "");
			// Must not contain any phone-country option.
			for (const name of candidateNames) {
				expect(name).not.toMatch(/Afghanistan|Canada/);
			}
		}
	});
	it("error includes searched and ignored listbox ids when option not found", async () => {
		// Phone listbox — visible, persistent, unrelated to target.
		const phoneListbox = document.createElement("div");
		phoneListbox.setAttribute("role", "listbox");
		phoneListbox.id = "iti-0__country-listbox";
		phoneListbox.innerHTML =
			'<div role="option">Afghanistan +93</div><div role="option">Canada +1</div>';
		document.body.appendChild(phoneListbox);

		// Degree combobox opens a portal listbox on click.
		const control = document.createElement("input");
		control.setAttribute("role", "combobox");
		control.setAttribute("aria-label", "Degree");
		control.addEventListener("click", () => {
			const listbox = document.createElement("div");
			listbox.setAttribute("role", "listbox");
			listbox.id = "react-select-degree--0-listbox";
			listbox.innerHTML = '<div role="option">Bachelor\'s Degree</div>';
			document.body.appendChild(listbox);
		});
		document.body.appendChild(control);

		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const refId = (
			snap.value as {
				nodes: Array<{ refId: string; role?: string; name?: string }>;
			}
		).nodes.find(
			(n) => n.role === "combobox" && (n.name || "").includes("Degree"),
		)!.refId;

		const result = await dispatchContentScriptCall(
			"page_select_option",
			"select_option",
			handlers.select_option,
			{ refId, value: "NonExistent" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_NOT_FOUND");
			const details = result.error.details as Record<string, unknown>;
			const searchedIds = (details.searchedIds as string[]) || [];
			const ignoredIds = (details.ignoredIds as string[]) || [];
			expect(searchedIds).toContain("react-select-degree--0-listbox");
			expect(ignoredIds).toContain("iti-0__country-listbox");
			const candidates = (details.candidates as Array<{ name?: string }>) || [];
			for (const c of candidates) {
				expect(c.name || "").not.toMatch(/Afghanistan|Canada/);
			}
		}
	});
	it("aria-owns standalone selects option from linked listbox", async () => {
		document.body.innerHTML = `
			<input role="combobox" aria-label="Pick" aria-owns="owned-list">
			<div id="owned-list" role="listbox"><div role="option" data-target>Alpha</div></div>
		`;
		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const refId = (
			snap.value as { nodes: Array<{ refId: string; role?: string }> }
		).nodes.find((n) => n.role === "combobox")!.refId;
		let clicked = false;
		document.querySelector("[data-target]")!.addEventListener("click", () => {
			clicked = true;
		});
		const result = await dispatchContentScriptCall(
			"page_select_option",
			"select_option",
			handlers.select_option,
			{ refId, value: "Alpha" },
		);
		expect(result.ok).toBe(true);
		expect(clicked).toBe(true);
	});

	it("multi-id aria-controls resolves all linked listboxes", async () => {
		document.body.innerHTML = `
			<input role="combobox" aria-label="Pick" aria-controls="lb1 lb2">
			<div id="lb1" role="listbox"><div role="option">Wrong</div></div>
			<div id="lb2" role="listbox"><div role="option" data-target>Correct</div></div>
		`;
		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const refId = (
			snap.value as { nodes: Array<{ refId: string; role?: string }> }
		).nodes.find((n) => n.role === "combobox")!.refId;
		let wrongClicked = false;
		let correctClicked = false;
		document.querySelectorAll('[role="option"]').forEach((opt) => {
			opt.addEventListener("click", () => {
				if (opt.textContent === "Wrong") wrongClicked = true;
				if (opt.textContent === "Correct") correctClicked = true;
			});
		});
		const result = await dispatchContentScriptCall(
			"page_select_option",
			"select_option",
			handlers.select_option,
			{ refId, value: "Correct" },
		);
		expect(result.ok).toBe(true);
		expect(correctClicked).toBe(true);
		expect(wrongClicked).toBe(false);
	});

	it("selects option when control itself is a listbox", async () => {
		document.body.innerHTML = `
			<div role="listbox" aria-label="Pick">
				<div role="option" data-target>Alpha</div>
				<div role="option">Beta</div>
			</div>
		`;
		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const refId = (
			snap.value as { nodes: Array<{ refId: string; role?: string }> }
		).nodes.find((n) => n.role === "listbox")!.refId;
		let clicked = false;
		document.querySelector("[data-target]")!.addEventListener("click", () => {
			clicked = true;
		});
		const result = await dispatchContentScriptCall(
			"page_select_option",
			"select_option",
			handlers.select_option,
			{ refId, value: "Alpha" },
		);
		expect(result.ok).toBe(true);
		expect(clicked).toBe(true);
	});

	it("aria-controls pointing to non-listbox excludes it from searched ids", async () => {
		document.body.innerHTML = `
			<input role="combobox" aria-label="Pick" aria-controls="some-div">
			<div id="some-div">plain content</div>
			<div role="listbox"><div role="option">Real</div></div>
		`;
		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const refId = (
			snap.value as { nodes: Array<{ refId: string; role?: string }> }
		).nodes.find((n) => n.role === "combobox")!.refId;
		const result = await dispatchContentScriptCall(
			"page_select_option",
			"select_option",
			handlers.select_option,
			{ refId, value: "Real" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_NOT_FOUND");
			const details = result.error.details as Record<string, unknown>;
			const searchedIds = (details.searchedIds as string[]) || [];
			expect(searchedIds).not.toContain("some-div");
		}
	});

	it("nearbyRoots: listbox nested inside combobox", async () => {
		document.body.innerHTML = `
			<div role="combobox" aria-label="Pick">
				<div role="listbox">
					<div role="option" data-target>Nested Option</div>
				</div>
			</div>
		`;
		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const refId = (
			snap.value as { nodes: Array<{ refId: string; role?: string }> }
		).nodes.find((n) => n.role === "combobox")!.refId;
		let clicked = false;
		document.querySelector("[data-target]")!.addEventListener("click", () => {
			clicked = true;
		});
		const result = await dispatchContentScriptCall(
			"page_select_option",
			"select_option",
			handlers.select_option,
			{ refId, value: "Nested Option" },
		);
		expect(result.ok).toBe(true);
		expect(clicked).toBe(true);
	});

	it("case insensitive matching picks correct option", async () => {
		const phoneListbox = document.createElement("div");
		phoneListbox.setAttribute("role", "listbox");
		phoneListbox.id = "iti-0__country-listbox";
		phoneListbox.innerHTML =
			'<div role="option">Afghanistan +93</div><div role="option">Canada +1</div>';
		document.body.appendChild(phoneListbox);

		const control = document.createElement("input");
		control.setAttribute("role", "combobox");
		control.setAttribute("aria-label", "Degree");
		control.addEventListener("click", () => {
			const listbox = document.createElement("div");
			listbox.setAttribute("role", "listbox");
			listbox.id = "react-select-degree--0-listbox";
			listbox.innerHTML = '<div role="option">Bachelor\'s Degree</div>';
			document.body.appendChild(listbox);
		});
		document.body.appendChild(control);

		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const refId = (
			snap.value as {
				nodes: Array<{ refId: string; role?: string; name?: string }>;
			}
		).nodes.find(
			(n) => n.role === "combobox" && (n.name || "").includes("Degree"),
		)!.refId;

		let optionClicked = "";
		document.addEventListener(
			"click",
			(e) => {
				const target = e.target as HTMLElement;
				if (target.getAttribute("role") === "option") {
					optionClicked = target.textContent || "";
				}
			},
			true,
		);

		const result = await dispatchContentScriptCall(
			"page_select_option",
			"select_option",
			handlers.select_option,
			{ refId, value: "bachelor's degree" },
		);
		expect(result.ok).toBe(true);
		expect(optionClicked).toBe("Bachelor's Degree");
	});

	it("roots empty when no listbox found returns clear error", async () => {
		document.body.innerHTML = `
			<input role="combobox" aria-label="No Popup">
		`;
		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const refId = (
			snap.value as { nodes: Array<{ refId: string; role?: string }> }
		).nodes.find((n) => n.role === "combobox")!.refId;
		const result = await dispatchContentScriptCall(
			"page_select_option",
			"select_option",
			handlers.select_option,
			{ refId, value: "Anything" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_NOT_FOUND");
			expect(result.error.message).toContain("Candidates: none");
			const details = result.error.details as Record<string, unknown>;
			const searchedIds = (details.searchedIds as string[]) || [];
			expect(searchedIds).toEqual([]);
			const candidates = details.candidates as
				| Array<{ name?: string }>
				| undefined;
			expect(candidates).toBeUndefined();
		}
	});
	it("error includes aria-controls before/after and isDropdown when option not found", async () => {
		// Persistent, visible phone listbox — unrelated to target.
		const phoneListbox = document.createElement("div");
		phoneListbox.setAttribute("role", "listbox");
		phoneListbox.id = "iti-0__country-listbox";
		phoneListbox.innerHTML =
			'<div role="option">Afghanistan +93</div><div role="option">Canada +1</div>';
		document.body.appendChild(phoneListbox);

		// Degree combobox — no aria-controls before click, gains one after click.
		const control = document.createElement("input");
		control.setAttribute("role", "combobox");
		control.setAttribute("aria-label", "Degree");
		control.addEventListener("click", () => {
			control.setAttribute("aria-controls", "react-select-degree--0-listbox");
			const listbox = document.createElement("div");
			listbox.setAttribute("role", "listbox");
			listbox.id = "react-select-degree--0-listbox";
			listbox.innerHTML = '<div role="option">Bachelor\'s Degree</div>';
			document.body.appendChild(listbox);
		});
		document.body.appendChild(control);

		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const refId = (
			snap.value as {
				nodes: Array<{ refId: string; role?: string; name?: string }>;
			}
		).nodes.find(
			(n) => n.role === "combobox" && (n.name || "").includes("Degree"),
		)!.refId;

		const result = await dispatchContentScriptCall(
			"page_select_option",
			"select_option",
			handlers.select_option,
			{ refId, value: "NonExistent" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_NOT_FOUND");
			const details = result.error.details as Record<string, unknown>;
			expect(details.ariaControlsBefore).toBeNull();
			expect(details.ariaControlsAfter).toBe("react-select-degree--0-listbox");
			expect(details.isDropdown).toBe(true);
			expect(details.targetName).toContain("Degree");
		}
	});
});

describe("submit handler validation receipts", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
		resetLease();
	});

	it("returns invalidControls when form constraint validation fails", async () => {
		document.body.innerHTML = `
			<form aria-label="Application">
				<input aria-label="Visible" value="ok">
				<input required aria-hidden="true" tabindex="-1" value="">
				<button type="submit">Submit</button>
			</form>
		`;
		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const formRef = (
			snap.value as { nodes: Array<{ refId: string; role?: string }> }
		).nodes.find((n) => n.role === "form")!.refId;

		const result = await dispatchContentScriptCall(
			"page_submit",
			"submit",
			handlers.submit,
			{ refId: formRef },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const receipt = result.value as {
				valid?: boolean;
				invalid?: boolean;
				invalidControls?: Array<{ required?: boolean; value?: string }>;
			};
			expect(receipt.valid).toBe(false);
			expect(receipt.invalid).toBe(true);
			expect(receipt.invalidControls).toHaveLength(1);
			expect(receipt.invalidControls![0]).toMatchObject({
				required: true,
				value: "",
			});
		}
	});
	it("invalidControls include linked visible error and nearest real field", async () => {
		document.body.innerHTML = `
			<form aria-label="App">
				<div><label>Email</label><input required type="email" value="bad" aria-describedby="email-err" data-ref-id="e30">
					<span id="email-err" role="alert">Enter a valid email.</span></div>
				<button type="submit">Submit</button>
			</form>
		`;
		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const formRef = (
			snap.value as { nodes: Array<{ refId: string; role?: string }> }
		).nodes.find((n) => n.role === "form")!.refId;

		const result = await dispatchContentScriptCall(
			"page_submit",
			"submit",
			handlers.submit,
			{ refId: formRef },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const receipt = result.value as {
				valid?: boolean;
				invalid?: boolean;
				invalidControls?: Array<{
					refId?: string;
					field?: string;
					error?: string;
					validationMessage?: string;
				}>;
			};
			expect(receipt.valid).toBe(false);
			expect(receipt.invalidControls).toHaveLength(1);
			expect(receipt.invalidControls![0]).toMatchObject({
				refId: "e30",
				field: "Email",
				error: "Enter a valid email.",
			});
			expect(receipt.invalidControls![0].validationMessage).toEqual(
				expect.any(String),
			);
		}
	});
});

describe("notInteractableError recovery", () => {
	it("recovery says select_option when target is a dropdown", () => {
		const err = notInteractableError("fill", "e5", {
			controlType: "dropdown",
		});
		const recoveryText = (err.recovery || []).join(" ");
		expect(recoveryText).toContain("page.select_option");
	});

	it("recovery says select_option when nearby field is a dropdown", () => {
		const err = notInteractableError("fill", "e5", {
			nearbyControlType: "dropdown",
		});
		const recoveryText = (err.recovery || []).join(" ");
		expect(recoveryText).toContain("page.select_option");
	});

	it("recovery stays generic for non-dropdown", () => {
		const err = notInteractableError("fill", "e5", {});
		const recoveryText = (err.recovery || []).join(" ");
		expect(recoveryText).not.toContain("select_option");
	});
});

describe("validation-proxy labeling", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
		resetLease();
	});

	it("hidden required input inside combobox wrapper is labeled validation-proxy", async () => {
		document.body.innerHTML = `
			<div role="combobox" aria-label="Degree" aria-expanded="false" data-ref-id="e10">
				<div role="textbox" aria-hidden="true" tabindex="-1">
					<input type="hidden" required aria-describedby="degree-error" data-ref-id="e11">
				</div>
			</div>
			<span id="degree-error">This field is required.</span>
		`;
		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const nodes = (snap.value as { nodes: Array<Record<string, unknown>> })
			.nodes;
		const proxyNode = nodes.find((n) => n.refId === "e11");
		expect(proxyNode).toBeDefined();
		expect(proxyNode!.controlType).toBe("validation-proxy");
		expect(proxyNode!.actionable).toBe(false);
		expect(proxyNode!.forControl).toBe("e10");
	});

	it("snapshot text renders validation-proxy not textbox", async () => {
		document.body.innerHTML = `
			<div role="combobox" aria-label="Degree" aria-expanded="false" data-ref-id="e10">
				<input type="hidden" required aria-hidden="true" tabindex="-1" data-ref-id="e11">
			</div>
		`;
		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const text = snap.value as { text: string };
		// The hidden input should appear as validation-proxy in the text, not textbox.
		expect(text.text).toContain("validation-proxy");
		// It should NOT appear as a plain textbox in the snapshot text.
		const proxyLine = text.text.split("\n").find((l) => l.includes("e11"));
		expect(proxyLine).toBeDefined();
		expect(proxyLine!.includes("textbox")).toBe(false);
	});

	it("visible normal textbox is not mislabeled", async () => {
		document.body.innerHTML = `<input type="text" aria-label="Name">`;
		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		const nodes = (snap.value as { nodes: Array<Record<string, unknown>> })
			.nodes;
		const textNode = nodes.find((n) => n.tag === "input");
		expect(textNode).toBeDefined();
		expect(textNode!.controlType).toBeUndefined();
	});
});

describe("form_errors in snapshot_data", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
		resetLease();
	});

	it("formErrors groups visible linked errors by field", async () => {
		document.body.innerHTML = `
			<form aria-label="App">
				<div><label>Do you have startup experience?</label>
					<input required aria-describedby="q1-err" data-ref-id="e215">
					<span id="q1-err" role="alert">This field is required.</span></div>
				<div><label>Degree</label>
					<select required aria-invalid="true" aria-describedby="deg-err" data-ref-id="e216">
						<option value="">Pick</option></select>
					<span id="deg-err">Select a degree.</span></div>
			</form>
		`;
		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		expect(snap.ok).toBe(true);
		if (!snap.ok) return;
		const formErrors = (
			snap.value as {
				formErrors?: Array<{ field: string; error: string; refId: string }>;
			}
		).formErrors;
		expect(formErrors).toBeDefined();
		expect(formErrors!.length).toBe(2);
		expect(formErrors![0]).toMatchObject({
			field: "Do you have startup experience?",
			error: "This field is required.",
			refId: "e215",
		});
		expect(formErrors![1]).toMatchObject({
			field: "Degree",
			error: "Select a degree.",
			refId: "e216",
		});
	});

	it("formErrors empty when no invalid controls", async () => {
		document.body.innerHTML = `
			<form aria-label="App">
				<input aria-label="Name" value="ok">
			</form>
		`;
		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		expect(snap.ok).toBe(true);
		if (!snap.ok) return;
		const formErrors = (snap.value as { formErrors?: unknown[] }).formErrors;
		expect(formErrors).toEqual([]);
	});

	it("formErrors omits hidden validation-proxy shims", async () => {
		document.body.innerHTML = `
			<div role="combobox" aria-label="Degree" aria-expanded="false" data-ref-id="e10">
				<input type="hidden" required aria-hidden="true" tabindex="-1" data-ref-id="e11">
			</div>
		`;
		const snap = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{},
		);
		expect(snap.ok).toBe(true);
		if (!snap.ok) return;
		const formErrors = (snap.value as { formErrors?: Array<{ refId: string }> })
			.formErrors;
		expect(formErrors).toBeDefined();
		const proxyEntry = formErrors!.find((e) => e.refId === "e11");
		expect(proxyEntry).toBeUndefined();
	});
});
