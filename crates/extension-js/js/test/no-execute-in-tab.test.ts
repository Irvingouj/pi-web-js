import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const TOOLS_DIR = path.resolve(
	import.meta.dirname,
	"../src/main/runner/tools",
);

describe("first-party tools must not call executeInTab", () => {
	it("runner tool modules do not reference executeInTab or executeSnapshotInTab", () => {
		const violations: string[] = [];
		const walk = (dir: string) => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					walk(full);
					continue;
				}
				if (!entry.name.endsWith(".ts")) continue;
				if (full.includes(`${path.sep}chrome${path.sep}`)) continue;
				const text = fs.readFileSync(full, "utf8");
				if (text.includes("executeInTab") || text.includes("executeSnapshotInTab")) {
					violations.push(path.relative(TOOLS_DIR, full));
				}
			}
		};
		walk(TOOLS_DIR);
		expect(violations).toEqual([]);
	});
});
