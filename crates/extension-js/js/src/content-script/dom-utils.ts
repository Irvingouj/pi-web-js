/**
 * Find an element by its opaque reference ID.
 * @param refId — opaque element ref in 'e{N}' format (e.g. 'e2'). Must match schema regex ^e\d+$.
 */
export function getElementByRefId(refId: string): Element | null {
	return document.querySelector(`[data-ref-id='${CSS.escape(refId)}']`);
}

export function findElementByLabel(query: string): Element | null {
	const lowerQuery = query.toLowerCase().trim();
	if (!lowerQuery) return null;
	const all = Array.from(
		document.querySelectorAll(
			'input, textarea, select, button, a, [role="button"], [role="link"]',
		),
	);
	for (const el of all) {
		const ariaLabel = el.getAttribute("aria-label");
		if (ariaLabel && ariaLabel.toLowerCase().trim() === lowerQuery) return el;
		const placeholder = (el as HTMLInputElement).placeholder;
		if (placeholder && placeholder.toLowerCase().trim() === lowerQuery)
			return el;
		const id = el.id;
		if (id) {
			const label = document.querySelector(`label[for='${CSS.escape(id)}']`);
			if (label && label.textContent?.trim().toLowerCase() === lowerQuery)
				return el;
		}
		const parentLabel = el.closest("label");
		if (
			parentLabel &&
			parentLabel.textContent?.trim().toLowerCase() === lowerQuery
		)
			return el;
		const text = el.textContent?.trim().toLowerCase() || "";
		if (text === lowerQuery) return el;
	}
	return null;
}

export function findCandidateLabels(query: string): string[] {
	const lowerQuery = query.toLowerCase().trim();
	const candidates = new Set<string>();
	const all = Array.from(
		document.querySelectorAll(
			'input, textarea, select, button, a, [role="button"], [role="link"]',
		),
	);
	for (const el of all) {
		const ariaLabel = el.getAttribute("aria-label");
		if (ariaLabel) candidates.add(ariaLabel.trim());
		const placeholder = (el as HTMLInputElement).placeholder;
		if (placeholder) candidates.add(placeholder.trim());
		const text = el.textContent?.trim() || "";
		if (text) candidates.add(text);
	}
	return Array.from(candidates)
		.filter((c) => c.toLowerCase().includes(lowerQuery))
		.slice(0, 5);
}

export function asRecord(obj: unknown): Record<string, unknown> {
	return typeof obj === "object" && obj !== null && !Array.isArray(obj)
		? (obj as Record<string, unknown>)
		: {};
}

export function getStringParam(params: unknown, key: string): string {
	const val = asRecord(params)[key];
	return typeof val === "string" ? val : "";
}

export function getNumberParam(
	params: unknown,
	key: string,
	fallback: number,
): number {
	const val = asRecord(params)[key];
	return typeof val === "number" ? val : fallback;
}

export function throwElementNotFound(
	refId: string | undefined,
	label: string | undefined,
	includeCandidates = false,
	code?: string,
): never {
	const mode = refId ? "refId" : label ? "label" : null;
	const query = refId || label;
	let msg = `Element not found${mode ? ` by ${mode} "${query}"` : ""}`;
	if (includeCandidates && query) {
		const candidates = findCandidateLabels(query);
		msg += `. Candidates: ${candidates.join(", ") || "none"}`;
	}
	const err = new Error(msg) as Error & { code?: string };
	if (code) err.code = code;
	throw err;
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

