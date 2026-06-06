import { test as base } from "@playwright/test";
import {
	createFixture,
	launchExtension,
	teardownExtension,
} from "./lib/harness.ts";
import type { ExtensionFixture, ExtensionHarness } from "./lib/types.ts";

type WorkerFixtures = {
	harness: ExtensionHarness;
	fixture: ExtensionFixture;
};

export const test = base.extend<{}, WorkerFixtures>({
	harness: [
		async ({}, use) => {
			const harness = await launchExtension();
			await use(harness);
			await teardownExtension(harness);
		},
		{ scope: "worker" },
	],
	fixture: [
		async ({ harness }, use) => {
			const fixture = await createFixture(harness);
			await use(fixture);
		},
		{ scope: "worker" },
	],
});

export { expect } from "@playwright/test";
