// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("T-002: page.find returns non-null refId + src", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
	});

	it("find img returns non-null refId and absolute src", async () => {
		const article = document.createElement("article");
		const img = document.createElement("img");
		img.setAttribute("src", "/testcases/media-download/assets/photo.jpg");
		img.setAttribute("alt", "Sunset over mountains");
		article.appendChild(img);
		document.body.appendChild(article);

		const result = await dispatchContentScriptCall(
			"page_find",
			"find",
			handlers.find,
			{ selector: "img" },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(Array.isArray(result.value)).toBe(true);
			expect(result.value.length).toBeGreaterThan(0);
			const imgResult = result.value[0];
			expect(imgResult.refId).not.toBeNull();
			expect(imgResult.refId).toMatch(/^e\d+$/);
			expect(imgResult.src).toBeDefined();
			expect(imgResult.src).toMatch(/^http/);
			expect(imgResult.alt).toBe("Sunset over mountains");
		}
	});

	it("find a returns non-null refId and absolute href", async () => {
		const article = document.createElement("article");
		const a = document.createElement("a");
		a.setAttribute("href", "/testcases/dynamic-feed/post-001.html");
		a.textContent = "First Post";
		article.appendChild(a);
		document.body.appendChild(article);

		const result = await dispatchContentScriptCall(
			"page_find",
			"find",
			handlers.find,
			{ selector: "a" },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.length).toBeGreaterThan(0);
			const aResult = result.value[0];
			expect(aResult.refId).not.toBeNull();
			expect(aResult.refId).toMatch(/^e\d+$/);
			expect(aResult.href).toBeDefined();
			expect(aResult.href).toMatch(/^http/);
		}
	});

	it("find assigns refId to elements without data-ref-id", async () => {
		const img = document.createElement("img");
		img.setAttribute("src", "http://127.0.0.1:9292/photo.jpg");
		img.setAttribute("alt", "Photo");
		document.body.appendChild(img);

		expect(img.getAttribute("data-ref-id")).toBeNull();

		const result = await dispatchContentScriptCall(
			"page_find",
			"find",
			handlers.find,
			{ selector: "img" },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value[0].refId).not.toBeNull();
			expect(result.value[0].refId).toMatch(/^e\d+$/);
			// Verify the attribute was set on the DOM element
			expect(img.getAttribute("data-ref-id")).toMatch(/^e\d+$/);
		}
	});

	it("find returns role and name for elements", async () => {
		const btn = document.createElement("button");
		btn.textContent = "Submit";
		btn.setAttribute("aria-label", "Submit form");
		document.body.appendChild(btn);

		const result = await dispatchContentScriptCall(
			"page_find",
			"find",
			handlers.find,
			{ selector: "button" },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value[0].role).toBe("button");
			expect(result.value[0].name).toBe("Submit form");
		}
	});

	it("find returns parentRefId for nested elements", async () => {
		const article = document.createElement("article");
		article.setAttribute("data-post-id", "post-001");
		const img = document.createElement("img");
		img.setAttribute("src", "http://127.0.0.1:9292/photo.jpg");
		img.setAttribute("alt", "Photo");
		article.appendChild(img);
		document.body.appendChild(article);

		const result = await dispatchContentScriptCall(
			"page_find",
			"find",
			handlers.find,
			{ selector: "img" },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const articleResult = await dispatchContentScriptCall(
				"page_find",
				"find",
				handlers.find,
				{ selector: "article" },
			);
			expect(articleResult.ok).toBe(true);
			const articleRefId = articleResult.ok
				? articleResult.value[0]?.refId
				: undefined;
			expect(result.value[0].parentRefId).toBe(articleRefId);
			expect(article.getAttribute("data-ref-id")).toBe(articleRefId);
		}
	});

	it("assigns unique refIds across many pre-tagged elements", async () => {
		for (let i = 0; i < 100; i++) {
			const div = document.createElement("div");
			div.setAttribute("data-ref-id", `e${i + 1}`);
			div.textContent = `item ${i}`;
			document.body.appendChild(div);
		}
		const result = await dispatchContentScriptCall(
			"page_find",
			"find",
			handlers.find,
			{ selector: "div" },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const refIds = result.value.map((n) => n.refId);
			expect(new Set(refIds).size).toBe(refIds.length);
		}
	});

	it("find returns form field states", async () => {
		document.body.innerHTML = `
			<input type="text" value="hello" data-ref-id="e1">
			<input type="checkbox" checked data-ref-id="e2">
			<input type="text" value="world" disabled data-ref-id="e3">
			<input type="text" value="readonly" readonly data-ref-id="e4">
		`;

		const textResult = await dispatchContentScriptCall(
			"page_find",
			"find",
			handlers.find,
			{ selector: "input[type=text]" },
		);
		expect(textResult.ok).toBe(true);
		if (textResult.ok) {
			expect(Array.isArray(textResult.value)).toBe(true);
			expect(textResult.value.length).toBeGreaterThan(0);
			const firstText = textResult.value[0];
			expect(firstText.value).toBe("hello");
			expect(firstText.checked).toBeUndefined();
		}

		const checkboxResult = await dispatchContentScriptCall(
			"page_find",
			"find",
			handlers.find,
			{ selector: "input[type=checkbox]" },
		);
		expect(checkboxResult.ok).toBe(true);
		if (checkboxResult.ok) {
			expect(checkboxResult.value[0].checked).toBe(true);
		}

		const disabledResult = await dispatchContentScriptCall(
			"page_find",
			"find",
			handlers.find,
			{ selector: "input[disabled]" },
		);
		expect(disabledResult.ok).toBe(true);
		if (disabledResult.ok) {
			expect(disabledResult.value[0].disabled).toBe(true);
		}

		const readonlyResult = await dispatchContentScriptCall(
			"page_find",
			"find",
			handlers.find,
			{ selector: "input[readonly]" },
		);
		expect(readonlyResult.ok).toBe(true);
		if (readonlyResult.ok) {
			expect(readonlyResult.value[0].readOnly).toBe(true);
		}
	});
});
