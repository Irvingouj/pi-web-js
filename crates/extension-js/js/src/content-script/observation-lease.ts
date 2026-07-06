/**
 * Tab-document-local observation lease. Single source of truth for whether
 * the latest observed state still authorizes element actions.
 *
 * Lazy strategy: a snapshot grants the lease; refIds stay valid until their
 * specific element is disconnected or its semantic fingerprint (role/name/tag)
 * changes. DOM mutations elsewhere on the page do NOT invalidate the lease —
 * clicking one element does not invalidate refIds for other observed elements.
 * Navigation-class handlers (back/forward/scroll) call invalidateLease
 * explicitly when a global state reset is warranted.
 *
 * Lazy refind: when requireTarget finds the cached element disconnected or
 * fingerprint-changed, it re-queries the document by (role, name) and, on a
 * match (first by name+role, falling back to role-only), transparently rebinds
 * the refId to the fresh element. This mirrors agent-browser's
 * resolve_element_object_id fallback. Only when refind also fails does it
 * throw E_STALE with the original reason.
 */

import {
	collectInlineSnapshot,
	type InlineSnapshotNode,
	type InlineSnapshotResult,
} from "../shared/cross/collect-inline-snapshot.js";
import {
	getAccessibleName,
	getAccessibleRole,
} from "../shared/cs/snapshot-dom.js";

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

function fingerprintsEqual(
	a: TargetFingerprint,
	b: TargetFingerprint,
): boolean {
	return a.tag === b.tag && a.role === b.role && a.name === b.name;
}

let hasObservation = false;
let observationSeq = 0;
let currentId: string | undefined;
let targets: Map<string, ObservedTarget> = new Map();

/** Reset state — used by tests and on content-script load. */
export function resetLease(): void {
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
	return currentId;
}

/** Page state may have diverged; require a fresh observation before any action. */
export function invalidateLease(): void {
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
export function requireTarget(refId: string, action: string): Element {
	if (!hasObservation) {
		throwObservedRequired(action);
	}
	const target = targets.get(refId);
	if (!target) {
		throwStale(refId, "not_in_latest_observation");
	}
	const { element, fingerprint } = target;
	if (!element.isConnected) {
		const refound = refindByFingerprint(target);
		if (refound) {
			targets.set(refId, {
				element: refound,
				fingerprint: fingerprintOf(refound),
			});
			return refound;
		}
		throwStale(refId, "disconnected");
	}
	const current = fingerprintOf(element);
	if (!fingerprintsEqual(current, fingerprint)) {
		throwStale(refId, "fingerprint_changed");
	}
	return element;
}

function refindByFingerprint(target: ObservedTarget): Element | null {
	const { fingerprint } = target;
	const role = fingerprint.role;
	const name = fingerprint.name.trim().toLowerCase();
	return (
		Array.from(document.querySelectorAll("*")).find(
			(el) =>
				getAccessibleRole(el) === role &&
				getAccessibleName(el).toLowerCase().trim() === name,
		) ?? null
	);
}

function throwObservedRequired(action: string): never {
	const snapshot = refreshObservation();
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
		"Element refIds are only valid after a snapshot. A fresh snapshot is attached — use a refId from error.details.snapshot.nodes and retry.";
	err.recovery = [
		"Read error.details.snapshot.nodes, pick the target refId, and retry the action",
		"No separate snapshot_data call needed — the attached snapshot already refreshes the lease",
	];
	err.details = { action, ...(snapshot ? { snapshot } : {}) };
	throw err;
}

function throwStale(refId: string, reason: string): never {
	const snapshot = refreshObservation();
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
	err.hint =
		"The element changed or was removed after the last observation. A fresh snapshot is attached — re-resolve the target refId and retry.";
	err.recovery = [
		"Read error.details.snapshot.nodes, find the element by role/name, and retry with the new refId",
		"No separate snapshot_data call needed — the attached snapshot already refreshes the lease",
	];
	err.details = {
		staleRefId: refId,
		reason,
		...(snapshot ? { snapshot } : {}),
	};
	throw err;
}

/**
 * Resolve a label against the latest observation. Throws E_AMBIGUOUS_TARGET
 * if multiple observed targets share the label. Returns the unique element.
 */
export function requireTargetByLabel(label: string, action: string): Element {
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
	const snapshot = refreshObservation();
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
		"Use a refId from error.details.snapshot.nodes instead of a label, or narrow the label.";
	err.recovery = [
		"Read error.details.snapshot.nodes, pick the intended target by refId, and retry",
		"No separate snapshot_data call needed — the attached snapshot already refreshes the lease",
	];
	err.details = { label, ...(snapshot ? { snapshot } : {}) };
	throw err;
}

/** Re-grant snapshot attached to lease-violation errors. */
export interface RefreshSnapshot {
	nodes: InlineSnapshotNode[];
	observationId: string;
	url: string;
	title: string;
}

/**
 * Resolve a snapshot node's refId back to its live element using the same
 * CSS.escape'd lookup as getElementByRefId — inlined to match that helper
 * without dom-utils depending on this module's internals.
 */
function elementByRefId(refId: string): Element | null {
	return document.querySelector(`[data-ref-id='${CSS.escape(refId)}']`);
}

/**
 * Collect an inline snapshot and grant the lease over every refId-bearing
 * element it produced. Shared logic for snapshot-time grant and error-path
 * refresh so the collect→resolve→grant sequence has one definition.
 */
export function grantFromInlineSnapshot(
	maxNodes: number,
): InlineSnapshotResult & { observationId: string } {
	const r = collectInlineSnapshot(maxNodes);
	const observed = r.nodes
		.map((n) => {
			const el = elementByRefId(n.refId);
			return el ? { refId: n.refId, element: el } : null;
		})
		.filter((x): x is { refId: string; element: Element } => x !== null);
	const observationId = grantObservation(observed);
	return { ...r, observationId };
}

/**
 * Build a fresh inline snapshot and re-grant the lease on it, so the returned
 * refIds are immediately usable for a retry action. Attached to lease-violation
 * errors so the browsergent can re-resolve the target and retry in one step —
 * no separate snapshot_data round-trip.
 *
 * Returns undefined if collection itself throws (e.g. the mutation guard fires
 * mid-walk) so the caller still emits the original lease-violation error rather
 * than masking it with E_SNAPSHOT.
 *
 * ponytail: builds a full snapshot on every lease-violation throw. If this
 * profiles hot on a churning SPA that fails every click, gate behind an opt-in
 * flag and fall back to the recovery-string-only error.
 */
function refreshObservation(): RefreshSnapshot | undefined {
	try {
		const r = grantFromInlineSnapshot(Number.MAX_SAFE_INTEGER);
		return {
			nodes: r.nodes,
			observationId: r.observationId,
			url: r.url,
			title: r.title,
		};
	} catch {
		return undefined;
	}
}
