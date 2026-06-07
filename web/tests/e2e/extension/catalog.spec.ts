import {
	EXTENSION_GLOBAL_GAP_APIS,
	EXTENSION_TIMER_GAP_APIS,
} from "./lib/constants.ts";
import {
	API_CASES,
	CONTRACT_MANIFEST,
} from "./lib/contract-metadata.ts";
import {
	assertNoHarnessErrors,
	inspectPublicApis,
	executeCell,
	restartKernel,
} from "./lib/harness.ts";
import { auditChromeHandlerCoverage } from "./lib/chrome-handler-audit.ts";
import { RESULT_PREFIX } from "./lib/constants.ts";
import { parseAllSentinels } from "./lib/sentinels.ts";
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

	test("every chrome contract API has a runner handler", () => {
		const { missing, registeredCount, chromeApiCount } =
			auditChromeHandlerCoverage();
		expect(
			missing,
			`missing chrome handlers (${registeredCount}/${chromeApiCount} registered): ${missing.join(", ")}`,
		).toEqual([]);
	});

	test("chrome cookies trigger vs callback params", async ({ harness }) => {
		const exec = await executeCell(
			harness.sidepanel,
			`
var RESULT_PREFIX = "${RESULT_PREFIX}";
const runnerUrl = "chrome-extension://${harness.extensionId}/e2e/contract-batch-runner.js";
const contractUrl = "chrome-extension://${harness.extensionId}/e2e/all-apis-extension-contract.js";
const runnerRes = await web.fetch(runnerUrl);
eval(runnerRes.body);
const contractRes = await web.fetch(contractUrl);
let triggerParams = null;
const orig = globalThis.__webJsTriggerAsync;
globalThis.__webJsTriggerAsync = function(action, params, resolve, reject) {
  if (action === "chrome_cookies_get") triggerParams = params;
  return orig(action, params, resolve, reject);
};
try {
  await runContractBatch(contractRes.body, ["chrome.cookies.get"], false, RESULT_PREFIX);
} finally {
  globalThis.__webJsTriggerAsync = orig;
}
print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { triggerParams, triggerJson: JSON.stringify(triggerParams) } }));
`,
			15_000,
		);
		expect(exec.status).toBe("success");
		const parsed = parseAllSentinels(exec.stdout);
		const entry = parsed.find(
			(p) => p.ok && p.value && (p.value as { triggerParams?: unknown }).triggerParams,
		);
		expect(entry?.ok).toBe(true);
		if (entry?.ok) {
			const value = entry.value as {
				triggerParams?: unknown[];
				triggerJson?: string;
			};
			expect(Array.isArray(value.triggerParams)).toBe(true);
			expect(value.triggerParams).toHaveLength(1);
			expect(value.triggerJson).toBe(
				JSON.stringify([
					{
						url: "https://extension-js.test/fixture",
						name: "web_js_contract",
					},
				]),
			);
			const details = (value.triggerParams as unknown[])[0] as Record<
				string,
				unknown
			>;
			expect(details?.url).toBe("https://extension-js.test/fixture");
			expect(details?.name).toBe("web_js_contract");
		}
		// eval + __webJsTriggerAsync monkeypatch leaves the shared kernel in a bad state.
		await restartKernel(harness.sidepanel);
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
