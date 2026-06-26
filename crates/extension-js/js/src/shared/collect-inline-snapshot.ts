import { allocateRefId, syncRefIdCounterFromDom } from "./ref-id.js";
import { throwStructuredAgentError } from "./registry/agent-errors.js";
import {
	enrichFormNode,
	getAccessibleName,
	getAccessibleRole,
	getOwnVisibleText,
	isValidationProxyInput,
	resolveAbsoluteUrl,
	resolveContainerRefId,
	resolveFieldLabel,
	resolvePermalinkLink,
	shouldInclude,
} from "./snapshot-dom.js";

export type InlineSnapshotNode = {
	refId: string;
	role: string;
	tag: string;
	controlType?: string;
	actionable?: boolean;
	forControl?: string;
	recommendedAction?: string;
	controls?: string;
	expanded?: boolean;
	name?: string;
	text?: string;
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
};

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

const EXCLUDED_TAGS: Record<string, true> = {
	script: true,
	style: true,
	noscript: true,
	template: true,
};

// ---------------------------------------------------------------------------
// Enrichment: pure mutators (el, node) → void, composed via reduce.
// ---------------------------------------------------------------------------

type Enricher = (el: Element, node: InlineSnapshotNode) => void;

const enrichFormFields: Enricher = (el, node) => enrichFormNode(el, node);

const enrichValidationProxy: Enricher = (el, node) => {
	if (!isValidationProxyInput(el)) return;
	node.controlType = "validation-proxy";
	node.actionable = false;
	const forControl = el.closest('[role="combobox"]')?.getAttribute("data-ref-id");
	if (forControl) node.forControl = forControl;
};

const enrichDropdown: Enricher = (el, node) => {
	if (node.controlType === "validation-proxy") return;
	if (node.role !== "combobox" && node.tag !== "select") return;
	node.controlType = "dropdown";
	node.recommendedAction = "select_option";
	node.controls = el.getAttribute("aria-controls") || el.getAttribute("aria-owns") || undefined;
	const expanded = el.getAttribute("aria-expanded");
	node.expanded = expanded === "true" ? true : expanded === "false" ? false : undefined;
};

const enrichLink: Enricher = (el, node) => {
	if (node.tag !== "a") return;
	node.href = resolveAbsoluteUrl(el.getAttribute("href"));
};

const enrichImage: Enricher = (el, node) => {
	if (node.tag !== "img") return;
	node.src = resolveAbsoluteUrl(el.getAttribute("src"));
	node.alt = el.getAttribute("alt") || "";
};

const enrichInput: Enricher = (el, node) => {
	if (node.tag !== "input") return;
	const inputEl = el as HTMLInputElement;
	node.title = el.getAttribute("title") || undefined;
	if (inputEl.type === "file") {
		node.accept = inputEl.getAttribute("accept") || undefined;
		node.filesCount = inputEl.files?.length ?? 0;
	}
};

const enrichContainerLink: Enricher = (el, node) => {
	if (node.tag !== "img" && node.tag !== "a") return;
	node.parentRefId = resolveContainerRefId(el) || node.parentRefId;
};

const enrichPostId: Enricher = (el, node) => {
	node.postId = el.getAttribute("data-post-id") || undefined;
};

const enrichPermalink: Enricher = (el, node) => {
	if (node.tag === "a") return;
	const permalinkLink = resolvePermalinkLink(el);
	if (permalinkLink)
		node.permalink = resolveAbsoluteUrl(permalinkLink.getAttribute("href"));
};

const enrichChildImages: Enricher = (el, node) => {
	if (node.tag === "img") return;
	const urls = Array.from(el.querySelectorAll("img"))
		.map((img) => resolveAbsoluteUrl(img.getAttribute("src")))
		.filter((u): u is string => !!u);
	if (urls.length > 0) node.imageUrls = urls;
};

/** Compose enrichers into a single function. */
const enrich = (el: Element, node: InlineSnapshotNode): void =>
	[
		enrichFormFields,
		enrichValidationProxy,
		enrichDropdown,
		enrichLink,
		enrichImage,
		enrichInput,
		enrichContainerLink,
		enrichPostId,
		enrichPermalink,
		enrichChildImages,
	].forEach((fn) => fn(el, node));

// ---------------------------------------------------------------------------
// Node construction: pure transform, element + context → fully-built node.
// ---------------------------------------------------------------------------

const buildNode = (el: Element, depth: number, parentRefId: string): InlineSnapshotNode => {
	const node: InlineSnapshotNode = {
		refId: allocateRefId(el),
		role: getAccessibleRole(el),
		tag: el.tagName.toLowerCase(),
		text: getOwnVisibleText(el, 100),
	};
	const name = getAccessibleName(el);
	if (name) node.name = name;
	if ((node.tag === "img" || node.tag === "a") && parentRefId) node.parentRefId = parentRefId;
	enrich(el, node);
	return node;
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
		[node.text && node.text !== node.name, `text="${node.text?.replace(/"/g, '\\"')}"`],
		[node.value, `value="${node.value?.replace(/"/g, '\\"')}"`],
		[node.required, "required"],
		[node.invalid, "invalid"],
		[node.expanded !== undefined, `expanded=${node.expanded}`],
		[node.controls, `opens="${node.controls?.replace(/"/g, '\\"')}"`],
		[node.recommendedAction, `use="${node.recommendedAction}"`],
		[node.actionable === false, "actionable=false"],
		[node.forControl, `forControl="${node.forControl}"`],
		[node.errorMessage, `error="${node.errorMessage?.replace(/"/g, '\\"')}"`],
		[!node.errorMessage && node.validationMessage, `validation="${node.validationMessage?.replace(/"/g, '\\"')}"`],
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
// Tree walker: discriminated-union pipeline. No nulls, no optionals in frames.
//
// Enter  → the walker is visiting this element. Filters decide: accept or reject.
// Emit   → element passed all filters, produce a node + line + child context.
// Reject → element filtered out, children walk at same depth, no parentRefId.
//
// pipe() composes (Enter → Enter | Reject) guards. The final step maps
// Enter → Emit. The result is always concrete — no ?? needed downstream.
// ---------------------------------------------------------------------------

type Enter = {
	kind: "enter";
	el: Element;
	depth: number;
	parentRefId: string;
};

type Reject = {
	kind: "reject";
	el: Element;
	depth: number;
};

type Emit = {
	kind: "emit";
	node: InlineSnapshotNode;
	line: string;
	children: Element[];
	childDepth: number;
	childRefId: string;
};

type Frame = Enter | Reject | Emit;

/** Guards run before emit. Each takes Enter, returns Enter (pass) or Reject. */
type Guard = (frame: Enter) => Enter | Reject;

/** Compose guards left-to-right. First reject short-circuits. */
const pipe =
	(...guards: Guard[]): Guard =>
	(frame) =>
		guards.reduce<Enter | Reject>(
			(acc, guard) => (acc.kind === "reject" ? acc : guard(acc as Enter)),
			frame,
		);

/** Guard: reject excluded tags. */
const rejectExcludedTags: Guard = (frame) =>
	EXCLUDED_TAGS[frame.el.tagName.toLowerCase()]
		? { kind: "reject", el: frame.el, depth: frame.depth }
		: frame;

/** Guard: reject elements that fail shouldInclude. */
const rejectNotIncluded: Guard = (frame) =>
	shouldInclude(frame.el)
		? frame
		: { kind: "reject", el: frame.el, depth: frame.depth };

/** Guard: reject when capacity reached. */
const rejectAtCapacity =
	(count: number, maxNodes: number): Guard =>
	(frame) =>
		count >= maxNodes
			? { kind: "reject", el: frame.el, depth: frame.depth }
			: frame;

/** Transform an Enter frame into an Emit frame: build node, render line. */
const toEmit = (frame: Enter): Emit => {
	const node = buildNode(frame.el, frame.depth, frame.parentRefId);
	return {
		kind: "emit",
		node,
		line: renderNodeLine(node, frame.depth),
		children: Array.from(frame.el.children),
		childDepth: frame.depth + 1,
		childRefId: node.refId,
	};
};

/** Resolve a frame into walk instructions: emit (if Emit) or passthrough. */
type WalkOutcome = {
	emitted: { node: InlineSnapshotNode; line: string } | null;
	children: Element[];
	childDepth: number;
	childRefId: string;
};

const resolveOutcome = (frame: Frame): WalkOutcome =>
	frame.kind === "emit"
		? {
				emitted: { node: frame.node, line: frame.line },
				children: frame.children,
				childDepth: frame.childDepth,
				childRefId: frame.childRefId,
			}
		: {
				emitted: null,
				children: Array.from(frame.el.children),
				childDepth: frame.depth,
				childRefId: "",
			};

/** Walk the DOM tree applying the guard pipeline to each element. */
const walkTree = (root: Element, maxNodes: number) => {
	const nodes: InlineSnapshotNode[] = [];
	const lines: string[] = [];

	const walk = (el: Element, depth: number, parentRefId: string): void => {
		const guard = pipe(rejectExcludedTags, rejectNotIncluded, rejectAtCapacity(nodes.length, maxNodes));
		const frame = guard({ kind: "enter", el, depth, parentRefId });
		const outcome = resolveOutcome(frame.kind === "reject" ? frame : toEmit(frame));

		if (outcome.emitted) {
			nodes.push(outcome.emitted.node);
			lines.push(outcome.emitted.line);
		}

		for (const child of outcome.children) {
			if (nodes.length >= maxNodes) break;
			walk(child, outcome.childDepth, outcome.childRefId);
		}
	};

	walk(root, 0, "");
	return { nodes, lines };
};

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
		const { nodes, lines } = document.body
			? walkTree(document.body, maxNodes)
			: { nodes: [], lines: [] };

		return {
			text: [`URL: ${window.location.href}`, `Title: ${document.title}`, "", ...lines].join("\n"),
			nodes,
			formErrors: deriveFormErrors(nodes),
			url: window.location.href,
			title: document.title,
			viewport: { width: window.innerWidth, height: window.innerHeight },
		};
	});
}
