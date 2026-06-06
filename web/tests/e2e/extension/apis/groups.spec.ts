import { EXT_CONTRACT_APIS } from "../lib/constants.ts";
import { API_CASES } from "../lib/contract-metadata.ts";
import type { ApiGroup } from "../lib/types.ts";
import { runApiBatch } from "../lib/batch.ts";
import { assertNoHarnessErrors } from "../lib/harness.ts";
import { test } from "../fixtures.ts";

const GROUPS: ApiGroup[] = [
	"runtime",
	"fs-path-crypto",
	"storage-network",
	"chrome",
	"page-tab",
	"sidepanel",
	"security-errors",
];

test.describe.serial("extension api groups", () => {
	test.skip(!EXT_CONTRACT_APIS, "set EXT_CONTRACT_APIS=1 to run API batches");

	test.afterEach(({ harness }, testInfo) => {
		assertNoHarnessErrors(harness, testInfo);
	});

	for (const group of GROUPS) {
		test(`${group} (non-destructive)`, async ({ harness, fixture }) => {
			if (group === "page-tab" || group === "chrome") {
				await harness.fixtureTab.bringToFront();
			}
			const cases = API_CASES.filter((c) => c.group === group);
			await runApiBatch(cases, harness, fixture, false);
		});
	}
});
