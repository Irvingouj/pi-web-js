/** Shared DOM helpers for inline snapshots (content script + MAIN-world injection). */

import { allocateRefId } from "./ref-id.js";

export { allocateRefId, getNextRefId, syncRefIdCounterFromDom } from "./ref-id.js";

export const INTERACTIVE_SELECTOR =
	'input, textarea, select, button, a, [role="button"], [role="link"]';

const EXCLUDED_TAGS = new Set([
	"script",
	"style",
	"noscript",
	"template",
]);

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
} {
	const out: {
		value?: string;
		checked?: boolean;
		disabled?: boolean;
		readOnly?: boolean;
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
	} else if (el instanceof HTMLTextAreaElement) {
		out.value = el.value;
		out.disabled = el.disabled;
		out.readOnly = el.readOnly;
	} else if (el instanceof HTMLSelectElement) {
		out.value = el.value;
		out.disabled = el.disabled;
	}
	return out;
}

export function enrichFormNode(
	el: Element,
	node: {
		value?: string;
		checked?: boolean;
		disabled?: boolean;
		readOnly?: boolean;
	},
): void {
	const tag = el.tagName.toLowerCase();
	if (tag !== "input" && tag !== "textarea" && tag !== "select") {
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
			type === "search"
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

function isHiddenElement(el: Element): boolean {
	if ((el as HTMLElement).hidden) return true;
	if (el.getAttribute("aria-hidden") === "true") return true;
	if ((el as HTMLElement).inert) return true;
	const style = window.getComputedStyle(el);
	return style.display === "none" || style.visibility === "hidden";
}

/** Include if the element would remain visible in a Markdown rendering. */
export function isMarkdownVisible(el: Element): boolean {
	const tag = el.tagName.toLowerCase();
	if (EXCLUDED_TAGS.has(tag)) return false;
	if (isHiddenElement(el)) return false;

	const role = getAccessibleRole(el);
	if (role === "presentation" || role === "none") return false;
	if (role !== "generic") return true;

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
	return isMarkdownVisible(el);
}
