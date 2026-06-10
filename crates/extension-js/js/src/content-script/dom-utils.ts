import {
	labelNotFoundError,
	notInteractableError,
	staleRefError,
	throwStructuredAgentError,
} from "../shared/registry/normalize-agent-error.js";
import {
	INTERACTIVE_SELECTOR,
	enrichFormNode,
	getAccessibleName,
	getAccessibleRole,
	shouldInclude,
} from "../shared/snapshot-dom.js";

export {
	enrichFormNode,
	getAccessibleName,
	getAccessibleRole,
	shouldInclude,
};

/**
 * Find an element by its opaque reference ID.
 * @param refId — opaque element ref in 'e{N}' format (e.g. 'e2'). Must match schema regex ^e\d+$.
 */
export function getElementByRefId(refId: string): Element | null {
	return document.querySelector(`[data-ref-id='${CSS.escape(refId)}']`);
}

export function assertInteractable(el: Element, action: string): void {
	if (
		(el as HTMLElement).hasAttribute("disabled") ||
		(el as HTMLElement).getAttribute("aria-disabled") === "true"
	) {
		const refId = el.getAttribute("data-ref-id") || undefined;
		throwStructuredAgentError(
			notInteractableError(action, refId ?? "", { reason: "disabled" }),
		);
	}
}

export function findElementByLabel(query: string): Element | null {
	const lowerQuery = query.toLowerCase().trim();
	if (!lowerQuery) return null;
	const all = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));
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
	const all = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));
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

export type SemanticCandidate = {
	refId: string;
	role?: string;
	name?: string;
};

export function findSemanticCandidates(query: string): SemanticCandidate[] {
	const lowerQuery = query.toLowerCase().trim();
	if (!lowerQuery) return [];
	const all = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));
	const matches: SemanticCandidate[] = [];
	for (const el of all) {
		const ariaLabel = el.getAttribute("aria-label");
		const placeholder = (el as HTMLInputElement).placeholder;
		const text = el.textContent?.trim() || "";
		const haystacks = [ariaLabel, placeholder, text].filter(Boolean) as string[];
		if (!haystacks.some((h) => h.toLowerCase().includes(lowerQuery))) {
			continue;
		}
		const refId = el.getAttribute("data-ref-id");
		if (!refId) continue;
		matches.push({
			refId,
			role: getAccessibleRole(el),
			name: getAccessibleName(el) || undefined,
		});
		if (matches.length >= 5) break;
	}
	return matches;
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

export function findCandidatesByRefId(refId: string): SemanticCandidate[] {
	// Try to find the original element to determine similarity criteria
	const original = document.querySelector(
		`[data-ref-id='${CSS.escape(refId)}']`,
	);
	let targetTagName: string | undefined;
	let targetRole: string | undefined;

	if (original) {
		targetTagName = original.tagName.toLowerCase();
		targetRole = getAccessibleRole(original);
	}

	const all = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));
	const matches: SemanticCandidate[] = [];
	for (const el of all) {
		const elRefId = el.getAttribute("data-ref-id");
		if (!elRefId) continue;

		// If we know the original element's properties, filter by similarity
		if (targetTagName || targetRole) {
			const elTagName = el.tagName.toLowerCase();
			const elRole = getAccessibleRole(el);
			if (elTagName !== targetTagName && elRole !== targetRole) {
				continue;
			}
		}

		matches.push({
			refId: elRefId,
			role: getAccessibleRole(el),
			name: getAccessibleName(el) || undefined,
		});
		if (matches.length >= 5) break;
	}
	return matches;
}

export function throwElementNotFound(
	refId: string | undefined,
	label: string | undefined,
	includeCandidates = false,
): never {
	if (refId) {
		const candidates = includeCandidates ? findCandidatesByRefId(refId) : [];
		throwStructuredAgentError(staleRefError(refId, { candidates }));
	}
	if (label) {
		const candidates = includeCandidates ? findSemanticCandidates(label) : [];
		throwStructuredAgentError(labelNotFoundError(label, candidates));
	}
	throwStructuredAgentError({
		message: "Element not found",
		code: "E_NOT_FOUND",
		category: "resource",
	});
}
