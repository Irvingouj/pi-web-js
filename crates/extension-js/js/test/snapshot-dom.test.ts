import { beforeEach, describe, expect, it } from "vitest";
import {
	getOwnVisibleText,
	hasDirectTextContent,
	isMarkdownVisible,
	shouldInclude,
} from "../src/shared/snapshot-dom.js";
import { collectInlineSnapshot } from "../src/shared/collect-inline-snapshot.js";

describe("snapshot-dom markdown visibility", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("includes p elements with visible text", () => {
		const p = document.createElement("p");
		p.id = "status";
		p.textContent = "filled:Alice";
		document.body.appendChild(p);

		expect(isMarkdownVisible(p)).toBe(true);
		expect(shouldInclude(p)).toBe(true);
	});

	it("includes div elements with direct text content", () => {
		const div = document.createElement("div");
		div.appendChild(document.createTextNode("hello"));
		document.body.appendChild(div);

		expect(hasDirectTextContent(div)).toBe(true);
		expect(isMarkdownVisible(div)).toBe(true);
	});

	it("excludes empty generic containers", () => {
		const div = document.createElement("div");
		const child = document.createElement("span");
		child.textContent = "nested";
		div.appendChild(child);
		document.body.appendChild(div);

		expect(isMarkdownVisible(div)).toBe(false);
		expect(isMarkdownVisible(child)).toBe(true);
	});

	it("includes aria-live regions", () => {
		const live = document.createElement("div");
		live.setAttribute("aria-live", "polite");
		live.textContent = "updated";
		document.body.appendChild(live);

		expect(isMarkdownVisible(live)).toBe(true);
	});

	it("excludes aria-hidden elements", () => {
		const hidden = document.createElement("p");
		hidden.setAttribute("aria-hidden", "true");
		hidden.textContent = "secret";
		document.body.appendChild(hidden);

		expect(isMarkdownVisible(hidden)).toBe(false);
	});

	it("uses own text for generic containers with mixed children", () => {
		const div = document.createElement("div");
		div.appendChild(document.createTextNode("hello "));
		const child = document.createElement("span");
		child.textContent = "world";
		div.appendChild(child);
		document.body.appendChild(div);

		expect(isMarkdownVisible(div)).toBe(true);
		expect(getOwnVisibleText(div)).toBe("hello");
	});

	it("excludes inert elements", () => {
		const inert = document.createElement("p");
		inert.inert = true;
		inert.textContent = "blocked";
		document.body.appendChild(inert);

		expect(isMarkdownVisible(inert)).toBe(false);
	});

	it("excludes presentation role", () => {
		const decorative = document.createElement("span");
		decorative.setAttribute("role", "presentation");
		decorative.textContent = "decorative";
		document.body.appendChild(decorative);

		expect(isMarkdownVisible(decorative)).toBe(false);
	});

	it("returns nested text when no direct text nodes exist", () => {
		const btn = document.createElement("button");
		const span = document.createElement("span");
		span.textContent = "Sign in";
		btn.appendChild(span);
		document.body.appendChild(btn);

		expect(getOwnVisibleText(btn)).toBe("Sign in");
	});

	it("prefers direct text nodes over full textContent fallback", () => {
		const div = document.createElement("div");
		div.appendChild(document.createTextNode("hello "));
		const span = document.createElement("span");
		span.textContent = "world";
		div.appendChild(span);
		document.body.appendChild(div);

		expect(getOwnVisibleText(div)).toBe("hello");
	});

	it("returns deeply nested text via fallback", () => {
		const div = document.createElement("div");
		const span = document.createElement("span");
		const em = document.createElement("em");
		em.textContent = "deep";
		span.appendChild(em);
		div.appendChild(span);
		document.body.appendChild(div);

		expect(getOwnVisibleText(div)).toBe("deep");
	});
});

describe("hidden file input inclusion", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("shouldInclude returns true for hidden input[type=file]", () => {
		const input = document.createElement("input");
		input.type = "file";
		input.hidden = true;
		document.body.appendChild(input);

		expect(shouldInclude(input)).toBe(true);
	});

	it("shouldInclude returns false for display:none non-file input", () => {
		const input = document.createElement("input");
		input.type = "text";
		input.style.display = "none";
		document.body.appendChild(input);

		expect(shouldInclude(input)).toBe(false);
	});

	it("inline snapshot includes hidden file input with accept and filesCount", () => {
		const label = document.createElement("label");
		const input = document.createElement("input");
		input.type = "file";
		input.hidden = true;
		input.setAttribute("accept", ".pdf");
		const button = document.createElement("button");
		button.textContent = "Upload";
		label.appendChild(input);
		label.appendChild(button);
		document.body.appendChild(label);

		const result = collectInlineSnapshot(100);
		const fileNode = result.nodes.find((n) => n.tag === "input");
		expect(fileNode).toBeDefined();
		expect(fileNode!.accept).toBe(".pdf");
		expect(fileNode!.filesCount).toBe(0);
		expect(fileNode!.refId).toMatch(/^e\d+$/);
	});

	it("inline snapshot excludes display:none non-file input", () => {
		const div = document.createElement("div");
		const input = document.createElement("input");
		input.type = "text";
		input.style.display = "none";
		div.appendChild(input);
		document.body.appendChild(div);

		const result = collectInlineSnapshot(100);
		const inputNode = result.nodes.find((n) => n.tag === "input");
		expect(inputNode).toBeUndefined();
	});
});
