import { expect, test } from "./fixtures.ts";
import { PIPELINE_PROBE_APIS, RESULT_PREFIX } from "./lib/constants.ts";
import {
	assertNoHarnessErrors,
	executeCell,
	restartKernel,
} from "./lib/harness.ts";
import { buildStrictRunnerSource } from "./lib/runner-source.ts";
import { parseAllSentinels } from "./lib/sentinels.ts";
import type { ContractResult } from "./lib/types.ts";

test.describe
	.serial("extension harness", () => {
		test.afterEach(({ harness }, testInfo) => {
			assertNoHarnessErrors(harness, testInfo);
		});

		test("sidepanel uses chrome-extension protocol", ({ harness }) => {
			expect(harness.sidepanel.url().startsWith("chrome-extension://")).toBe(
				true,
			);
			expect(harness.extensionId.length).toBeGreaterThan(0);
		});

		test("cells execute through UI", async ({ harness }) => {
			const exec = await executeCell<ContractResult<number>>(
				harness.sidepanel,
				`
var RESULT_PREFIX = "${RESULT_PREFIX}";
eval("var __probe = 1;");
const sum = 1 + 2 + 3;
print("human: " + sum);
print(RESULT_PREFIX + JSON.stringify({ ok: true, value: sum + __probe }));
`,
			);
			expect(exec.status, exec.stderr).toBe("success");
			expect(exec.stdout).toContain("human: 6");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value).toBe(7);
			}
		});

		test("contract pipeline loads dist runner", async ({ harness }) => {
			const exec = await executeCell(
				harness.sidepanel,
				buildStrictRunnerSource(
					PIPELINE_PROBE_APIS,
					false,
					harness.extensionId,
				),
			);
			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			const sentinels = parseAllSentinels(exec.stdout);
			expect(sentinels.length).toBe(PIPELINE_PROBE_APIS.length);
			for (const api of PIPELINE_PROBE_APIS) {
				const entry = sentinels.find((s) => s.api === api);
				expect(entry?.ok, `${api} stdout:\n${exec.stdout}`).toBe(true);
			}
		});

		test("validation errors show function, parameter, and source line", async ({
			harness,
		}) => {
			// Ensure fixture tab still exists (other tests may close stray tabs).
			await harness.fixtureTab.goto("https://extension-js.test/fixture", {
				waitUntil: "domcontentloaded",
			}).catch(() => {});
			const exec = await executeCell(
				harness.sidepanel,
				`
let tabs = await chrome.tabs.query({ url: "https://extension-js.test/*" });
if (tabs.length === 0) {
  const created = await chrome.tabs.create({ url: "https://extension-js.test/fixture", active: true });
  tabs = [created];
}
const tabId = tabs[0].id;
await web.tab.fetch({ tabId, url: 123 });
`,
			);
			expect(exec.status).toBe("error");
			expect(exec.stderr).toContain("[web.tab.fetch] (E_INVALID_PARAMS)");
			expect(exec.stderr).toContain("Invalid parameters for web.tab.fetch");
			expect(exec.stderr).toContain("url");
			expect(exec.stderr).toMatch(/line \d+/);
		});
		test("web.tab.url returns URL string without TypeError", async ({
			harness,
		}) => {
			const exec = await executeCell(
				harness.sidepanel,
				`
var RESULT_PREFIX = "${RESULT_PREFIX}";
const tabs = await chrome.tabs.query({ url: "https://extension-js.test/*" });
const tabId = tabs[0].id;
const url = await web.tab.url(tabId);
print(RESULT_PREFIX + JSON.stringify({ ok: true, value: url }));
`,
			);
			expect(exec.status, exec.stderr).toBe("success");
			expect(exec.stderr).not.toContain("[runtime error] TypeError");
			expect(exec.stdout).toContain("https://extension-js.test");
		});

		test("web.tab.url invalid tabId shows structured E_INVALID_PARAMS", async ({
			harness,
		}) => {
			const exec = await executeCell(
				harness.sidepanel,
				`await web.tab.url("not-a-tab");`,
			);
			expect(exec.status).toBe("error");
			expect(exec.stderr).toContain("[web.tab.url] (E_INVALID_PARAMS)");
			expect(exec.stderr).toContain("at 'tabId'");
			expect(exec.stderr).toMatch(/line \d+/);
			expect(exec.stderr).not.toContain("[runtime error] TypeError");
		});

		test("missing web.tab.nope shows E_UNKNOWN_API with available siblings", async ({
			harness,
		}) => {
			const exec = await executeCell(
				harness.sidepanel,
				`await web.tab.nope();`,
			);
			expect(exec.status).toBe("error");
			expect(exec.stderr).toContain("[web.tab.nope] (E_UNKNOWN_API)");
			expect(exec.stderr).toContain("Available:");
			expect(exec.stderr).not.toContain("[runtime error] TypeError");
		});

		test("chrome.scripting.executeScript with func shows E_UNTRANSPORTABLE_PARAM", async ({
			harness,
		}) => {
			const exec = await executeCell(
				harness.sidepanel,
				`
const tabs = await chrome.tabs.query({ url: "https://extension-js.test/*" });
const tabId = tabs[0].id;
await chrome.scripting.executeScript({ target: { tabId }, func: () => 1 });
`,
			);
			expect(exec.status).toBe("error");
			expect(exec.stderr).toContain(
				"[chrome.scripting.executeScript] (E_UNTRANSPORTABLE_PARAM)",
			);
			expect(exec.stderr).toContain("web.tab.evaluate");
			expect(exec.stderr).not.toContain("[runtime error] TypeError");
		});

		test("kernel session survives restart and errors", async ({ harness }) => {
			const store = await executeCell(
				harness.sidepanel,
				`var RESULT_PREFIX = "${RESULT_PREFIX}"; contract_step = 42; await fs.writeText("/__contract_persist.txt", "42"); print(RESULT_PREFIX + JSON.stringify({ ok: true, value: "stored" }));`,
			);
			expect(store.status).toBe("success");

			const read = await executeCell<ContractResult<string>>(
				harness.sidepanel,
				`var RESULT_PREFIX = "${RESULT_PREFIX}"; const txt = await fs.readText("/__contract_persist.txt"); print(RESULT_PREFIX + JSON.stringify({ ok: true, value: txt }));`,
			);
			expect(read.status).toBe("success");
			const parsed = parseAllSentinels(read.stdout)[0];
			expect(parsed?.ok).toBe(true);
			if (parsed?.ok) {
				expect(parsed.value).toBe("42");
			}

			await restartKernel(harness.sidepanel);
			const afterRestart = await executeCell<ContractResult<null>>(
				harness.sidepanel,
				`var RESULT_PREFIX = "${RESULT_PREFIX}"; print(RESULT_PREFIX + JSON.stringify({ ok: true, value: typeof contract_step === "undefined" ? null : contract_step }));`,
			);
			expect(afterRestart.status).toBe("success");
			const restartParsed = parseAllSentinels(afterRestart.stdout)[0];
			expect(restartParsed?.ok).toBe(true);
			if (restartParsed?.ok) {
				expect(restartParsed.value).toBeNull();
			}

			const bad = await executeCell(
				harness.sidepanel,
				`throw new Error("intentional");`,
			);
			expect(bad.status).toBe("error");

			const good = await executeCell<ContractResult<number>>(
				harness.sidepanel,
				`var RESULT_PREFIX = "${RESULT_PREFIX}"; const vals = await Promise.all([Promise.resolve(20), Promise.resolve(30)]); print(RESULT_PREFIX + JSON.stringify({ ok: true, value: vals[0] + vals[1] }));`,
			);
			expect(good.status).toBe("success");
			const promiseParsed = parseAllSentinels(good.stdout)[0];
			expect(promiseParsed?.ok).toBe(true);
			if (promiseParsed?.ok) {
				expect(promiseParsed.value).toBe(50);
			}
		});
	});
