/**
 * Snapshot-only DOM traversal.
 *
 * Owns: the generic recursive walker, the snapshot pass chain (excluded tags,
 * base semantics, mustKeep marking), the snapshot emitter (capacity-gated,
 * mustKeep-beats-capacity), and a single `runSnapshotWalk` entry point that
 * the snapshot caller in `collect-inline-snapshot.ts` uses.
 *
 * Why a separate module: `walkElements` and the snapshot passes only serve the
 * snapshot surface (dom/find use plain recursion via `buildDomTree`/
 * `buildFindNode` in `dom-pipeline.ts`). Keeping them here makes
 * `dom-pipeline.ts` a true shared core (types + EXCLUDED_TAGS + the three
 * surface exits) and lets this module be read end-to-end as the snapshot
 * traversal story.
 *
 * `EXCLUDED_TAGS` is re-exported from `dom-pipeline.ts` (which itself imports
 * it from `snapshot-dom.ts`, the canonical owner of include/visible-text
 * semantics) so all three surfaces share one source of truth.
 */

import { enrichNode } from "./dom-enrichers.js";
import type { PipelineNode } from "./dom-pipeline.js";
import { EXCLUDED_TAGS } from "./dom-pipeline.js";
import { allocateRefId } from "./ref-id.js";
import {
	getAccessibleName,
	getAccessibleRole,
	getOwnVisibleText,
	hasVisibleTextContent,
	shouldInclude,
} from "./snapshot-dom.js";

// ---------------------------------------------------------------------------
// Walker types (private — only snapshot traversal uses them)
// ---------------------------------------------------------------------------

type ElementContext = {
	el: Element;
	depth: number;
	parentRefId: string;
	node: Partial<PipelineNode>;
	meta: {
		hasVisibleText?: boolean;
	};
};

type PipelineDecision =
	| { kind: "continue"; ctx: ElementContext }
	| { kind: "skip-subtree" };

type PipelinePass = (ctx: ElementContext) => PipelineDecision;

type WalkResult = {
	el: Element;
	depth: number;
	node: PipelineNode;
};

// ---------------------------------------------------------------------------
// Generic recursive walker (snapshot-only consumer)
// ---------------------------------------------------------------------------

function walkElements(options: {
	root: Element;
	maxNodes?: number;
	passes: PipelinePass[];
	emit: (ctx: ElementContext) => PipelineNode | null;
}): WalkResult[] {
	const out: WalkResult[] = [];

	function visit(el: Element, depth: number, parentRefId: string): void {
		let ctx: ElementContext = {
			el,
			depth,
			parentRefId,
			node: {},
			meta: {},
		};

		for (const pass of options.passes) {
			const next = pass(ctx);
			if (next.kind === "skip-subtree") return;
			ctx = next.ctx;
		}

		const node = options.emit(ctx);
		const childDepth = node ? depth + 1 : depth;
		const childParentRefId = node?.refId ?? parentRefId;
		if (node) out.push({ el, depth, node });

		for (const child of Array.from(el.children)) {
			visit(child, childDepth, childParentRefId);
		}
	}

	visit(options.root, 0, "");
	return out;
}

// ---------------------------------------------------------------------------
// Snapshot passes
// ---------------------------------------------------------------------------

const rejectExcludedTags: PipelinePass = (ctx) => {
	const tag = ctx.el.tagName.toLowerCase();
	return EXCLUDED_TAGS.has(tag)
		? { kind: "skip-subtree" }
		: { kind: "continue", ctx };
};

const readBaseSemantics: PipelinePass = (ctx) => {
	const tag = ctx.el.tagName.toLowerCase();
	const text = getOwnVisibleText(ctx.el, 100);
	const name = getAccessibleName(ctx.el);
	return {
		kind: "continue",
		ctx: {
			...ctx,
			node: {
				...ctx.node,
				tag,
				role: getAccessibleRole(ctx.el),
				text: text || undefined,
				name: name || undefined,
			},
		},
	};
};

const markVisibleTextMustKeep: PipelinePass = (ctx) => {
	const hasVisibleText = hasVisibleTextContent(ctx.el);
	return {
		kind: "continue",
		ctx: {
			...ctx,
			meta: { ...ctx.meta, hasVisibleText },
		},
	};
};

const snapshotPasses: PipelinePass[] = [
	rejectExcludedTags,
	readBaseSemantics,
	markVisibleTextMustKeep,
];

// ---------------------------------------------------------------------------
// Snapshot emitter — capacity-gated, mustKeep beats capacity
// ---------------------------------------------------------------------------

function createSnapshotEmitter(maxNodes: number): {
	emit: (ctx: ElementContext) => PipelineNode | null;
} {
	let count = 0;

	return {
		emit: (ctx: ElementContext): PipelineNode | null => {
			if (!shouldInclude(ctx.el)) return null;

			const mustKeep = ctx.meta.hasVisibleText === true;
			if (count >= maxNodes && !mustKeep) return null;

			const refId = allocateRefId(ctx.el);
			// readBaseSemantics runs before emit and always sets tag/role, so no
			// fallback is needed (a missing value here is a bug to surface, not paper over).
			const node: PipelineNode = {
				...ctx.node,
				refId,
				tag: ctx.node.tag!,
				role: ctx.node.role!,
			};

			if (mustKeep) node.mustKeep = true;
			if ((node.tag === "img" || node.tag === "a") && ctx.parentRefId)
				node.parentRefId = ctx.parentRefId;

			enrichNode(ctx.el, node);

			count++;
			return node;
		},
	};
}

// ---------------------------------------------------------------------------
// Public entry — single call site for collect-inline-snapshot.ts
// ---------------------------------------------------------------------------

/**
 * Walk `root` for snapshot, returning one node per emitted element plus its
 * originating element and depth. Capacity-gated by `maxNodes`; mustKeep nodes
 * bypass the capacity check (the snapshot caller's invariant).
 */
export function runSnapshotWalk(root: Element, maxNodes: number): WalkResult[] {
	const { emit } = createSnapshotEmitter(maxNodes);
	return walkElements({ root, maxNodes, passes: snapshotPasses, emit });
}
