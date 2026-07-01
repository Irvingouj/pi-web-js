import { beforeEach, describe, expect, it } from "vitest";
import { collectInlineSnapshot } from "../src/shared/cross/collect-inline-snapshot.js";
import {
	getAccessibleRole,
	getOwnVisibleText,
	hasDirectTextContent,
	isMarkdownVisible,
	isReachableClickTarget,
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

	it("inline snapshot includes Gmail-style jsaction controls by aria-label", () => {
		const archive = document.createElement("div");
		archive.setAttribute("jsaction", "click:mail.archive");
		archive.setAttribute("aria-label", "Archive");
		document.body.appendChild(archive);

		const result = collectInlineSnapshot(100);
		const node = result.nodes.find((n) => n.name === "Archive");
		expect(node).toMatchObject({
			role: "generic",
			tag: "div",
			actionable: true,
			recommendedAction: "click",
		});
		expect(node?.refId).toMatch(/^e\d+$/);
	});

	it("inline snapshot includes icon-only tabindex controls by aria-label", () => {
		const button = document.createElement("span");
		button.setAttribute("tabindex", "0");
		button.setAttribute("aria-label", "More");
		document.body.appendChild(button);

		const result = collectInlineSnapshot(100);
		const node = result.nodes.find((n) => n.name === "More");
		expect(node).toMatchObject({
			role: "generic",
			tag: "span",
			actionable: true,
			recommendedAction: "click",
		});
	});

	it("inline snapshot includes ARIA menu and tab controls", () => {
		document.body.innerHTML = `
			<div role="menuitem" aria-label="Mark as read"></div>
			<div role="tab" aria-label="Promotions"></div>
		`;

		const result = collectInlineSnapshot(100);
		expect(result.nodes.find((n) => n.name === "Mark as read")).toMatchObject({
			role: "menuitem",
			actionable: true,
			recommendedAction: "click",
		});
		expect(result.nodes.find((n) => n.name === "Promotions")).toMatchObject({
			role: "tab",
			actionable: true,
			recommendedAction: "click",
		});
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
		document.body.innerHTML =
			'<div role="presentation">This field is required.</div>';
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

describe("getAccessibleRole decoupled from clickability", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("contenteditable is not labeled button", () => {
		document.body.innerHTML = `<div contenteditable data-ref-id="e1">edit me</div>`;
		const el = document.querySelector("div")!;
		expect(getAccessibleRole(el)).not.toBe("button");
	});

	it("tabindex element is not labeled button", () => {
		document.body.innerHTML = `<div tabindex="0" data-ref-id="e1">focusable</div>`;
		const el = document.querySelector("div")!;
		expect(getAccessibleRole(el)).not.toBe("button");
	});
});

describe("enrichClickAction confidence and dropdown (WU5)", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("renders checkbox checked state in snapshot text", () => {
		document.body.innerHTML = `
			<label><input type="checkbox" checked />Allow npm publish</label>
			<label><input type="checkbox" />Allow npm stage publish</label>
		`;
		const snap = collectInlineSnapshot(100);

		expect(snap.text).toContain("checkbox");
		expect(snap.text).toContain("checked=true");
		expect(snap.text).toContain("checked=false");
	});

	it("combobox recommendedAction stays select_option", () => {
		document.body.innerHTML = `<div role="combobox" aria-expanded="false" tabindex="0">x</div>`;
		const snap = collectInlineSnapshot(100);
		const node = snap.nodes.find((n) => n.role === "combobox")!;
		expect(node).toBeDefined();
		expect(node.controlType).toBe("dropdown");
		expect(node.recommendedAction).toBe("select_option");
	});

	it("native button with btn class stays actionable (not deduped)", () => {
		// Regression: <button class="btn"> must be native high-confidence,
		// not downgraded to buttonClass low — otherwise dedup could drop it.
		document.body.innerHTML = `<span class="btn-group"><button class="btn primary-btn" data-ref-id="b">Go</button></span>`;
		const snap = collectInlineSnapshot(100);
		const btn = snap.nodes.find((n) => n.tag === "button")!;
		expect(btn).toBeDefined();
		expect(btn.actionable).toBe(true);
		expect(btn.recommendedAction).toBe("click");
	});
	it("deduplicated wrapper does not render use=click (no contradicting signal)", () => {
		// A wrapper marked actionable=false must not also advertise use="click";
		// the contradictory signal misleads any consumer that keys off use=.
		document.body.innerHTML = `<span class="btn-group"><a href="/x" data-ref-id="a">link</a></span>`;
		const snap = collectInlineSnapshot(100);
		const wrapper = snap.nodes.find((n) => n.tag === "span");
		expect(wrapper).toBeDefined();
		expect(wrapper!.actionable).toBe(false);
		expect(wrapper!.recommendedAction).toBeUndefined();
		// Rendered line must not carry use="click" alongside actionable=false
		const wrapperLine = snap.text.split("\n").find((l) => l.includes(wrapper!.refId));
		expect(wrapperLine).toBeDefined();
		expect(wrapperLine!).not.toContain("use=");
		expect(wrapperLine!).toContain("actionable=false");
	});
});

describe("isReachableClickTarget (WU7)", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("off-screen element is reachable (agent will scroll)", () => {
		// Rect fully outside the jsdom viewport (innerWidth=1024/innerHeight=768):
		// every sample point fails the viewport bounds check, hadOnScreenPoint
		// stays false, and isReachableClickTarget returns true — the agent is
		// expected to scroll into view before acting. No elementFromPoint stub
		// is needed: the viewport-bounds branch decides before it would be called.
		document.body.innerHTML = `<button data-ref-id="e1">x</button>`;
		const btn = document.querySelector("button")!;
		btn.getClientRects = () => [
			{
				left: 9999,
				top: 9999,
				width: 10,
				height: 10,
				right: 10009,
				bottom: 10009,
			} as DOMRect,
		];
		expect(isReachableClickTarget(btn)).toBe(true);
	});

	it("occluded on-screen element is not reachable", () => {
		document.body.innerHTML = `
			<button data-ref-id="e1" style="position:absolute;left:10px;top:10px;width:20px;height:20px;">x</button>
			<div style="position:absolute;left:0;top:0;width:100px;height:100px;z-index:9;">cover</div>`;
		const btn = document.querySelector("button")!;
		btn.getClientRects = () => [{left:10,top:10,width:20,height:20,right:30,bottom:30} as DOMRect];
		const cover = document.querySelector("div")!;
		const orig = document.elementFromPoint;
		document.elementFromPoint = (() => cover) as typeof document.elementFromPoint;
		try {
			expect(isReachableClickTarget(btn)).toBe(false);
		} finally {
			document.elementFromPoint = orig;
		}
	});
});
