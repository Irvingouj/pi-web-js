import {
	labelNotFoundError,
	notInteractableError,
	staleRefError,
	throwStructuredAgentError,
} from "../shared/cross/normalize-agent-error.js";
import {
	enrichFormNode,
	getAccessibleName,
	getAccessibleRole,
	INTERACTIVE_SELECTOR,
	isSelfOrAncestorHidden,
	shouldInclude,
} from "../shared/cs/snapshot-dom.js";
import { grantFromInlineSnapshot } from "./observation-lease.js";

export { enrichFormNode, getAccessibleName, getAccessibleRole, shouldInclude };

/**
 * Find an element by its opaque reference ID.
 * @param refId — opaque element ref in 'e{N}' format (e.g. 'e2'). Must match schema regex ^e\d+$.
 */
export function getElementByRefId(refId: string): Element | null {
	return document.querySelector(`[data-ref-id='${CSS.escape(refId)}']`);
}

export function assertInteractable(el: Element, action: string): void {
	const isDropdownControl =
		el instanceof HTMLSelectElement ||
		el.getAttribute("role") === "combobox" ||
		// Only classify a child of a combobox as a dropdown when it's a hidden
		// validation-proxy shim — a visible search input inside a combobox is a
		// textbox, not a dropdown, and suggesting select_option for it is wrong.
		(isSelfOrAncestorHidden(el) && el.closest('[role="combobox"]') !== null);
	const controlType = isDropdownControl ? "dropdown" : undefined;
	if (
		(el as HTMLElement).hasAttribute("disabled") ||
		(el as HTMLElement).getAttribute("aria-disabled") === "true"
	) {
		const refId = el.getAttribute("data-ref-id") || undefined;
		throwStructuredAgentError(
			notInteractableError(action, refId ?? "", {
				reason: "disabled",
				...(controlType ? { controlType } : {}),
			}),
		);
	}
	if (isSelfOrAncestorHidden(el)) {
		const refId = el.getAttribute("data-ref-id") || undefined;
		throwStructuredAgentError(
			notInteractableError(action, refId ?? "", {
				reason: "hidden",
				...(controlType ? { controlType } : {}),
			}),
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
		const haystacks = [ariaLabel, placeholder, text].filter(
			Boolean,
		) as string[];
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

function safeRefreshSnapshot(): unknown {
	try {
		return grantFromInlineSnapshot(Number.MAX_SAFE_INTEGER);
	} catch {
		return undefined;
	}
}

export function throwElementNotFound(
	refId: string | undefined,
	label: string | undefined,
	includeCandidates = false,
): never {
	const snapshot = safeRefreshSnapshot();
	if (refId) {
		const candidates = includeCandidates ? findCandidatesByRefId(refId) : [];
		throwStructuredAgentError(staleRefError(refId, { candidates, snapshot }));
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

/**
 * Resolve an element by refId (raw querySelector) with a label fallback.
 *
 * INTENTIONAL non-lease path: this deliberately bypasses the observation lease
 * (requireTarget / requireTargetByLabel). The handlers that use this — type,
 * append, select, check, hover, dblclick, set_files, scroll_to — mutate stable
 * elements that rarely change between snapshot and action, so the lease's
 * stale-element / fingerprint strictness is unnecessary here and would reject
 * valid targets. Only `click` (and fill's refId path) use lease validation.
 *
 * Do NOT "unify" these handlers onto requireTarget — that changes behavior the
 * project has explicitly chosen. If you need lease-validated resolution, use
 * requireTarget/requireTargetByLabel directly (as click does).
 */
export function resolveTargetRaw(
	refId: string | undefined,
	label: string | undefined,
): Element {
	let el = refId ? getElementByRefId(refId) : null;
	if (!el && label) {
		el = findElementByLabel(label);
	}
	if (!el) {
		throwElementNotFound(refId, label, true);
	}
	return el;
}
