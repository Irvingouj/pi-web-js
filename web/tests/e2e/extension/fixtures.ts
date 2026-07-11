import { test as base } from "@playwright/test";
import {
	clearHarnessErrors,
	createFixture,
	executeCell,
	launchExtension,
	teardownExtension,
} from "./lib/harness.ts";
import type { ExtensionFixture, ExtensionHarness } from "./lib/types.ts";

type WorkerFixtures = {
	harness: ExtensionHarness;
	fixture: ExtensionFixture;
};

export const test = base.extend<object, WorkerFixtures>({
	harness: [
		async ({}, use) => {
			const harness = await launchExtension();
			const warmup = await executeCell(
				harness.sidepanel,
				'await web.sleep(1); print("extension-e2e-warmup");',
			);
			if (
				warmup.status !== "success" ||
				!warmup.stdout.includes("extension-e2e-warmup")
			) {
				throw new Error(
					`extension harness warmup failed: ${warmup.stderr}\n${warmup.stdout}`,
				);
			}
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
	// Auto: isolate console/SW error buffers per test. The harness is worker-scoped
	// and otherwise accumulates pageerrors across the whole file/worker, causing
	// flaky afterEach failures unrelated to the current test.
	// biome-ignore lint/correctness/noEmptyPattern: Playwright fixture API
	_clearHarnessErrors: [
		async ({ harness }, use) => {
			clearHarnessErrors(harness);
			await use(undefined);
		},
		{ auto: true },
	],
});

export { expect } from "@playwright/test";
