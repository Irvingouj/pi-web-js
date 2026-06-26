import { beforeEach, describe, expect, it } from "vitest";
import { collectInlineSnapshot } from "../src/shared/cross/collect-inline-snapshot.js";
import {
	getOwnVisibleText,
	hasDirectTextContent,
	isMarkdownVisible,
	shouldInclude,
} from "../src/shared/cs/snapshot-dom.js";

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

	it("includes presentation role with visible direct text", () => {
		const decorative = document.createElement("span");
		decorative.setAttribute("role", "presentation");
		decorative.textContent = "decorative";
		document.body.appendChild(decorative);

		// role=presentation/none suppresses AT semantics but the text IS
		// visually visible — snapshot must capture it.
		expect(isMarkdownVisible(decorative)).toBe(true);
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

	it("inline snapshot includes visible telephone inputs", () => {
		const fieldset = document.createElement("fieldset");
		const legend = document.createElement("legend");
		legend.textContent = "Phone";
		const input = document.createElement("input");
		input.type = "tel";
		input.setAttribute("aria-label", "Phone");
		input.value = "+1-289-788-6925";
		fieldset.appendChild(legend);
		fieldset.appendChild(input);
		document.body.appendChild(fieldset);

		const result = collectInlineSnapshot(100);
		const phoneNode = result.nodes.find(
			(n) => n.tag === "input" && n.name === "Phone",
		);
		expect(phoneNode).toMatchObject({
			role: "textbox",
			tag: "input",
			value: "+1-289-788-6925",
		});
	});

	it("inline snapshot includes invalid hidden validation proxies", () => {
		const input = document.createElement("input");
		input.required = true;
		input.setAttribute("aria-hidden", "true");
		document.body.appendChild(input);

		const result = collectInlineSnapshot(100);
		const proxyNode = result.nodes.find((n) => n.tag === "input");
		expect(proxyNode).toMatchObject({
			role: "textbox",
			required: true,
			valid: false,
			invalid: true,
		});
		expect(proxyNode!.validationMessage).toBeTruthy();
	});

	it("inline snapshot shows linked visible field errors", () => {
		const label = document.createElement("label");
		label.htmlFor = "question";
		label.textContent = "Question";
		const input = document.createElement("input");
		input.id = "question";
		input.required = true;
		input.setAttribute("aria-label", "Question");
		input.setAttribute("aria-invalid", "true");
		input.setAttribute("aria-errormessage", "question-error");
		input.setAttribute("aria-describedby", "question-error");
		const error = document.createElement("p");
		error.id = "question-error";
		error.textContent = "This field is required.";
		document.body.append(label, input, error);

		const result = collectInlineSnapshot(100);
		const inputNode = result.nodes.find((n) => n.tag === "input");
		const errorNode = result.nodes.find((n) => n.tag === "p");
		expect(inputNode).toMatchObject({
			name: "Question",
			required: true,
			invalid: true,
			errorMessage: "This field is required.",
		});
		expect(errorNode?.name).toBe("This field is required.");
		expect(result.text).toContain('error="This field is required."');
		expect(result.text).toContain('"This field is required."');
	});

	it("inline snapshot makes dropdown controls obvious", () => {
		const input = document.createElement("input");
		input.setAttribute("role", "combobox");
		input.setAttribute("aria-label", "Degree");
		input.setAttribute("aria-expanded", "true");
		input.setAttribute("aria-controls", "degree-listbox");
		document.body.appendChild(input);

		const result = collectInlineSnapshot(100);
		const node = result.nodes.find((n) => n.role === "combobox");
		expect(node).toMatchObject({
			controlType: "dropdown",
			recommendedAction: "select_option",
			controls: "degree-listbox",
			expanded: true,
		});
		expect(result.text).toContain('- dropdown "Degree"');
		expect(result.text).toContain('opens="degree-listbox"');
		expect(result.text).toContain('use="select_option"');
	});
});

describe("role=presentation visible text", () => {
	it("text inside role=presentation element appears in snapshot text", () => {
		document.body.innerHTML = '<div role="presentation">This field is required.</div>';
		const result = collectInlineSnapshot(100);
		expect(result.text).toContain("This field is required.");
	});

	it("text inside role=none element appears in snapshot text", () => {
		document.body.innerHTML = '<span role="none">Required</span>';
		const result = collectInlineSnapshot(100);
		expect(result.text).toContain("Required");
	});

	it("role=presentation wrapper with text in child still captures text via child", () => {
		document.body.innerHTML =
			'<div role="presentation"><span>Error: pick a value</span></div>';
		const result = collectInlineSnapshot(100);
		expect(result.text).toContain("Error: pick a value");
	});
});
