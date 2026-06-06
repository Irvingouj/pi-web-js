import {
	EXTENSION_GLOBAL_GAP_APIS,
	EXTENSION_TIMER_GAP_APIS,
} from "./lib/constants.ts";
import {
	API_CASES,
	CONTRACT_MANIFEST,
} from "./lib/contract-metadata.ts";
import { assertNoHarnessErrors, inspectPublicApis } from "./lib/harness.ts";
import { test, expect } from "./fixtures.ts";

test.describe.serial("extension catalog", () => {
	test.afterEach(({ harness }, testInfo) => {
		assertNoHarnessErrors(harness, testInfo);
	});
	test("metadata gaps and manifest are consistent", () => {
		const timerGaps = API_CASES.filter(
			(c) =>
				c.expectation.kind === "error" &&
				c.expectation.code === "E_TIMER_UNSUPPORTED",
		);
		expect(timerGaps.length).toBe(EXTENSION_TIMER_GAP_APIS.size);
		for (const api of EXTENSION_TIMER_GAP_APIS) {
			expect(timerGaps.some((c) => c.api === api)).toBe(true);
		}

		const globalGaps = API_CASES.filter(
			(c) =>
				c.expectation.kind === "error" &&
				c.expectation.code === "E_GLOBAL_UNSUPPORTED",
		);
		expect(globalGaps.length).toBe(EXTENSION_GLOBAL_GAP_APIS.size);
		for (const api of EXTENSION_GLOBAL_GAP_APIS) {
			expect(globalGaps.some((c) => c.api === api)).toBe(true);
		}

		const permissionGaps = API_CASES.filter(
			(c) => c.expectation.kind === "permission_error",
		);
		expect(permissionGaps.length).toBeGreaterThan(0);
		for (const apiCase of permissionGaps) {
			expect(apiCase.expectation.kind).toBe("permission_error");
			if (apiCase.expectation.kind === "permission_error") {
				expect(apiCase.expectation.permission.length).toBeGreaterThan(0);
			}
		}

		const catalog = API_CASES.map((c) => c.api);
		const catalogSet = new Set(catalog);
		expect(catalog.length).toBe(CONTRACT_MANIFEST.length);
		expect(catalogSet.size).toBe(CONTRACT_MANIFEST.length);
		expect(CONTRACT_MANIFEST.filter((a) => !catalogSet.has(a))).toEqual([]);
		expect(catalog.filter((a) => !CONTRACT_MANIFEST.includes(a))).toEqual([]);
	});

	test("runtime.inspect indexes catalog namespaces", async ({ harness }) => {
		const inspected = await inspectPublicApis(harness.sidepanel);
		expect(inspected.size).toBeGreaterThan(20);
		const catalogRoots = new Set(
			API_CASES.map((apiCase) => apiCase.api.split(".")[0]),
		);
		for (const root of catalogRoots) {
			if (root === "t" || root === "global") continue;
			const seen =
				inspected.has(root) ||
				[...inspected].some(
					(api) => api === root || api.startsWith(`${root}.`),
				);
			expect(seen, `catalog root ${root}`).toBe(true);
		}
	});
});
