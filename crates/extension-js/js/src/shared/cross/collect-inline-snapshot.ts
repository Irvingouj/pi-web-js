import type { PipelineNode } from "../cs/dom-pipeline.js";
import { syncRefIdCounterFromDom } from "../cs/ref-id.js";
import { resolveFieldLabel } from "../cs/snapshot-dom.js";
import { runSnapshotWalk } from "../cs/snapshot-walker.js";
import { throwStructuredAgentError } from "./agent-errors.js";
import type { ClickabilityConfidence } from "./clickability.js";
import { deduplicateWrappers } from "./clickability.js";

export type InlineSnapshotNode = PipelineNode;

export type FormErrorEntry = {
	field: string;
	error: string;
	refId: string;
};

export type InlineSnapshotResult = {
	text: string;
	nodes: InlineSnapshotNode[];
	formErrors: FormErrorEntry[];
	url: string;
	title: string;
	viewport: { width: number; height: number };
};

// ---------------------------------------------------------------------------
// Text rendering: pure serializer, node + depth → string.
// ---------------------------------------------------------------------------

const renderNodeLine = (node: InlineSnapshotNode, depth: number): string => {
	const displayRole =
		node.controlType === "dropdown"
			? "dropdown"
			: node.controlType === "validation-proxy"
				? "validation-proxy"
				: node.role;

	const fields: Array<[unknown, string]> = [
		[node.name, `"${node.name?.replace(/"/g, '\\"')}"`],
		[`[${node.refId}]`, `[${node.refId}]`],
		[
			node.text && node.text !== node.name,
			`text="${node.text?.replace(/"/g, '\\"')}"`,
		],
		[node.value, `value="${node.value?.replace(/"/g, '\\"')}"`],
		[node.checked !== undefined, `checked=${node.checked}`],
		[node.required, "required"],
		[node.invalid, "invalid"],
		[node.expanded !== undefined, `expanded=${node.expanded}`],
		[node.controls, `opens="${node.controls?.replace(/"/g, '\\"')}"`],
		[node.recommendedAction, `use="${node.recommendedAction}"`],
		[node.confidence === "low", "confidence=low"],
		[node.actionable === false, "actionable=false"],
		[node.forControl, `forControl="${node.forControl}"`],
		[node.errorMessage, `error="${node.errorMessage?.replace(/"/g, '\\"')}"`],
		[
			!node.errorMessage && node.validationMessage,
			`validation="${node.validationMessage?.replace(/"/g, '\\"')}"`,
		],
	];

	return [
		`${"  ".repeat(depth)}- ${displayRole}`,
		...fields.filter(([cond]) => cond).map(([, text]) => text),
	].join(" ");
};

// ---------------------------------------------------------------------------
// Form errors: filter → map pipeline over collected nodes.
// ---------------------------------------------------------------------------

const deriveFormErrors = (nodes: InlineSnapshotNode[]): FormErrorEntry[] =>
	nodes
		.filter(
			(n) =>
				(n.invalid ||
					n.errorMessage !== undefined ||
					n.validationMessage !== undefined) &&
				n.controlType !== "validation-proxy",
		)
		.map((n) => ({
			field: resolveFieldLabel(
				document.querySelector(`[data-ref-id="${n.refId}"]`),
				n.name || n.refId,
			),
			error: n.errorMessage || n.validationMessage || "",
			refId: n.refId,
		}));

// ---------------------------------------------------------------------------
// Mutation guard: wraps a thunk, throws if DOM changed during execution.
// ---------------------------------------------------------------------------

function withMutationGuard<T>(fn: () => T): T {
	let domMutated = false;
	const observer =
		typeof MutationObserver !== "undefined" && document.body
			? new MutationObserver(() => {
					domMutated = true;
				})
			: null;
	if (observer && document.body) {
		observer.observe(document.body, { childList: true, subtree: true });
	}
	try {
		return fn();
	} finally {
		if (observer) {
			if (observer.takeRecords().length > 0) domMutated = true;
			observer.disconnect();
		}
		if (domMutated) {
			throwStructuredAgentError({
				message: "DOM mutated during snapshot collection",
				code: "E_SNAPSHOT",
				category: "resource",
				details: { cause: "dom_mutated_during_snapshot" },
				recovery: [
					"Wait for the page to finish rendering before snapshot",
					"Retry with a smaller max_nodes bound",
					"Use page.snapshot_data() after navigation settles",
				],
			});
		}
	}
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function collectInlineSnapshot(maxNodes: number): InlineSnapshotResult {
	syncRefIdCounterFromDom();

	return withMutationGuard(() => {
		const walked = document.body
			? runSnapshotWalk(document.body, maxNodes)
			: [];

		const nodes = walked.map((x) => x.node);
		const els = walked.map((x) => x.el);
		const depths = walked.map((x) => x.depth);

		// Dedup: remove low-confidence wrappers that contain clickable descendants.
		// Adapted from Vimium link_hints.js:1362-1386.
		const actionableItems: Array<{
			el: Element;
			confidence: ClickabilityConfidence;
		}> = [];
		for (let i = 0; i < nodes.length; i++) {
			if (nodes[i].actionable) {
				actionableItems.push({
					el: els[i],
					confidence: nodes[i].confidence ?? "high",
				});
			}
		}
		const toRemove = deduplicateWrappers(actionableItems);
		for (let i = 0; i < nodes.length; i++) {
			if (nodes[i].actionable && toRemove.has(els[i])) {
				nodes[i].actionable = false;
				delete nodes[i].recommendedAction;
				delete nodes[i].confidence;
			}
		}

		// Render lines after dedup so actionable=false is reflected in text.
		const lines = nodes.map((node, i) => renderNodeLine(node, depths[i]));

		return {
			text: [
				`URL: ${window.location.href}`,
				`Title: ${document.title}`,
				"",
				...lines,
			].join("\n"),
			nodes,
			formErrors: deriveFormErrors(nodes),
			url: window.location.href,
			title: document.title,
			viewport: { width: window.innerWidth, height: window.innerHeight },
		};
	});
}
