/** Shared DOM helpers for inline snapshots (content script + MAIN-world injection). */

import { allocateRefId } from "./ref-id.js";

export {
	allocateRefId,
	getNextRefId,
	syncRefIdCounterFromDom,
} from "./ref-id.js";

export const INTERACTIVE_SELECTOR =
	'input, textarea, select, button, a, [role="button"], [role="link"]';

const EXCLUDED_TAGS = new Set(["script", "style", "noscript", "template"]);

const MARKDOWN_TEXT_TAGS = new Set([
	"p",
	"span",
	"label",
	"footer",
	"header",
	"blockquote",
	"pre",
	"code",
	"figcaption",
	"td",
	"th",
	"li",
	"em",
	"strong",
	"small",
	"cite",
	"q",
	"mark",
	"time",
	"abbr",
	"dfn",
	"kbd",
	"samp",
	"var",
	"sub",
	"sup",
]);

export function readFormFields(el: Element): {
	value?: string;
	checked?: boolean;
	disabled?: boolean;
	readOnly?: boolean;
	selected?: boolean;
	required?: boolean;
	valid?: boolean;
	invalid?: boolean;
	validationMessage?: string;
	errorMessage?: string;
} {
	const out: {
		value?: string;
		checked?: boolean;
		disabled?: boolean;
		readOnly?: boolean;
		selected?: boolean;
		required?: boolean;
		valid?: boolean;
		invalid?: boolean;
		validationMessage?: string;
		errorMessage?: string;
	} = {};
	if (el instanceof HTMLInputElement) {
		if (el.type !== "password" && el.type !== "hidden") {
			out.value = el.value;
		}
		if (el.type === "checkbox" || el.type === "radio") {
			out.checked = el.checked;
		}
		out.disabled = el.disabled;
		out.readOnly = el.readOnly;
		enrichValidity(el, out);
	} else if (el instanceof HTMLTextAreaElement) {
		out.value = el.value;
		out.disabled = el.disabled;
		out.readOnly = el.readOnly;
		enrichValidity(el, out);
	} else if (el instanceof HTMLSelectElement) {
		if (el.multiple) {
			// For <select multiple>, el.value only returns the first selected
			// option. Expose all selected values joined by comma so agents can
			// verify multi-select state from snapshot_data.
			const selected: string[] = [];
			for (const opt of Array.from(el.options)) {
				if (opt.selected) selected.push(opt.value);
			}
			out.value = selected.join(",");
		} else {
			out.value = el.value;
		}
		out.disabled = el.disabled;
		enrichValidity(el, out);
	} else if (el instanceof HTMLOptionElement) {
		// Expose value + selected so agents can read the valid option values
		// of a <select> (single or multiple) from snapshot_data and feed them
		// directly to page.select (string or string[]). Without this, the
		// snapshot shows the option's visible text but not its underlying value,
		// forcing agents to guess value vs text.
		out.value = el.value;
		out.selected = el.selected;
		out.disabled = el.disabled;
	}
	return out;
}

function enrichValidity(
	el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
	out: {
		required?: boolean;
		valid?: boolean;
		invalid?: boolean;
		validationMessage?: string;
		errorMessage?: string;
	},
): void {
	const required = el.required || el.getAttribute("aria-required") === "true";
	const ariaInvalid = el.getAttribute("aria-invalid") === "true";
	const valid = !ariaInvalid && el.checkValidity();
	if (required) out.required = true;
	out.valid = valid;
	out.invalid = !valid;
	const errorMessage = readErrorMessage(el);
	if (errorMessage) {
		out.errorMessage = errorMessage;
	}
	if (!valid && el.validationMessage) {
		out.validationMessage = el.validationMessage;
	}
}

export function readErrorMessage(el: Element): string | undefined {
	const ids = [
		...(el.getAttribute("aria-errormessage") || "").split(/\s+/),
		...(el.getAttribute("aria-describedby") || "").split(/\s+/),
	].filter(Boolean);
	for (const id of ids) {
		const msgEl = document.getElementById(id);
		if (!msgEl) continue;
		const msg = msgEl.textContent?.trim();
		if (!msg) continue;
		// Return text from alert/live regions unconditionally — they are
		// validation error containers by convention.
		const role = msgEl.getAttribute("role");
		const ariaLive = msgEl.getAttribute("aria-live");
		if (role === "alert" || (ariaLive && ariaLive !== "off")) return msg;
		// For other elements, only return if the text looks like an error.
		if (/error|required|select|please|invalid/i.test(msg)) return msg;
	}
	return undefined;
}

export function enrichFormNode(
	el: Element,
	node: {
		value?: string;
		checked?: boolean;
		disabled?: boolean;
		readOnly?: boolean;
		selected?: boolean;
		required?: boolean;
		valid?: boolean;
		invalid?: boolean;
		validationMessage?: string;
		errorMessage?: string;
	},
): void {
	const tag = el.tagName.toLowerCase();
	if (
		tag !== "input" &&
		tag !== "textarea" &&
		tag !== "select" &&
		tag !== "option"
	) {
		return;
	}
	Object.assign(node, readFormFields(el));
}

const ALLOWED_URL_SCHEMES = new Set(["http:", "https:", "file:"]);

export function resolveAbsoluteUrl(attr: string | null): string | undefined {
	if (!attr) return undefined;
	try {
		const url = new URL(attr, window.location.href);
		if (ALLOWED_URL_SCHEMES.has(url.protocol)) {
			return url.href;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

export function resolveContainerRefId(el: Element): string | undefined {
	const container = el.closest("article[data-post-id], [data-post-id]");
	if (!container) return undefined;
	return allocateRefId(container);
}

export function resolvePermalinkLink(el: Element): HTMLAnchorElement | null {
	const scoped = el.querySelector(
		":scope > h2 a[href], a[data-permalink], a[rel='permalink']",
	);
	if (scoped instanceof HTMLAnchorElement) return scoped;
	const fallback = el.querySelector("a[href]");
	return fallback instanceof HTMLAnchorElement ? fallback : null;
}

export function getAccessibleRole(el: Element): string {
	const tag = el.tagName.toLowerCase();
	const ariaRole = el.getAttribute("role");
	if (ariaRole) return ariaRole;
	if (
		tag === "button" ||
		(tag === "input" && (el as HTMLInputElement).type === "submit")
	)
		return "button";
	if (tag === "a") return "link";
	if (tag === "input") {
		const type = (el as HTMLInputElement).type;
		if (
			type === "text" ||
			type === "email" ||
			type === "password" ||
			type === "search" ||
			type === "tel"
		)
			return "textbox";
		if (type === "checkbox") return "checkbox";
		if (type === "radio") return "radio";
		if (type === "submit" || type === "button") return "button";
	}
	if (tag === "textarea") return "textbox";
	if (tag === "select") return "combobox";
	if (tag === "img") return "img";
	if (
		tag === "h1" ||
		tag === "h2" ||
		tag === "h3" ||
		tag === "h4" ||
		tag === "h5" ||
		tag === "h6"
	)
		return "heading";
	if (tag === "li") return "listitem";
	if (tag === "ul" || tag === "ol") return "list";
	if (tag === "table") return "table";
	if (tag === "tr") return "row";
	if (tag === "td" || tag === "th") return "cell";
	if (tag === "nav") return "navigation";
	if (tag === "main") return "main";
	if (tag === "article") return "article";
	if (tag === "section") return "region";
	if (tag === "aside") return "complementary";
	if (tag === "form") return "form";
	if (tag === "dialog" || tag === "modal") return "dialog";
	if (tag === "figure") return "figure";
	if (tag === "figcaption") return "caption";
	if (el.getAttribute("onclick") || (el as HTMLElement).onclick)
		return "button";
	return "generic";
}

export function hasDirectTextContent(el: Element): boolean {
	for (const child of el.childNodes) {
		if (child.nodeType === Node.TEXT_NODE) {
			const text = child.textContent?.trim();
			if (text) return true;
		}
	}
	return false;
}

export function getOwnVisibleText(el: Element, maxLen = 60): string {
	const parts: string[] = [];
	for (const child of el.childNodes) {
		if (child.nodeType === Node.TEXT_NODE) {
			const text = child.textContent?.trim();
			if (text) parts.push(text);
		}
	}
	if (parts.length > 0) {
		return parts.join(" ").slice(0, maxLen);
	}
	const full = el.textContent?.trim();
	return full ? full.slice(0, maxLen) : "";
}

export function isSelfOrAncestorHidden(el: Element): boolean {
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

function isHiddenElement(el: Element): boolean {
	return isSelfOrAncestorHidden(el);
}

/** Include if the element would remain visible in a Markdown rendering. */
export function isMarkdownVisible(el: Element): boolean {
	const tag = el.tagName.toLowerCase();
	if (EXCLUDED_TAGS.has(tag)) return false;
	if (isHiddenElement(el)) return false;

	const role = getAccessibleRole(el);
	const isPresentational = role === "presentation" || role === "none";
	if (role !== "generic" && !isPresentational) return true;

	const ariaLive = el.getAttribute("aria-live");
	if (ariaLive && ariaLive !== "off") return true;
	const explicitRole = el.getAttribute("role");
	if (explicitRole === "status" || explicitRole === "alert") return true;

	const text = el.textContent?.trim() || "";
	if (!text) return false;
	if (MARKDOWN_TEXT_TAGS.has(tag)) return true;
	if (hasDirectTextContent(el)) return true;

	return false;
}

export function getAccessibleName(el: Element): string {
	const ariaLabel = el.getAttribute("aria-label");
	if (ariaLabel) return ariaLabel;

	const labelledBy = el.getAttribute("aria-labelledby");
	if (labelledBy) {
		const labelEl = document.getElementById(labelledBy);
		if (labelEl) return labelEl.textContent?.slice(0, 60) || "";
	}

	const tag = el.tagName.toLowerCase();
	if (tag === "img") {
		const alt = el.getAttribute("alt");
		if (alt) return alt;
	}

	const title = (el as HTMLElement).title;
	if (title) return title;

	const role = getAccessibleRole(el);
	if (
		role !== "generic" &&
		role !== "list" &&
		role !== "table" &&
		role !== "row" &&
		role !== "region" &&
		role !== "navigation" &&
		role !== "main"
	) {
		const text = el.textContent?.trim().slice(0, 60) || "";
		return text;
	}
	if (role === "generic" && isMarkdownVisible(el)) {
		const own = getOwnVisibleText(el);
		if (own) return own;
		const tag = el.tagName.toLowerCase();
		if (MARKDOWN_TEXT_TAGS.has(tag) || el.childElementCount === 0) {
			return el.textContent?.trim().slice(0, 60) || "";
		}
	}
	return "";
}

export function shouldInclude(el: Element): boolean {
	if (el instanceof HTMLInputElement && el.type === "file") return true;
	if (isInvalidFormControl(el)) return true;
	if (isValidationProxyInput(el)) return true;
	return isMarkdownVisible(el);
}

function isInvalidFormControl(el: Element): boolean {
	if (
		!(
			el instanceof HTMLInputElement ||
			el instanceof HTMLTextAreaElement ||
			el instanceof HTMLSelectElement
		)
	) {
		return false;
	}
	return !el.checkValidity() || el.getAttribute("aria-invalid") === "true";
}

/** Detect a hidden validation-shim input inside a combobox wrapper (react-select).
 *  These inputs carry required/aria-required for form validation but are not
 *  user-visible; they must appear in the snapshot labeled as validation-proxy. */
export function isValidationProxyInput(el: Element): boolean {
	if (!(el instanceof HTMLInputElement)) return false;
	if (el.closest('[role="combobox"]') === null) return false;
	const isHidden =
		el.type === "hidden" ||
		el.getAttribute("aria-hidden") === "true" ||
		el.tabIndex === -1;
	if (!isHidden) return false;
	return (
		el.required ||
		el.getAttribute("aria-required") === "true" ||
		(el.getAttribute("aria-describedby") || "").length > 0
	);
}

function safeCssEscape(s: string): string {
	return typeof CSS !== "undefined" && CSS.escape
		? CSS.escape(s)
		: s.replace(/["\\]/g, "\\$&");
}

/** Resolve a human-readable field label from <label> element associations.
 *  Tries: accessible name → label[for=id] → wrapping <label> → preceding sibling
 *  <label> → parent's first <label> child. Falls back to the refId. */
export function resolveFieldLabel(
	el: Element | null,
	fallback: string,
): string {
	if (el) {
		const id = el.getAttribute("id");
		if (id) {
			const label = document.querySelector(`label[for="${safeCssEscape(id)}"]`);
			if (label?.textContent?.trim()) return label.textContent.trim();
		}
		const wrapping = el.closest("label");
		if (wrapping?.textContent?.trim()) return wrapping.textContent.trim();
		const prev = el.previousElementSibling;
		if (prev?.tagName === "LABEL" && prev.textContent?.trim())
			return prev.textContent.trim();
		const parent = el.parentElement;
		if (parent) {
			const parentLabel = parent.querySelector("label");
			if (parentLabel?.textContent?.trim())
				return parentLabel.textContent.trim();
		}
	}
	return fallback;
}
