/**
 * Shared DOM pipeline core for snapshot, dom, and find surfaces.
 *
 * Owns the cross-surface contract: the canonical node type (`PipelineNode`)
 * and the two non-snapshot exits (`buildFindNode`, `buildDomTree`). Also
 * re-exports `EXCLUDED_TAGS` (canonical home: `snapshot-dom.ts`) and
 * `hiddenReasonFor` so all three surfaces share one source of truth.
 *
 * The snapshot surface has its own traversal module (`snapshot-walker.ts`)
 * because the generic walker + snapshot pass chain only serve snapshot —
 * dom/find use plain recursion over `enrichNode` (in `dom-enrichers.ts`).
 *
 * Module layout:
 *   dom-pipeline.ts   — types + shared primitives + dom/find exits
 *   dom-enrichers.ts  — field-group enrichment (shared by all three surfaces)
 *   snapshot-walker.ts — snapshot traversal (walker + passes + emitter)
 */

import { enrichNode } from "./dom-enrichers.js";
import { allocateRefId } from "./ref-id.js";
import {
	EXCLUDED_TAGS,
	getAccessibleName,
	getAccessibleRole,
	getOwnVisibleText,
	hasVisibleTextContent,
	isSelfOrAncestorHidden,
} from "./snapshot-dom.js";

// Re-exported so all three surfaces (and snapshot-walker.ts) share one source
// of truth. Canonical definition lives in snapshot-dom.ts alongside the
// include/visible-text semantics that consult it.
export { EXCLUDED_TAGS };

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type HiddenReason =
	| "display-none"
	| "visibility-hidden"
	| "aria-hidden"
	| "opacity-zero"
	| "hidden-attr"
	| "inert";

export type PipelineNode = {
	refId: string;
	tag: string;
	role: string;
	name?: string;
	text?: string;
	mustKeep?: boolean;
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
	attributes?: Record<string, string>;
	children?: PipelineNode[];
	href?: string;
	src?: string;
	alt?: string;
	title?: string;
	parentRefId?: string;
	postId?: string;
	permalink?: string;
	imageUrls?: string[];
	accept?: string;
	filesCount?: number;
	controlType?: string;
	actionable?: boolean;
	recommendedAction?: string;
	confidence?: "high" | "low";
	controls?: string;
	expanded?: boolean;
	forControl?: string;
	hidden?: boolean;
	hiddenReason?: HiddenReason;
};

// ---------------------------------------------------------------------------
// Shared primitives — consulted by all three surfaces
// ---------------------------------------------------------------------------

/**
 * Classify why an element is hidden. Note: this lists one more reason
 * (`opacity-zero`) than `isSelfOrAncestorHidden` excludes — opacity-zero is
 * classified but not excluded, per the existing pipeline contract.
 */
export function hiddenReasonFor(el: Element): HiddenReason | undefined {
	if ((el as HTMLElement).hidden) return "hidden-attr";
	if (el.getAttribute("aria-hidden") === "true") return "aria-hidden";
	if ((el as HTMLElement).inert) return "inert";
	const style = window.getComputedStyle(el);
	if (style.display === "none") return "display-none";
	if (style.visibility === "hidden") return "visibility-hidden";
	if (style.opacity === "0") return "opacity-zero";
	return undefined;
}

// ---------------------------------------------------------------------------
// Find exit — enriches a single matched element
// ---------------------------------------------------------------------------

export function buildFindNode(
	el: Element,
	observed: Array<{ refId: string; element: Element }>,
): PipelineNode {
	const refId = allocateRefId(el);
	observed.push({ refId, element: el });

	const tag = el.tagName.toLowerCase();
	// Excluded tags are explicitly opted into by the agent's selector, so we
	// still emit the node — but their textContent is raw source, not visible
	// text, so per the Snapshot Text Rule we must not surface it as `text`.
	const text = EXCLUDED_TAGS.has(tag)
		? undefined
		: getOwnVisibleText(el, 100) || undefined;

	const node: PipelineNode = {
		refId,
		tag,
		role: getAccessibleRole(el),
		text,
	};

	const name = getAccessibleName(el);
	if (name) node.name = name;

	if (text && hasVisibleTextContent(el)) node.mustKeep = true;

	enrichNode(el, node);

	return node;
}

// ---------------------------------------------------------------------------
// DOM exit — recursive tree build, returns nested children
// ---------------------------------------------------------------------------

export function buildDomTree(
	el: Element,
	depth: number,
	includeHidden: boolean,
	observed?: Array<{ refId: string; element: Element }>,
): PipelineNode | null {
	const tag = el.tagName.toLowerCase();
	// Excluded tags are never useful DOM nodes and their textContent leaks raw
	// source as "visible text" — mirror snapshot's behavior for parity.
	if (EXCLUDED_TAGS.has(tag)) return null;
	if (!includeHidden && isSelfOrAncestorHidden(el)) return null;

	const refId = allocateRefId(el);
	if (observed) observed.push({ refId, element: el });

	const node: PipelineNode = {
		tag,
		refId,
		role: getAccessibleRole(el),
		text: getOwnVisibleText(el, 100) || undefined,
	};

	const name = getAccessibleName(el);
	if (name) node.name = name;

	if (hasVisibleTextContent(el)) node.mustKeep = true;

	// Raw HTML attribute bag — DOM mode only; opaque string→string pairs
	// surfaced verbatim for agent introspection.
	const attrs: Record<string, string> = {};
	for (const attr of Array.from(el.attributes)) attrs[attr.name] = attr.value;
	if (Object.keys(attrs).length) node.attributes = attrs;

	// Hidden reason — only surfaced when the caller asked for hidden nodes.
	// When includeHidden===false the gate above has already excluded truly
	// hidden nodes; attaching hidden:true to a node we decided to include
	// would contradict the "visible only" contract (notably for opacity-zero,
	// which is classified but not excluded).
	if (includeHidden) {
		const hr = hiddenReasonFor(el);
		if (hr) {
			node.hidden = true;
			node.hiddenReason = hr;
		}
	}

	// Shared enrichment (form, validation-proxy, dropdown, clickability,
	// links, images, post, permalink, child images)
	enrichNode(el, node);

	if (depth > 0) {
		const kids: PipelineNode[] = [];
		for (const child of Array.from(el.children)) {
			const k = buildDomTree(child, depth - 1, includeHidden, observed);
			if (k) kids.push(k);
		}
		if (kids.length) node.children = kids;
	}

	return node;
}
