import { test } from "../fixtures.ts";
import {
	type ChromeNamespace,
	chromeApis,
	namespaceNeedsFixtureTab,
} from "./chrome-apis.ts";
import { runChromeApiTest } from "./chrome-test.ts";
import { assertNoHarnessErrors } from "./harness.ts";

export type DefineChromeNamespaceOptions = {
	/** Bring fixture tab to front before each API (tabs/scripting/pageCapture). */
	focusFixtureTab?: boolean;
};

export function defineChromeNamespaceSpec(
	namespace: ChromeNamespace,
	options: DefineChromeNamespaceOptions = {},
): void {
	const apiCases = chromeApis(namespace);
	const focusFixtureTab =
		options.focusFixtureTab ?? namespaceNeedsFixtureTab(namespace);

	test.describe
		.serial(namespace, () => {
			// Contract batch builds fixture per API; typically 4–8s per cell.
			test.describe.configure({ timeout: 15_000 });

			test.beforeEach(({ harness }) => {
				harness.serviceWorkerErrors.length = 0;
				harness.browserConsoleErrors.length = 0;
			});

			test.afterEach(({ harness }, testInfo) => {
				assertNoHarnessErrors(harness, testInfo);
			});

			for (const apiCase of apiCases) {
				const runTest = apiCase.skip ? test.skip : test;
				runTest(apiCase.api, async ({ harness }, testInfo) => {
					if (focusFixtureTab) {
						await harness.fixtureTab.bringToFront();
					}
					await runChromeApiTest(harness, testInfo, apiCase, {
						runDestructive: apiCase.destructive,
					});
				});
			}
		});
}
