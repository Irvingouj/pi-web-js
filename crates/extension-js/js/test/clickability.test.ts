import { beforeEach, describe, expect, it } from "vitest";
import {
	assessClickability,
	deduplicateWrappers,
} from "../src/shared/cross/clickability.js";
import type { ClickabilityConfidence } from "../src/shared/cross/clickability.js";

describe("assessClickability", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it.each(["click:ns.action", "ns.action"])(
		"jsaction %s is high-confidence clickable",
		(v) => {
			document.body.innerHTML = `<div jsaction="${v}">x</div>`;
			const a = assessClickability(document.querySelector("div")!);
			expect(a.clickable).toBe(true);
			expect(a.confidence).toBe("high");
			expect(a.reason).toBe("jsaction");
		},
	);

	it.each([
		"mousedown:ns.action",
		"click:ns._",
		"none",
		"ns:_",
	])("jsaction %s is NOT clickable", (v) => {
		document.body.innerHTML = `<div jsaction="${v}">x</div>`;
		expect(
			assessClickability(document.querySelector("div")!).clickable,
		).toBe(false);
	});

	it.each(["my-button", "primary-btn", "btn", "button"])(
		"class containing %s is low-confidence clickable",
		(cls) => {
			document.body.innerHTML = `<div class="${cls}">x</div>`;
			const a = assessClickability(document.querySelector("div")!);
			expect(a.clickable).toBe(true);
			expect(a.confidence).toBe("low");
			expect(a.reason).toBe("buttonClass");
		},
	);

	it("span with onclick is low-confidence", () => {
		document.body.innerHTML = `<span onclick="x">click</span>`;
		const a = assessClickability(document.querySelector("span")!);
		expect(a.clickable).toBe(true);
		expect(a.confidence).toBe("low");
		expect(a.reason).toBe("span");
	});

	it.each(["button", "link", "tab", "menuitem", "checkbox"])(
		"role=%s is high-confidence",
		(role) => {
			document.body.innerHTML = `<div role="${role}">x</div>`;
			const a = assessClickability(document.querySelector("div")!);
			expect(a.clickable).toBe(true);
			expect(a.confidence).toBe("high");
			expect(a.reason).toBe("role");
		},
	);

	it("onclick attr is high-confidence", () => {
		document.body.innerHTML = `<div onclick="x">x</div>`;
		const a = assessClickability(document.querySelector("div")!);
		expect(a.clickable).toBe(true);
		expect(a.confidence).toBe("high");
		expect(a.reason).toBe("onclick");
	});

	it("disabled button is not clickable", () => {
		document.body.innerHTML = `<button disabled>x</button>`;
		expect(
			assessClickability(document.querySelector("button")!).clickable,
		).toBe(false);
	});
	it("enabled button is high-confidence native", () => {
		document.body.innerHTML = `<button>x</button>`;
		const a = assessClickability(document.querySelector("button")!);
		expect(a.clickable).toBe(true);
		expect(a.confidence).toBe("high");
		expect(a.reason).toBe("native");
	});
	it("anchor without href is not clickable", () => {
		document.body.innerHTML = `<a name="anchor">x</a>`;
		expect(
			assessClickability(document.querySelector("a")!).clickable,
		).toBe(false);
	});
	it("anchor with href is high-confidence native", () => {
		document.body.innerHTML = `<a href="/x">x</a>`;
		const a = assessClickability(document.querySelector("a")!);
		expect(a.clickable).toBe(true);
		expect(a.reason).toBe("native");
	});
	it("native control with button-ish class is native, not buttonClass", () => {
		// Bootstrap/Tailwind/Material all apply btn/button classes to real buttons.
		// The native signal must win over the heuristic, else genuine buttons get
		// downgraded to low confidence and become eligible for wrongful dedup.
		document.body.innerHTML = `<button class="btn primary-btn">x</button>`;
		const a = assessClickability(document.querySelector("button")!);
		expect(a.clickable).toBe(true);
		expect(a.confidence).toBe("high");
		expect(a.reason).toBe("native");
	});
	it("anchor with href and btn class is native, not buttonClass", () => {
		document.body.innerHTML = `<a class="btn" href="/x">x</a>`;
		const a = assessClickability(document.querySelector("a")!);
		expect(a.clickable).toBe(true);
		expect(a.confidence).toBe("high");
		expect(a.reason).toBe("native");
	});

	it("aria-disabled is not clickable", () => {
		document.body.innerHTML = `<button aria-disabled="true">x</button>`;
		expect(
			assessClickability(document.querySelector("button")!).clickable,
		).toBe(false);
	});
	it("hidden ancestor short-circuits to not clickable", () => {
		document.body.innerHTML = `<div hidden><button>x</button></div>`;
		expect(
			assessClickability(document.querySelector("button")!).clickable,
		).toBe(false);
	});

	it("contenteditable is high-confidence", () => {
		document.body.innerHTML = `<div contenteditable>x</div>`;
		const a = assessClickability(document.querySelector("div")!);
		expect(a.clickable).toBe(true);
		expect(a.reason).toBe("contenteditable");
	});

	it("tabindex=0 is high-confidence", () => {
		document.body.innerHTML = `<div tabindex="0">x</div>`;
		const a = assessClickability(document.querySelector("div")!);
		expect(a.clickable).toBe(true);
		expect(a.reason).toBe("tabindex");
	});
	it("tabindex=-1 is not clickable", () => {
		document.body.innerHTML = `<div tabindex="-1">x</div>`;
		expect(
			assessClickability(document.querySelector("div")!).clickable,
		).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// deduplicateWrappers
// ---------------------------------------------------------------------------

describe("deduplicateWrappers", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("wrapper with clickable descendant is deduplicated", () => {
		document.body.innerHTML = `
			<span class="buttonWrapper"><a href="/x">clickable</a></span>
			<span class="buttonWrapper">clickable</span>`;
		const wrapperWithChild = document.body.children[0] as Element;
		const link = wrapperWithChild.children[0] as Element;
		const wrapperAlone = document.body.children[1] as Element;

		const items: Array<{
			el: Element;
			confidence: ClickabilityConfidence;
		}> = [
			{ el: wrapperWithChild, confidence: "low" },
			{ el: link, confidence: "high" },
			{ el: wrapperAlone, confidence: "low" },
		];

		const toRemove = deduplicateWrappers(items);
		expect(toRemove.has(wrapperWithChild)).toBe(true);
		expect(toRemove.has(link)).toBe(false);
		expect(toRemove.has(wrapperAlone)).toBe(false);
	});

	it("wrapper with descendant within 3 parent steps is deduplicated", () => {
		document.body.innerHTML = `
			<span class="buttonWrapper"><b><i><a href="/x">clickable</a></i></b></span>`;
		const wrapper = document.body.children[0] as Element;
		const link = wrapper.querySelector("a")!;

		const items: Array<{
			el: Element;
			confidence: ClickabilityConfidence;
		}> = [
			{ el: wrapper, confidence: "low" },
			{ el: link, confidence: "high" },
		];

		const toRemove = deduplicateWrappers(items);
		expect(toRemove.has(wrapper)).toBe(true);
	});

	it("wrapper with descendant beyond 3 parent steps is not deduplicated", () => {
		document.body.innerHTML = `
			<span class="buttonWrapper"><b><i><u><a href="/x">clickable</a></u></i></b></span>`;
		const wrapper = document.body.children[0] as Element;
		const link = wrapper.querySelector("a")!;

		const items: Array<{
			el: Element;
			confidence: ClickabilityConfidence;
		}> = [
			{ el: wrapper, confidence: "low" },
			{ el: link, confidence: "high" },
		];

		const toRemove = deduplicateWrappers(items);
		// a is 4 levels deep (span > b > i > u > a), beyond descendantsToCheck=[1,2,3]
		expect(toRemove.has(wrapper)).toBe(false);
	});

	it("descendant beyond lookbackWindow is not deduplicated", () => {
		// Create a wrapper, then 7 unrelated high-confidence items,
		// then the descendant (array positions: 0, 1-7, 8).
		// The descendant at position 8 is beyond the lookbackWindow of 6.
		const wrapper = document.createElement("span");
		wrapper.className = "buttonWrapper";
		const descendant = document.createElement("a");
		descendant.href = "/x";
		wrapper.appendChild(descendant);

		const unrelated = Array.from({ length: 7 }, () => {
			const span = document.createElement("span");
			span.setAttribute("onclick", "x");
			return span;
		});

		const items: Array<{
			el: Element;
			confidence: ClickabilityConfidence;
		}> = [
			{ el: wrapper, confidence: "low" },
			...unrelated.map((u) => ({ el: u, confidence: "high" as const })),
			{ el: descendant, confidence: "high" },
		];

		const toRemove = deduplicateWrappers(items);
		expect(toRemove.has(wrapper)).toBe(false);
	});

	it("high-confidence node is never deduplicated", () => {
		document.body.innerHTML = `
			<div role="button"><a href="/x">clickable</a></div>`;
		const parent = document.body.children[0] as Element;
		const link = parent.querySelector("a")!;

		const items: Array<{
			el: Element;
			confidence: ClickabilityConfidence;
		}> = [
			{ el: parent, confidence: "high" },
			{ el: link, confidence: "high" },
		];

		const toRemove = deduplicateWrappers(items);
		expect(toRemove.has(parent)).toBe(false);
	});

	it("empty array returns empty set", () => {
		expect(deduplicateWrappers([]).size).toBe(0);
	});

	it("wrapper at exact window edge is deduplicated", () => {
		// Wrapper at 0, 6 intermediate items (positions 1-6), descendant at 7.
		// Window is i+1 to i+6 inclusive → positions 1-6 checked, position 7 NOT checked.
		// So descendant at position 7 is beyond window.
		const wrapper = document.createElement("span");
		wrapper.className = "buttonWrapper";
		const descendant = document.createElement("a");
		descendant.href = "/x";
		wrapper.appendChild(descendant);

		// 6 unrelated items → window covers positions 1 through 6
		const unrelated = Array.from({ length: 6 }, () => {
			const span = document.createElement("span");
			span.setAttribute("onclick", "x");
			return span;
		});

		const items: Array<{
			el: Element;
			confidence: ClickabilityConfidence;
		}> = [
			{ el: wrapper, confidence: "low" },
			...unrelated.map((u) => ({ el: u, confidence: "high" as const })),
			{ el: descendant, confidence: "high" },
		];

		const toRemove = deduplicateWrappers(items);
		expect(toRemove.has(wrapper)).toBe(false);
	});
});
