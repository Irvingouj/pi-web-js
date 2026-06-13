import { CHROME_FIXTURE_PREFIX, RESULT_PREFIX } from "./constants.ts";
import { executeCell } from "./harness.ts";
import { parseSentinelLine } from "./sentinels.ts";
import type { ExtensionHarness } from "./types.ts";

export type ChromeFixtureSummary = {
	ok: boolean;
	bookmarkId: string;
	bookmarkFolderId: string;
	createdTabId: number | null;
	createdWindowId: number | null;
	sessionId: string;
	activeTabId: number | null;
};

function buildChromeRunnerBootstrap(extensionId: string): string {
	return `
if (typeof globalThis.runChromeFixtureSetup !== "function") {
	var runnerUrl = "chrome-extension://${extensionId}/e2e/contract-batch-runner.js";
	var runnerRes = await web.fetch(runnerUrl);
	eval(runnerRes.body);
}
var contractUrl = "chrome-extension://${extensionId}/e2e/all-apis-extension-contract.js";
var contractRes = await web.fetch(contractUrl);
var __chromeContractSource = contractRes.body;
`;
}

export function buildChromeFixtureSetupSource(
	extensionId: string,
	runDestructive: boolean,
): string {
	return `
var FIXTURE_PREFIX = "${CHROME_FIXTURE_PREFIX}";
${buildChromeRunnerBootstrap(extensionId)}
await runChromeFixtureSetup(__chromeContractSource, ${runDestructive}, FIXTURE_PREFIX);
`;
}

export function buildChromeFixtureTeardownSource(
	extensionId: string,
	runDestructive: boolean,
): string {
	return `
${buildChromeRunnerBootstrap(extensionId)}
await runChromeFixtureTeardown(__chromeContractSource, ${runDestructive});
print("${RESULT_PREFIX}" + JSON.stringify({ ok: true, value: "chrome-fixture-teardown" }));
`;
}

export function buildChromeApiSource(
	extensionId: string,
	apiName: string,
	runDestructive: boolean,
): string {
	return `
var RESULT_PREFIX = "${RESULT_PREFIX}";
${buildChromeRunnerBootstrap(extensionId)}
await runChromeApiSingle(__chromeContractSource, ${JSON.stringify(apiName)}, ${runDestructive}, RESULT_PREFIX);
`;
}

function parseFixtureSummary(stdout: string): ChromeFixtureSummary | null {
	for (const line of stdout.split("\n")) {
		const idx = line.indexOf(CHROME_FIXTURE_PREFIX);
		if (idx < 0) continue;
		try {
			return JSON.parse(
				line.slice(idx + CHROME_FIXTURE_PREFIX.length).trim(),
			) as ChromeFixtureSummary;
		} catch {
			return null;
		}
	}
	return null;
}

export async function loadChromeFixture(
	harness: ExtensionHarness,
	runDestructive: boolean,
): Promise<ChromeFixtureSummary> {
	const t0 = Date.now();
	const exec = await executeCell(
		harness.sidepanel,
		buildChromeFixtureSetupSource(harness.extensionId, runDestructive),
		25_000,
	);
	const elapsedMs = Date.now() - t0;
	const summary = parseFixtureSummary(exec.stdout);
	if (!summary?.ok) {
		throw new Error(
			`chrome fixture setup failed (${elapsedMs}ms): status=${exec.status}\nstderr:\n${exec.stderr}\nstdout:\n${exec.stdout}`,
		);
	}
	console.log(
		`[chrome-e2e] fixture ready destructive=${runDestructive} elapsed_ms=${elapsedMs} bookmarkId=${summary.bookmarkId}`,
	);
	return summary;
}

export async function teardownChromeFixture(
	harness: ExtensionHarness,
	runDestructive: boolean,
): Promise<void> {
	const exec = await executeCell(
		harness.sidepanel,
		buildChromeFixtureTeardownSource(harness.extensionId, runDestructive),
		25_000,
	);
	if (exec.status !== "success") {
		console.warn(
			`[chrome-e2e] fixture teardown warning:\n${exec.stderr}\n${exec.stdout}`,
		);
	}
}

export function parseChromeApiSentinel(stdout: string) {
	const line = stdout
		.split("\n")
		.reverse()
		.find((l) => l.includes(RESULT_PREFIX));
	if (!line) return null;
	return parseSentinelLine(line);
}
