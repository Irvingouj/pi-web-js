import {
	getAccessibleName,
	getAccessibleRole,
	shouldInclude,
} from "./dom-utils.js";

interface SnapshotNode {
	refId: number;
	role: string;
	tag: string;
	name?: string;
}

interface SnapshotResult {
	text: string;
	nodes: SnapshotNode[];
	url: string;
	title: string;
	viewport: { width: number; height: number };
}

export function inlineSnapshot(maxNodes: number): SnapshotResult {
	let nextRefId = 1;
	const nodes: SnapshotNode[] = [];
	const lines: string[] = [];

	function traverse(el: Element, depth: number) {
		if (nodes.length >= maxNodes) return;

		const tag = el.tagName.toLowerCase();
		if (
			tag === "script" ||
			tag === "style" ||
			tag === "noscript" ||
			tag === "template"
		)
			return;

		const included = shouldInclude(el);
		let currentDepth = depth;

		if (included) {
			const refId = nextRefId++;
			el.setAttribute("data-ref-id", String(refId));
			const role = getAccessibleRole(el);
			const name = getAccessibleName(el);
			const node: SnapshotNode = { refId, role, tag };
			if (name) node.name = name;
			nodes.push(node);

			const indent = "  ".repeat(depth);
			const parts = [`${indent}- ${role}`];
			if (name) parts.push(`"${name.replace(/"/g, '\\"')}"`);
			parts.push(`[ref=${refId}]`);
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
