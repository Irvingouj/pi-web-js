// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { handlers } from "../src/content-script/handlers.js";
import {
	dispatchContentScriptCall,
	registerContentScriptSpec,
} from "../src/content-script/registry.js";
import { buildContentScriptSpecs } from "../src/content-script/schemas.js";
import { collectInlineSnapshot as inlineSnapshot } from "../src/shared/cross/collect-inline-snapshot.js";

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

describe("T-006: snapshot error structure", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
	});

	it("snapshot failure includes code, details.cause, and valid recovery", async () => {
		// Temporarily remove document.body to trigger the error path
		const originalBody = document.body;
		Object.defineProperty(document, "body", {
			value: null,
			configurable: true,
		});

		const result = await dispatchContentScriptCall(
			"page_snapshot_data",
			"snapshot",
			handlers.snapshot,
			{ max_nodes: 50 },
		);

		// Restore document.body
		Object.defineProperty(document, "body", {
			value: originalBody,
			configurable: true,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_SNAPSHOT");
			expect(result.error.details?.cause).toBeDefined();
			expect(result.error.recovery).toBeDefined();
			expect(result.error.recovery.length).toBeGreaterThan(0);
		}
	});

	it("snapshot_text failure includes code, details.cause, and valid recovery", async () => {
		// Temporarily remove document.body to trigger the error path
		const originalBody = document.body;
		Object.defineProperty(document, "body", {
			value: null,
			configurable: true,
		});

		const result = await dispatchContentScriptCall(
			"page_snapshot_text",
			"snapshot_text",
			handlers.snapshot_text,
			{ max_nodes: 50 },
		);

		// Restore document.body
		Object.defineProperty(document, "body", {
			value: originalBody,
			configurable: true,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_SNAPSHOT");
			expect(result.error.details?.cause).toBeDefined();
			expect(result.error.recovery).toBeDefined();
			expect(result.error.recovery.length).toBeGreaterThan(0);
		}
	});

	it("snapshot succeeds when DOM was mutated before observer attaches", () => {
		// Build a DOM, then mutate it (remove some elements), then snapshot
		for (let i = 0; i < 100; i++) {
			const div = document.createElement("div");
			div.id = `node-${i}`;
			div.textContent = `Node ${i}`;
			document.body.appendChild(div);
		}

		// Remove half the nodes to simulate mutation
		for (let i = 0; i < 50; i++) {
			const el = document.getElementById(`node-${i}`);
			if (el) el.remove();
		}

		// Snapshot should still succeed
		const result = inlineSnapshot(50);
		expect(result.nodes.length).toBeLessThanOrEqual(50);
		expect(result.nodes.length).toBeGreaterThan(0);
		expect(result.url).toBeDefined();
		expect(result.title).toBeDefined();
	});

	it("throws E_SNAPSHOT when DOM mutates during snapshot traversal", () => {
		document.body.innerHTML = "";
		const wrapper = document.createElement("div");
		wrapper.id = "wrapper";
		for (let i = 0; i < 20; i++) {
			const child = document.createElement("span");
			child.textContent = `s${i}`;
			wrapper.appendChild(child);
		}
		document.body.appendChild(wrapper);

		const childrenDescriptor = Object.getOwnPropertyDescriptor(
			Element.prototype,
			"children",
		)!;
		let injected = false;
		const spy = vi
			.spyOn(Element.prototype, "children", "get")
			.mockImplementation(function (this: Element) {
				const children = childrenDescriptor.get!.call(this);
				if (this === wrapper && !injected) {
					injected = true;
					document.body.appendChild(document.createElement("aside"));
				}
				return children;
			});

		try {
			inlineSnapshot(50);
			expect.fail("expected E_SNAPSHOT");
		} catch (err: unknown) {
			const e = err as Error & {
				code?: string;
				details?: { cause?: string };
			};
			expect(e.code).toBe("E_SNAPSHOT");
			expect(e.details?.cause).toBe("dom_mutated_during_snapshot");
		} finally {
			spy.mockRestore();
		}
	});
});
