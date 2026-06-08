import {
	enrichFormNode,
	getAccessibleName,
	getAccessibleRole,
	shouldInclude,
} from "./snapshot-dom.js";

export type InlineSnapshotNode = {
	refId: string;
	role: string;
	tag: string;
	name?: string;
	value?: string;
	checked?: boolean;
	disabled?: boolean;
	readOnly?: boolean;
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
	let nextRefId = 1;
	const nodes: InlineSnapshotNode[] = [];
	const lines: string[] = [];

	function traverse(el: Element, depth: number) {
		if (nodes.length >= maxNodes) return;

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

		if (included) {
			const refId = "e" + nextRefId++;
			el.setAttribute("data-ref-id", refId);
			const role = getAccessibleRole(el);
			const name = getAccessibleName(el);
			const node: InlineSnapshotNode = { refId, role, tag };
			if (name) node.name = name;
			enrichFormNode(el, node as unknown as Record<string, unknown>);
			nodes.push(node);

			const indent = "  ".repeat(depth);
			const parts = [`${indent}- ${role}`];
			if (name) parts.push(`"${name.replace(/"/g, '\\"')}"`);
			parts.push(`[${refId}]`);
			lines.push(parts.join(" "));

			currentDepth = depth + 1;
		}

		for (const child of el.children) {
			traverse(child, currentDepth);
		}
	}

	if (document.body) {
		traverse(document.body, 0);
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
