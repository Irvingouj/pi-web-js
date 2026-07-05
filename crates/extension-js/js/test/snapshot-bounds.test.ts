// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { collectInlineSnapshot as inlineSnapshot } from "../src/shared/cross/collect-inline-snapshot.js";

describe("T-005: max_nodes bounds snapshot work", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("max_nodes: 50 limits non-mustKeep nodes but never drops visible text", () => {
		// Build a large DOM: 200 divs each containing a button
		for (let i = 0; i < 200; i++) {
			const div = document.createElement("div");
			const btn = document.createElement("button");
			btn.textContent = `Button ${i}`;
			div.appendChild(btn);
			document.body.appendChild(div);
		}

		const result = inlineSnapshot(50);
		expect(result.nodes.filter((n) => n.mustKeep !== true)).toHaveLength(0);
		expect(result.nodes.length).toBeGreaterThan(50);
		expect(result.text).toContain("Button 199");
		expect(result.text).toContain("[e1]");
	});

	it("max_nodes: 200 returns more non-text nodes than max_nodes: 50", () => {
		// Build a large DOM: images are included but not mustKeep; visible buttons are not capped.
		for (let i = 0; i < 200; i++) {
			const img = document.createElement("img");
			img.src = `/image-${i}.png`;
			document.body.appendChild(img);
			const btn = document.createElement("button");
			btn.textContent = `Button ${i}`;
			document.body.appendChild(btn);
		}

		const result50 = inlineSnapshot(50);
		const result200 = inlineSnapshot(200);
		expect(result200.nodes.length).toBeGreaterThan(result50.nodes.length);
		expect(
			result50.nodes.filter((n) => n.mustKeep !== true).length,
		).toBeLessThanOrEqual(50);
		expect(
			result200.nodes.filter((n) => n.mustKeep !== true).length,
		).toBeLessThanOrEqual(200);
		expect(result50.text).toContain("Button 199");
		expect(result200.text).toContain("Button 199");
	});

	it("snapshot still succeeds with max_nodes bound and keeps deep visible text", () => {
		// Build a large DOM: 500 nested divs
		let parent = document.body;
		for (let i = 0; i < 500; i++) {
			const div = document.createElement("div");
			div.textContent = `Node ${i}`;
			parent.appendChild(div);
			parent = div;
		}

		const result = inlineSnapshot(50);
		expect(result.nodes.length).toBeGreaterThan(50);
		expect(result.text).toContain("Node 499");
		expect(result.url).toBeDefined();
		expect(result.title).toBeDefined();
		expect(result.viewport).toBeDefined();
	});
});
