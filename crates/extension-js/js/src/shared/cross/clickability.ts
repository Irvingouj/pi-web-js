// Click-stability logic adapted from Vimium (https://github.com/philc/vimium)
// Copyright (c) Phil Crosby, Ilya Sukhar. MIT License.
// See: content_scripts/link_hints.js (getLocalHintsForElement).
// Agent-scenario adaptation: confidence is returned as a typed field instead
// of Vimium's internal possibleFalsePositive/secondClassCitizen booleans.

export type ClickabilityConfidence = "high" | "low";
export type ClickabilityReason =
	| "role"
	| "onclick"
	| "jsaction"
	| "native"
	| "contenteditable"
	| "tabindex"
	| "buttonClass"
	| "span";
export type ClickabilityAssessment = {
	clickable: boolean;
	confidence: ClickabilityConfidence;
	reason?: ClickabilityReason;
};

const CLICKABLE_ROLES = new Set([
	"button",
	"tab",
	"link",
	"checkbox",
	"menuitem",
	"menuitemcheckbox",
	"menuitemradio",
	"radio",
	"textbox",
]);

function isSelfOrAncestorHidden(el: Element): boolean {
	let node: Element | null = el;
	while (node) {
		if ((node as HTMLElement).hidden) return true;
		if (node.getAttribute("aria-hidden") === "true") return true;
		if ((node as HTMLElement).inert) return true;
		const style = window.getComputedStyle(node);
		if (style.display === "none" || style.visibility === "hidden") return true;
		node = node.parentElement;
	}
	return false;
}

function hasClickJsAction(el: Element): boolean {
	const jsaction = el.getAttribute("jsaction");
	if (!jsaction) return false;
	for (const rawRule of jsaction.split(";")) {
		const rule = rawRule.trim();
		if (!rule) continue;
		const parts = rule.split(":");
		const eventName = parts.length === 1 ? "click" : parts[0]?.trim();
		const actionName =
			(parts.length === 1 ? parts[0] : parts[1])?.trim() ?? "";
		if (eventName !== "click") continue;
		if (
			!actionName ||
			actionName.startsWith("none.") ||
			actionName.endsWith("._")
		)
			continue;
		if (actionName.includes(".")) return true;
	}
	return false;
}

function hasButtonClass(el: Element): boolean {
	const className = el.getAttribute("class")?.toLowerCase();
	return (
		className?.includes("button") === true ||
		className?.includes("btn") === true
	);
}

function isEnabledNativeControl(el: Element): boolean {
	if (el instanceof HTMLButtonElement || el instanceof HTMLSelectElement) {
		return !el.disabled;
	}
	if (el instanceof HTMLTextAreaElement) {
		return !el.disabled && !el.readOnly;
	}
	if (el instanceof HTMLInputElement) {
		return el.type !== "hidden" && !el.disabled;
	}
	if (el instanceof HTMLAnchorElement) {
		return el.hasAttribute("href");
	}
	return false;
}

function isContentEditable(el: Element): boolean {
	const value = el.getAttribute("contenteditable");
	return (
		value !== null &&
		(value === "" ||
			value.toLowerCase() === "true" ||
			value.toLowerCase() === "contenteditable")
	);
}

function hasNonNegativeTabIndex(el: Element): boolean {
	const value = el.getAttribute("tabindex");
	if (value === null) return false;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed >= 0;
}

export function assessClickability(el: Element): ClickabilityAssessment {
	// Short-circuit: hidden or aria-disabled elements are never clickable.
	if (isSelfOrAncestorHidden(el)) return { clickable: false, confidence: "low" };
	if (el.getAttribute("aria-disabled") === "true") {
		return { clickable: false, confidence: "low" };
	}

	let out: ClickabilityAssessment = { clickable: false, confidence: "low" };

	const role = el.getAttribute("role");
	if (role && CLICKABLE_ROLES.has(role.toLowerCase())) {
		out = { clickable: true, confidence: "high", reason: "role" };
	} else if (el.getAttribute("onclick") || (el as HTMLElement).onclick) {
		out = { clickable: true, confidence: "high", reason: "onclick" };
	} else if (hasClickJsAction(el)) {
		out = { clickable: true, confidence: "high", reason: "jsaction" };
	} else if (isContentEditable(el)) {
		out = { clickable: true, confidence: "high", reason: "contenteditable" };
	} else if (hasNonNegativeTabIndex(el)) {
		out = { clickable: true, confidence: "high", reason: "tabindex" };
	} else if (isEnabledNativeControl(el)) {
		out = { clickable: true, confidence: "high", reason: "native" };
	} else if (hasButtonClass(el)) {
		out = { clickable: true, confidence: "low", reason: "buttonClass" };
	}

	// span elements are often wrappers for real buttons; downgrade to low
	if (out.clickable && el.tagName.toLowerCase() === "span") {
		out = { clickable: true, confidence: "low", reason: "span" };
	}

	return out;
}

// ---------------------------------------------------------------------------
// Descendant deduplication — adapted from Vimium link_hints.js:1362-1386
// ---------------------------------------------------------------------------
// Vimium reverses its hint array so descendants appear before ancestors,
// then scans "backward" to find ancestor relationships. Our array is DFS
// pre-order (ancestors before descendants), so we scan FORWARD for each
// low-confidence node to check whether it is a wrapper around a later
// descendant that is also clickable.
//
// descendantsToCheck = [1,2,3]: walk up to 3 parent levels from candidate.
// lookbackWindow = 6: only check up to 6 positions ahead for performance.

export function deduplicateWrappers(
	items: Array<{ el: Element; confidence: ClickabilityConfidence }>,
): Set<Element> {
	const descendantsToCheck = [1, 2, 3];
	const lookbackWindow = 6;
	const toRemove = new Set<Element>();

	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		if (item.confidence !== "low") continue;

		// Scan forward: ancestors are before descendants in our pre-order array.
		const end = Math.min(items.length, i + 1 + lookbackWindow);
		for (let j = i + 1; j < end; j++) {
			let candidate: Element | null = items[j].el;
			for (const _ of descendantsToCheck) {
				candidate = candidate?.parentElement ?? null;
				if (candidate === item.el) {
					toRemove.add(item.el);
					break;
				}
			}
			if (toRemove.has(item.el)) break;
		}
	}

	return toRemove;
}
