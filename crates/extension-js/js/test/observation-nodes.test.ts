// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("T-001: snapshot node includes src/href absolute for IMG/A", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("snapshot includes absolute src for img elements", () => {
		const article = document.createElement("article");
		const img = document.createElement("img");
		img.setAttribute("src", "/testcases/media-download/assets/photo.jpg");
		img.setAttribute("alt", "Sunset over mountains");
		article.appendChild(img);
		document.body.appendChild(article);

		const result = inlineSnapshot(500);
		const imgNode = result.nodes.find((n) => n.tag === "img");
		expect(imgNode).toBeDefined();
		expect(imgNode?.src).toBeDefined();
		expect(imgNode?.src).toMatch(/^http/);
		expect(imgNode?.src).toContain(
			"/testcases/media-download/assets/photo.jpg",
		);
		expect(imgNode?.alt).toBe("Sunset over mountains");
	});

	it("snapshot includes absolute href for a elements", () => {
		const article = document.createElement("article");
		const a = document.createElement("a");
		a.setAttribute("href", "/testcases/dynamic-feed/post-001.html");
		a.textContent = "First Post";
		article.appendChild(a);
		document.body.appendChild(article);

		const result = inlineSnapshot(500);
		const aNode = result.nodes.find((n) => n.tag === "a");
		expect(aNode).toBeDefined();
		expect(aNode?.href).toBeDefined();
		expect(aNode?.href).toMatch(/^http/);
		expect(aNode?.href).toContain("/testcases/dynamic-feed/post-001.html");
	});

	it("snapshot resolves relative URLs to absolute", () => {
		const img = document.createElement("img");
		img.setAttribute("src", "./photo.jpg");
		img.setAttribute("alt", "Photo");
		document.body.appendChild(img);

		const result = inlineSnapshot(500);
		const imgNode = result.nodes.find((n) => n.tag === "img");
		expect(imgNode?.src).toMatch(/^http/);
		expect(imgNode?.src).not.toContain("./");
	});

	it("snapshot includes title for input elements", () => {
		const input = document.createElement("input");
		input.setAttribute("type", "text");
		input.setAttribute("title", "Enter your name");
		document.body.appendChild(input);

		const result = inlineSnapshot(500);
		const inputNode = result.nodes.find((n) => n.tag === "input");
		expect(inputNode?.title).toBe("Enter your name");
	});

	it("password and hidden inputs do not expose value", () => {
		document.body.innerHTML = `
			<input type="password" value="secret123" title="pwd">
			<input type="hidden" value="csrf-token" title="hidden">
			<input type="text" value="visible" title="text">
		`;
		const result = inlineSnapshot(100);
		const pwd = result.nodes.find(
			(n) => n.tag === "input" && n.title === "pwd",
		);
		const hidden = result.nodes.find(
			(n) => n.tag === "input" && n.title === "hidden",
		);
		const text = result.nodes.find(
			(n) => n.tag === "input" && n.title === "text",
		);
		expect(pwd?.value).toBeUndefined();
		expect(hidden?.value).toBeUndefined();
		expect(text?.value).toBe("visible");
	});

	it("snapshot node includes text content", () => {
		document.body.innerHTML = `<button data-ref-id="e1">Submit</button>`;
		const result = inlineSnapshot(100);
		const button = result.nodes.find((n) => n.tag === "button");
		expect(button?.text).toBe("Submit");
	});
});

describe("T-003: parentRefId links image to article", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("snapshot sets parentRefId on img inside article", () => {
		const article = document.createElement("article");
		article.setAttribute("data-post-id", "post-001");
		const img = document.createElement("img");
		img.setAttribute(
			"src",
			"http://127.0.0.1:9292/testcases/media-download/assets/photo.jpg",
		);
		img.setAttribute("alt", "Sunset");
		article.appendChild(img);
		document.body.appendChild(article);

		const result = inlineSnapshot(500);
		const articleNode = result.nodes.find((n) => n.tag === "article");
		const imgNode = result.nodes.find((n) => n.tag === "img");

		expect(articleNode).toBeDefined();
		expect(imgNode).toBeDefined();
		expect(imgNode?.parentRefId).toBe(articleNode?.refId);
	});

	it("snapshot does not set parentRefId on top-level elements", () => {
		const img = document.createElement("img");
		img.setAttribute(
			"src",
			"http://127.0.0.1:9292/testcases/media-download/assets/photo.jpg",
		);
		img.setAttribute("alt", "Standalone");
		document.body.appendChild(img);

		const result = inlineSnapshot(500);
		const imgNode = result.nodes.find((n) => n.tag === "img");
		expect(imgNode).toBeDefined();
		expect(imgNode?.parentRefId).toBeUndefined();
	});

	it("snapshot sets parentRefId for nested media in article", () => {
		const feed = document.createElement("div");
		feed.className = "feed";

		for (let i = 1; i <= 3; i++) {
			const article = document.createElement("article");
			article.setAttribute("data-post-id", `post-00${i}`);
			const img = document.createElement("img");
			img.setAttribute(
				"src",
				`http://127.0.0.1:9292/testcases/media-download/assets/photo${i}.jpg`,
			);
			img.setAttribute("alt", `Photo ${i}`);
			article.appendChild(img);
			feed.appendChild(article);
		}
		document.body.appendChild(feed);

		const result = inlineSnapshot(500);
		const articles = result.nodes.filter((n) => n.tag === "article");
		const images = result.nodes.filter((n) => n.tag === "img");

		expect(articles).toHaveLength(3);
		expect(images).toHaveLength(3);

		for (const img of images) {
			expect(img.parentRefId).toBeDefined();
			const parent = articles.find((a) => a.refId === img.parentRefId);
			expect(parent).toBeDefined();
		}
	});
});
