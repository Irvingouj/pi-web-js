/**
 * Tab-document-local observation lease. Single source of truth for whether
 * the latest observed state still authorizes element actions.
 *
 * Invariant: observe -> at most one (or several non-branching) actions -> observe again.
 * The content script is the authority: it owns the live document.
 *
 * Invalidation strategy: childList+subtree MutationObserver armed on grant.
 * Structural DOM changes (added/removed nodes) invalidate the lease. Attribute
 * changes (class/style/value) and text changes do NOT — forms and styling
 * transitions must remain actionable across one observation.
 *
 * Target safety net: even if the observer did not fire (jsdom ordering, async
 * mutation), requireTarget re-validates membership, element identity, DOM
 * connection, and fingerprint at action time. This catches attribute-only
 * semantic changes (role/name rewrites) that the observer intentionally ignores.
 */

import { getAccessibleName, getAccessibleRole } from "../shared/snapshot-dom.js";

export interface ObservedTarget {
	element: Element;
	fingerprint: TargetFingerprint;
}

export interface TargetFingerprint {
	tag: string;
	role: string;
	name: string;
}

function fingerprintOf(el: Element): TargetFingerprint {
	return {
		tag: el.tagName.toLowerCase(),
		role: getAccessibleRole(el),
		name: getAccessibleName(el),
	};
}

function fingerprintsEqual(a: TargetFingerprint, b: TargetFingerprint): boolean {
	return (
		a.tag === b.tag && a.role === b.role && a.name === b.name
	);
}

let hasObservation = false;
let observationSeq = 0;
let currentId: string | undefined;
let observer: MutationObserver | null = null;
let targets: Map<string, ObservedTarget> = new Map();

function armObserver(): void {
	disarmObserver();
	if (typeof MutationObserver === "undefined" || !document.body) return;
	observer = new MutationObserver(() => {
		invalidateLease();
	});
	observer.observe(document.body, { childList: true, subtree: true });
}

function disarmObserver(): void {
	if (observer) {
		observer.disconnect();
		observer = null;
	}
}

/** Reset state — used by tests and on content-script load. */
export function resetLease(): void {
	disarmObserver();
	hasObservation = false;
	observationSeq = 0;
	currentId = undefined;
	targets = new Map();
}

/**
 * A snapshot succeeded; the page is now observed. Returns the new observationId.
 * Pass the refId→element mapping so requireTarget can re-validate identity later.
 */
export function grantObservation(
	observed: ReadonlyArray<{ refId: string; element: Element }> = [],
): string {
	observationSeq += 1;
	currentId = `obs${observationSeq}`;
	hasObservation = true;
	targets = new Map();
	for (const t of observed) {
		targets.set(t.refId, {
			element: t.element,
			fingerprint: fingerprintOf(t.element),
		});
	}
	armObserver();
	return currentId;
}

/** Page state may have diverged; require a fresh observation before any action. */
export function invalidateLease(): void {
	disarmObserver();
	hasObservation = false;
	currentId = undefined;
	targets = new Map();
}

export function hasActiveObservation(): boolean {
	return hasObservation;
}

export function currentObservationId(): string | undefined {
	return currentId;
}

/**
 * Re-validate the target at action time. Throws a structured agent error if:
 * - the lease has no active observation
 * - the refId is not part of the latest observation
 * - the element was disconnected or replaced
 * - the semantic fingerprint changed (role/name/tag rewrite)
 *
 * Returns the validated element on success.
 */
export function requireTarget(
	refId: string,
	action: string,
): Element {
	if (!hasObservation) {
		throwObservedRequired(action);
	}
	const target = targets.get(refId);
	if (!target) {
		throwStale(refId, "not_in_latest_observation");
	}
	const { element, fingerprint } = target;
	if (!element.isConnected) {
		throwStale(refId, "disconnected");
	}
	const current = fingerprintOf(element);
	if (!fingerprintsEqual(current, fingerprint)) {
		throwStale(refId, "fingerprint_changed");
	}
	return element;
}

function throwObservedRequired(action: string): never {
	const err = new Error(
		`${action} requires a fresh observation before acting.`,
	) as Error & {
		code: string;
		category?: string;
		hint?: string;
		recovery?: string[];
		details?: Record<string, unknown>;
	};
	err.code = "E_OBSERVATION_REQUIRED";
	err.category = "observation";
	err.hint =
		"Element refIds are only valid after a snapshot. Take a fresh observation and select a refId from its returned nodes.";
	err.recovery = [
		"const d = await page.snapshot_data(); find the target in d.nodes",
		"Use a refId from that snapshot only",
	];
	err.details = { action };
	throw err;
}

function throwStale(refId: string, reason: string): never {
	const err = new Error(
		`Element refId "${refId}" is stale (${reason}).`,
	) as Error & {
		code: string;
		category?: string;
		hint?: string;
		recovery?: string[];
		details?: Record<string, unknown>;
	};
	err.code = "E_STALE";
	err.category = "observation";
	err.hint = "The element changed or was removed after the last observation.";
	err.recovery = [
		"const d = await page.snapshot_data(); find the target in d.nodes",
		"Use a fresh refId from that snapshot only",
	];
	err.details = { staleRefId: refId, reason };
	throw err;
}

/**
 * Resolve a label against the latest observation. Throws E_AMBIGUOUS_TARGET
 * if multiple observed targets share the label. Returns the unique element.
 */
export function requireTargetByLabel(
	label: string,
	action: string,
): Element {
	if (!hasObservation) {
		throwObservedRequired(action);
	}
	const lower = label.toLowerCase().trim();
	const matches: Element[] = [];
	for (const t of targets.values()) {
		if (getAccessibleName(t.element).toLowerCase().trim() === lower) {
			matches.push(t.element);
		}
	}
	if (matches.length === 0) {
		throw new Error(`Element not found by label "${label}"`);
	}
	if (matches.length > 1) {
		throwAmbiguous(label);
	}
	const el = matches[0];
	if (!el.isConnected) {
		throwStale(el.getAttribute("data-ref-id") || "", "disconnected");
	}
	return el;
}

function throwAmbiguous(label: string): never {
	const err = new Error(
		`Multiple elements match label "${label}". The target is ambiguous.`,
	) as Error & {
		code: string;
		category?: string;
		hint?: string;
		recovery?: string[];
		details?: Record<string, unknown>;
	};
	err.code = "E_AMBIGUOUS_TARGET";
	err.category = "observation";
	err.hint =
		"Use a refId from the latest snapshot_data instead of a label, or narrow the label.";
	err.recovery = [
		"const d = await page.snapshot_data(); find the target in d.nodes",
		"Use the refId from that snapshot",
	];
	err.details = { label };
	throw err;
}
