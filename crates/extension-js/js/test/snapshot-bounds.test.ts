// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { inlineSnapshot } from "../src/content-script/snapshot.js";

describe("T-005: max_nodes bounds snapshot work", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("max_nodes: 50 returns no more than 50 nodes", () => {
		// Build a large DOM: 200 divs each containing a button
		for (let i = 0; i < 200; i++) {
			const div = document.createElement("div");
			const btn = document.createElement("button");
			btn.textContent = `Button ${i}`;
			div.appendChild(btn);
			document.body.appendChild(div);
		}

		const result = inlineSnapshot(50);
		expect(result.nodes.length).toBeLessThanOrEqual(50);
		expect(result.text).toContain("[e1]");
	});

	it("max_nodes: 200 returns more nodes than max_nodes: 50", () => {
		// Build a large DOM: 200 divs each containing a button
		for (let i = 0; i < 200; i++) {
			const div = document.createElement("div");
			const btn = document.createElement("button");
			btn.textContent = `Button ${i}`;
			div.appendChild(btn);
			document.body.appendChild(div);
		}

		const result50 = inlineSnapshot(50);
		const result200 = inlineSnapshot(200);
		expect(result200.nodes.length).toBeGreaterThan(result50.nodes.length);
		expect(result50.nodes.length).toBeLessThanOrEqual(50);
		expect(result200.nodes.length).toBeLessThanOrEqual(200);
	});

	it("snapshot still succeeds with max_nodes bound on large DOM", () => {
		// Build a large DOM: 500 nested divs
		let parent = document.body;
		for (let i = 0; i < 500; i++) {
			const div = document.createElement("div");
			div.textContent = `Node ${i}`;
			parent.appendChild(div);
			parent = div;
		}

		const result = inlineSnapshot(50);
		expect(result.nodes.length).toBeLessThanOrEqual(50);
		expect(result.url).toBeDefined();
		expect(result.title).toBeDefined();
		expect(result.viewport).toBeDefined();
	});
});
