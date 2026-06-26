import { describe, expect, it } from "vitest";
import type { InlineSnapshotNode } from "../src/shared/cross/collect-inline-snapshot.js";
import { filterNodes } from "../src/shared/cross/snapshot-filter.js";

function node(
	overrides: Partial<InlineSnapshotNode> &
		Pick<InlineSnapshotNode, "refId" | "role" | "tag">,
): InlineSnapshotNode {
	return overrides;
}

const allNodes: InlineSnapshotNode[] = [
	node({
		refId: "e1",
		role: "button",
		tag: "button",
		name: "Sign in",
		text: "Sign in",
	}),
	node({
		refId: "e2",
		role: "link",
		tag: "a",
		name: "Home",
		text: "Home",
		href: "https://example.com/",
	}),
	node({ refId: "e3", role: "textbox", tag: "input", name: "Email", text: "" }),
	node({
		refId: "e4",
		role: "heading",
		tag: "h1",
		name: "Welcome",
		text: "Welcome",
	}),
	node({
		refId: "e5",
		role: "generic",
		tag: "div",
		text: "Some paragraph text",
	}),
	node({
		refId: "e6",
		role: "img",
		tag: "img",
		name: "Logo",
		src: "https://example.com/logo.png",
	}),
	node({
		refId: "e7",
		role: "checkbox",
		tag: "input",
		name: "Remember me",
		text: "",
	}),
	node({
		refId: "e8",
		role: "link",
		tag: "a",
		name: "Documentation",
		text: "Docs",
		href: "https://example.com/docs",
	}),
];

describe("filterNodes", () => {
	it("returns all nodes with empty filter", () => {
		expect(filterNodes(allNodes, {})).toHaveLength(allNodes.length);
	});

	it("returns empty for empty input", () => {
		expect(filterNodes([], { role: "button" })).toHaveLength(0);
	});

	it("filters by single role", () => {
		const result = filterNodes(allNodes, { role: "button" });
		expect(result).toHaveLength(1);
		expect(result[0].refId).toBe("e1");
	});

	it("filters by multiple roles", () => {
		const result = filterNodes(allNodes, { role: ["button", "link"] });
		expect(result).toHaveLength(3);
		expect(result.map((n) => n.refId)).toEqual(["e1", "e2", "e8"]);
	});

	it("filters by single tag", () => {
		const result = filterNodes(allNodes, { tag: "a" });
		expect(result).toHaveLength(2);
		expect(result.map((n) => n.refId)).toEqual(["e2", "e8"]);
	});

	it("filters by multiple tags", () => {
		const result = filterNodes(allNodes, { tag: ["input", "img"] });
		expect(result).toHaveLength(3);
		expect(result.map((n) => n.refId)).toEqual(["e3", "e6", "e7"]);
	});

	it("filters by text substring (case-insensitive)", () => {
		const result = filterNodes(allNodes, { text: "sign" });
		expect(result).toHaveLength(1);
		expect(result[0].refId).toBe("e1");
	});

	it("filters by text RegExp", () => {
		const result = filterNodes(allNodes, { text: /^Welcome$/ });
		expect(result).toHaveLength(1);
		expect(result[0].refId).toBe("e4");
	});

	it("filters by name substring", () => {
		const result = filterNodes(allNodes, { name: "remember" });
		expect(result).toHaveLength(1);
		expect(result[0].refId).toBe("e7");
	});

	it("filters by name RegExp", () => {
		const result = filterNodes(allNodes, { name: /Doc/ });
		expect(result).toHaveLength(1);
		expect(result[0].refId).toBe("e8");
	});

	it("filters by href substring", () => {
		const result = filterNodes(allNodes, { href: "/docs" });
		expect(result).toHaveLength(1);
		expect(result[0].refId).toBe("e8");
	});

	it("filters by src substring", () => {
		const result = filterNodes(allNodes, { src: "logo" });
		expect(result).toHaveLength(1);
		expect(result[0].refId).toBe("e6");
	});

	it("filters interactiveOnly", () => {
		const result = filterNodes(allNodes, { interactiveOnly: true });
		expect(result.map((n) => n.refId)).toEqual(["e1", "e2", "e3", "e7", "e8"]);
	});

	it("applies limit after filtering", () => {
		const result = filterNodes(allNodes, { role: "link", limit: 1 });
		expect(result).toHaveLength(1);
		expect(result[0].refId).toBe("e2");
	});

	it("combines filters with AND logic", () => {
		const result = filterNodes(allNodes, { role: "link", href: "/docs" });
		expect(result).toHaveLength(1);
		expect(result[0].refId).toBe("e8");
	});

	it("combines interactiveOnly with text filter", () => {
		const result = filterNodes(allNodes, {
			interactiveOnly: true,
			text: "sign",
		});
		expect(result).toHaveLength(1);
		expect(result[0].refId).toBe("e1");
	});

	it("matches mixed-case node role with lowercase filter", () => {
		const nodes = [node({ role: "Button", tag: "button", refId: "e1" })];
		const result = filterNodes(nodes, { role: "button" });
		expect(result).toHaveLength(1);
		expect(result[0].refId).toBe("e1");
	});

	it("matches lowercase node role with uppercase filter input", () => {
		const nodes = [node({ role: "button", tag: "button", refId: "e1" })];
		const result = filterNodes(nodes, { role: "BUTTON" });
		expect(result).toHaveLength(1);
		expect(result[0].refId).toBe("e1");
	});

	it("does not crash when role is a number; returns empty", () => {
		const nodes = [node({ role: "button", tag: "button", refId: "e1" })];
		const result = filterNodes(nodes, { role: 42 as any });
		expect(result).toHaveLength(0);
	});

	it("still matches valid entries when array contains a number", () => {
		const nodes = [
			node({ role: "button", tag: "button", refId: "e1" }),
			node({ role: "link", tag: "a", refId: "e2" }),
		];
		const result = filterNodes(nodes, { role: ["button", 99] as any });
		expect(result).toHaveLength(1);
		expect(result[0].refId).toBe("e1");
	});
});
