import { expect, type TestInfo } from "@playwright/test";
import { CHROME_PROPERTY_ONLY } from "./chrome-handler-audit.ts";
import { chromeRunnerAction } from "./chrome-apis.ts";
import { parseChromeApiSentinel } from "./chrome-fixture.ts";
import { executeCell } from "./harness.ts";
import { buildStrictRunnerSource } from "./runner-source.ts";
import { EXT_E2E_ATTACH_ALWAYS } from "./constants.ts";
import { parseAllSentinels } from "./sentinels.ts";
import type {
	ApiCase,
	CellExecution,
	ContractResult,
	ExtensionHarness,
} from "./types.ts";

export type RunChromeApiTestOptions = {
	runDestructive: boolean;
};

function formatExpectation(apiCase: ApiCase): string {
	return `contract:${apiCase.contractExpected}${apiCase.expectedCode ? `:${apiCase.expectedCode}` : ""}`;
}

function sliceRuntimeLogs(
	harness: ExtensionHarness,
	fromIndex: number,
): string[] {
	return harness.runtimeLogs.slice(fromIndex);
}

async function attachChromeDiagnostics(
	testInfo: TestInfo,
	harness: ExtensionHarness,
	apiCase: ApiCase,
	execution: CellExecution<ContractResult>,
	runtimeSlice: string[],
	extra?: Record<string, string>,
): Promise<void> {
	const sentinel = parseChromeApiSentinel(execution.stdout);
	const kernelStatus = await harness.sidepanel
		.locator('[data-testid="kernel-status"]')
		.textContent()
		.catch(() => "");

	const body = [
		`api: ${apiCase.api}`,
		`expectation: ${formatExpectation(apiCase)}`,
		`destructive: ${apiCase.destructive}`,
		`contractExpected: ${apiCase.contractExpected}`,
		`expectedCode: ${apiCase.expectedCode || "(none)"}`,
		`cellStatus: ${execution.status}`,
		`extensionId: ${harness.extensionId}`,
		`sidepanelUrl: ${harness.sidepanel.url()}`,
		`kernelStatus: ${kernelStatus ?? ""}`,
		extra ? Object.entries(extra).map(([k, v]) => `${k}: ${v}`).join("\n") : "",
		"",
		"--- sentinel ---",
		sentinel ? JSON.stringify(sentinel, null, 2) : "(missing)",
		"",
		"--- stdout ---",
		execution.stdout || "(empty)",
		"",
		"--- stderr ---",
		execution.stderr || "(empty)",
		"",
		"--- runtime logs (last 200) ---",
		runtimeSlice.slice(-200).join("\n") || "(none)",
		"",
		"--- service worker errors ---",
		harness.serviceWorkerErrors.join("\n") || "(none)",
		"",
		"--- browser console errors ---",
		harness.browserConsoleErrors.join("\n") || "(none)",
	].join("\n");

	await testInfo.attach(`chrome-e2e-failure-${apiCase.api.replace(/\./g, "_")}`, {
		body,
		contentType: "text/plain",
	});
}

function assertChromeContractResult(
	apiCase: ApiCase,
	execution: CellExecution<ContractResult>,
): void {
	const sentinels = parseAllSentinels(execution.stdout);
	const entry = sentinels.find((s) => s.api === apiCase.api);
	expect(entry, `${apiCase.api} sentinel missing\nstdout:\n${execution.stdout}`).toBeTruthy();

	if (apiCase.contractExpected === "success") {
		expect(
			entry?.ok,
			`${apiCase.api} ok=false error=${JSON.stringify(entry && !entry.ok ? entry.error : null)}`,
		).toBe(true);
		return;
	}

	expect(entry?.ok, `${apiCase.api} contract wrapper`).toBe(true);
	if (!entry?.ok || !apiCase.expectedCode) return;

	const value = entry.value as Record<string, unknown>;
	const err =
		(value.typedError as { code?: string; message?: string }) ||
		(value.thrown as { code?: string; message?: string }) ||
		(value.rejected as { code?: string; message?: string });
	const haystack = `${err?.code ?? ""} ${err?.message ?? ""} ${JSON.stringify(value)}`;
	expect(
		haystack.includes(apiCase.expectedCode),
		`${apiCase.api} expected code ${apiCase.expectedCode} in ${haystack}`,
	).toBe(true);
}

function assertTransportLogs(
	apiCase: ApiCase,
	stderr: string,
	runtimeSlice: string[],
): void {
	expect(
		stderr,
		`${apiCase.api} must not hit argument transport rejection`,
	).not.toContain("E_INVALID_ARGUMENT_TRANSPORT");

	if (CHROME_PROPERTY_ONLY.has(apiCase.api)) {
		return;
	}

	if (apiCase.contractExpected !== "success") {
		return;
	}

	const action = chromeRunnerAction(apiCase.api);
	const haystack = runtimeSlice.join("\n");
	expect(
		haystack.includes(`action=${action}`) ||
			haystack.includes(`action="${action}"`),
		`${apiCase.api}: expected runner log for action=${action}\nlogs:\n${haystack.slice(-4000)}`,
	).toBe(true);
}

export async function runChromeApiTest(
	harness: ExtensionHarness,
	testInfo: TestInfo,
	apiCase: ApiCase,
	opts: RunChromeApiTestOptions,
): Promise<void> {
	const logStart = harness.runtimeLogs.length;

	testInfo.annotations.push({ type: "api", description: apiCase.api });
	testInfo.annotations.push({
		type: "expectation",
		description: formatExpectation(apiCase),
	});
	testInfo.annotations.push({
		type: "destructive",
		description: String(apiCase.destructive),
	});
	console.log(
		`[chrome-e2e] starting ${apiCase.api} destructive=${opts.runDestructive} expectation=${formatExpectation(apiCase)}`,
	);

	const t0 = Date.now();
	const source = buildStrictRunnerSource(
		[apiCase.api],
		opts.runDestructive,
		harness.extensionId,
	);
	const execution = await executeCell<ContractResult>(
		harness.sidepanel,
		source,
		15_000,
	);
	const cellElapsedMs = Date.now() - t0;
	const runtimeSlice = sliceRuntimeLogs(harness, logStart);

	testInfo.annotations.push({
		type: "cell_elapsed_ms",
		description: String(cellElapsedMs),
	});
	console.log(
		`[chrome-e2e] finished ${apiCase.api} status=${execution.status} cell_elapsed_ms=${cellElapsedMs}`,
	);

	const sentinels = parseAllSentinels(execution.stdout);
	const entry = sentinels.find((s) => s.api === apiCase.api);

	try {
		expect(execution.status, `${apiCase.api} cell status`).toBe("success");
		expect(entry, `${apiCase.api} sentinel missing\nstdout:\n${execution.stdout}`).toBeTruthy();

		assertChromeContractResult(apiCase, execution);
		assertTransportLogs(apiCase, execution.stderr, runtimeSlice);

		if (EXT_E2E_ATTACH_ALWAYS) {
			await attachChromeDiagnostics(
				testInfo,
				harness,
				apiCase,
				execution,
				runtimeSlice,
				{ outcome: "success" },
			);
		}
	} catch (error) {
		await attachChromeDiagnostics(
			testInfo,
			harness,
			apiCase,
			execution,
			runtimeSlice,
			{
				outcome: "failure",
				error: error instanceof Error ? error.message : String(error),
			},
		);
		throw error;
	}
}
