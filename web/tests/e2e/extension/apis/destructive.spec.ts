import { EXT_CONTRACT_APIS } from "../lib/constants.ts";
import { API_CASES } from "../lib/contract-metadata.ts";
import { runApiBatch } from "../lib/batch.ts";
import { assertNoHarnessErrors } from "../lib/harness.ts";
import { test } from "../fixtures.ts";

test.describe.serial("extension api destructive", () => {
	test.skip(!EXT_CONTRACT_APIS, "set EXT_CONTRACT_APIS=1 to run API batches");

	test.afterEach(({ harness }, testInfo) => {
		assertNoHarnessErrors(harness, testInfo);
	});

	const batches: Array<{
		name: string;
		focusFixture?: boolean;
		filter: (typeof API_CASES)[number][];
	}> = [
		{
			name: "chrome",
			filter: API_CASES.filter((c) => c.group === "chrome" && c.destructive),
		},
		{
			name: "page-tab",
			focusFixture: true,
			filter: API_CASES.filter((c) => c.group === "page-tab" && c.destructive),
		},
		{
			name: "fs-path-crypto",
			filter: API_CASES.filter(
				(c) => c.group === "fs-path-crypto" && c.destructive,
			),
		},
		{
			name: "storage-network",
			filter: API_CASES.filter(
				(c) => c.group === "storage-network" && c.destructive,
			),
		},
		{
			name: "sidepanel",
			filter: API_CASES.filter((c) => c.group === "sidepanel" && c.destructive),
		},
	];

	for (const batch of batches) {
		test(batch.name, async ({ harness, fixture }) => {
			if (batch.focusFixture) {
				await harness.fixtureTab.bringToFront();
			}
			if (batch.filter.length === 0) return;
			await runApiBatch(batch.filter, harness, fixture, true);
		});
	}
});
