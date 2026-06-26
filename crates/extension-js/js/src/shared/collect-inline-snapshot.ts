import { allocateRefId, syncRefIdCounterFromDom } from "./ref-id.js";
import { throwStructuredAgentError } from "./registry/agent-errors.js";
import {
	enrichFormNode,
	getAccessibleName,
	getAccessibleRole,
	getOwnVisibleText,
	resolveAbsoluteUrl,
	resolveContainerRefId,
	resolvePermalinkLink,
	shouldInclude,
} from "./snapshot-dom.js";

export type InlineSnapshotNode = {
	refId: string;
	role: string;
	tag: string;
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

export type InlineSnapshotResult = {
	text: string;
	nodes: InlineSnapshotNode[];
	url: string;
	title: string;
	viewport: { width: number; height: number };
};

/** Single source of truth for MAIN-world and content-script inline snapshots. */
export function collectInlineSnapshot(maxNodes: number): InlineSnapshotResult {
	syncRefIdCounterFromDom();
	const nodes: InlineSnapshotNode[] = [];
	const lines: string[] = [];
	let done = false;
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
		function traverse(el: Element, depth: number, parentRefId?: string) {
			if (done) return;
			if (nodes.length >= maxNodes) {
				done = true;
				return;
			}

			const tag = el.tagName.toLowerCase();
			if (
				tag === "script" ||
				tag === "style" ||
				tag === "noscript" ||
				tag === "template"
			) {
				return;
			}

			const included = shouldInclude(el);
			let currentDepth = depth;
			let currentRefId: string | undefined = parentRefId;

			if (included) {
				const refId = allocateRefId(el);
				const role = getAccessibleRole(el);
				const name = getAccessibleName(el);
				const node: InlineSnapshotNode = { refId, role, tag };
				if (name) node.name = name;
				node.text = getOwnVisibleText(el, 100);
				enrichFormNode(el, node);

				if (tag === "a") {
					const href = resolveAbsoluteUrl(el.getAttribute("href"));
					if (href) node.href = href;
				}
				if (tag === "img") {
					const src = resolveAbsoluteUrl(el.getAttribute("src"));
					if (src) node.src = src;
					node.alt = el.getAttribute("alt") || "";
				}
				if (tag === "input") {
					const title = el.getAttribute("title");
					if (title) node.title = title;
					const inputEl = el as HTMLInputElement;
					if (inputEl.type === "file") {
						const accept = inputEl.getAttribute("accept");
						if (accept) node.accept = accept;
						node.filesCount = inputEl.files?.length ?? 0;
					}
				}
				if (tag === "img" || tag === "a") {
					const containerRefId = resolveContainerRefId(el);
					if (containerRefId) {
						node.parentRefId = containerRefId;
					} else if (parentRefId) {
						node.parentRefId = parentRefId;
					}
				}

				const postId = el.getAttribute("data-post-id");
				if (postId) node.postId = postId;

				if (tag !== "a") {
					const permalinkLink = resolvePermalinkLink(el);
					if (permalinkLink) {
						const permalink = resolveAbsoluteUrl(
							permalinkLink.getAttribute("href"),
						);
						if (permalink) node.permalink = permalink;
					}
				}

				if (tag !== "img") {
					const images = el.querySelectorAll("img");
					if (images.length > 0) {
						const imageUrls: string[] = [];
						for (const img of images) {
							const src = resolveAbsoluteUrl(img.getAttribute("src"));
							if (src) imageUrls.push(src);
						}
						if (imageUrls.length > 0) node.imageUrls = imageUrls;
					}
				}

				nodes.push(node);
				currentRefId = refId;

				const indent = "  ".repeat(depth);
				const parts = [`${indent}- ${role}`];
				if (name) parts.push(`"${name.replace(/"/g, '\\"')}"`);
				parts.push(`[${refId}]`);
				lines.push(parts.join(" "));

				currentDepth = depth + 1;
			}

			for (const child of el.children) {
				if (done) break;
				traverse(child, currentDepth, currentRefId);
			}
		}

		if (document.body) {
			traverse(document.body, 0);
		}
	} finally {
		if (observer) {
			if (observer.takeRecords().length > 0) {
				domMutated = true;
			}
			observer.disconnect();
		}
	}

	if (domMutated) {
		throwStructuredAgentError({
			message: "DOM mutated during snapshot collection",
			code: "E_SNAPSHOT",
			category: "resource",
			details: {
				cause: "dom_mutated_during_snapshot",
				nodesCollected: nodes.length,
			},
			recovery: [
				"Wait for the page to finish rendering before snapshot",
				"Retry with a smaller max_nodes bound",
				"Use page.snapshot_data() after navigation settles",
			],
		});
	}

	const header = [
		`URL: ${window.location.href}`,
		`Title: ${document.title}`,
		"",
	];

	return {
		text: header.concat(lines).join("\n"),
		nodes,
		url: window.location.href,
		title: document.title,
		viewport: {
			width: window.innerWidth,
			height: window.innerHeight,
		},
	};
}
