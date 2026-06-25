// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { handlers } from "../src/content-script/handlers.js";
import {
	dispatchContentScriptCall,
	registerContentScriptSpec,
} from "../src/content-script/registry.js";
import { buildContentScriptSpecs } from "../src/content-script/schemas.js";

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

describe("T-006: page.dom raw-DOM introspection", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
	});

	it("returns hidden file input with accept, filesCount, hiddenReason at depth 0", async () => {
		// Same hidden-file-input fixture as set-files-hidden-input
		const label = document.createElement("label");
		label.setAttribute("data-testid", "resume");
		label.setAttribute("data-ref-id", "e11");

		const input = document.createElement("input");
		input.type = "file";
		input.setAttribute("accept", ".doc,.docx,.pdf");
		input.setAttribute("data-testid", "input-resume");
		input.hidden = true;

		const button = document.createElement("button");
		button.type = "button";
		button.setAttribute("data-ref-id", "e12");
		button.textContent = "Drop or select";

		label.appendChild(input);
		label.appendChild(button);
		document.body.appendChild(label);

		const result = await dispatchContentScriptCall(
			"page_dom",
			"dom",
			handlers.dom,
			{ selector: "input[type=file]", depth: 0 },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.value as {
				nodes: Array<{
					tag: string;
					accept?: string;
					filesCount?: number;
					hidden?: boolean;
					hiddenReason?: string;
					refId?: string;
					children?: unknown[];
				}>;
			};
			expect(data.nodes.length).toBe(1);
			const node = data.nodes[0];
			expect(node.tag).toBe("input");
			expect(node.accept).toBe(".doc,.docx,.pdf");
			expect(node.filesCount).toBe(0);
			expect(node.hidden).toBe(true);
			expect(node.hiddenReason).toBe("hidden-attr");
			expect(node.refId).toMatch(/^e\d+$/);
			expect(node.children).toBeUndefined();
		}
	});

	it("depth=2 includes children with hidden nodes", async () => {
		const label = document.createElement("label");
		label.setAttribute("data-ref-id", "e11");

		const input = document.createElement("input");
		input.type = "file";
		input.hidden = true;

		label.appendChild(input);
		document.body.appendChild(label);

		const result = await dispatchContentScriptCall(
			"page_dom",
			"dom",
			handlers.dom,
			{ selector: "label", depth: 2, includeHidden: true },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.value as {
				nodes: Array<{
					tag: string;
					children?: Array<{ tag: string; hidden?: boolean }>;
				}>;
			};
			expect(data.nodes.length).toBe(1);
			const labelNode = data.nodes[0];
			expect(labelNode.tag).toBe("label");
			expect(labelNode.children).toBeDefined();
			if (labelNode.children) {
				const inputNode = labelNode.children.find(
					(c: { tag: string }) => c.tag === "input",
				);
				expect(inputNode).toBeDefined();
				expect(inputNode?.hidden).toBe(true);
			}
		}
	});

	it("includeHidden=false excludes hidden file input", async () => {
		const label = document.createElement("label");
		const input = document.createElement("input");
		input.type = "file";
		input.hidden = true;
		label.appendChild(input);
		document.body.appendChild(label);

		const result = await dispatchContentScriptCall(
			"page_dom",
			"dom",
			handlers.dom,
			{ selector: "input[type=file]", includeHidden: false },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.value as { nodes: unknown[] };
			expect(data.nodes.length).toBe(0);
		}
	});

	it("selector matching nothing returns empty nodes", async () => {
		const result = await dispatchContentScriptCall(
			"page_dom",
			"dom",
			handlers.dom,
			{ selector: ".nonexistent" },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.value as {
				nodes: unknown[];
				url: string;
				title: string;
			};
			expect(data.nodes.length).toBe(0);
			expect(data.url).toBeDefined();
			expect(data.title).toBeDefined();
		}
	});

	it("depth=0 returns attributes for div element", async () => {
		const div = document.createElement("div");
		div.className = "my-class";
		div.id = "my-id";
		div.setAttribute("data-ref-id", "e50");
		document.body.appendChild(div);

		const result = await dispatchContentScriptCall(
			"page_dom",
			"dom",
			handlers.dom,
			{ selector: "div", depth: 0 },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const data = result.value as {
				nodes: Array<{ tag: string; attributes?: Record<string, string> }>;
			};
			expect(data.nodes.length).toBeGreaterThanOrEqual(1);
			const divNode = data.nodes.find((n) => n.tag === "div");
			expect(divNode).toBeDefined();
			expect(divNode?.attributes).toBeDefined();
			if (divNode?.attributes) {
				expect(divNode.attributes.class).toBe("my-class");
				expect(divNode.attributes.id).toBe("my-id");
			}
		}
	});
});
