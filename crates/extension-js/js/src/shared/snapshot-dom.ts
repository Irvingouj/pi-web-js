/** Shared DOM helpers for inline snapshots (content script + MAIN-world injection). */

export const INTERACTIVE_SELECTOR =
	'input, textarea, select, button, a, [role="button"], [role="link"]';

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
		out.value = el.value;
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
	node: Record<string, unknown>,
): void {
	const tag = el.tagName.toLowerCase();
	if (tag !== "input" && tag !== "textarea" && tag !== "select") {
		return;
	}
	Object.assign(node, readFormFields(el));
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
	return "";
}

export function shouldInclude(el: Element): boolean {
	const role = getAccessibleRole(el);
	if (role === "generic") return false;
	if (role === "presentation" || role === "none") return false;
	if ((el as HTMLElement).hidden) return false;
	const style = window.getComputedStyle(el);
	if (style.display === "none" || style.visibility === "hidden") return false;
	return true;
}
