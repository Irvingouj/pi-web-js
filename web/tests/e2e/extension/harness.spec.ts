import { PIPELINE_PROBE_APIS, RESULT_PREFIX } from "./lib/constants.ts";
import { buildStrictRunnerSource } from "./lib/runner-source.ts";
import { parseAllSentinels } from "./lib/sentinels.ts";
import {
	assertNoHarnessErrors,
	executeCell,
	restartKernel,
} from "./lib/harness.ts";
import type { ContractResult } from "./lib/types.ts";
import { test, expect } from "./fixtures.ts";

test.describe.serial("extension harness", () => {
	test.afterEach(({ harness }, testInfo) => {
		assertNoHarnessErrors(harness, testInfo);
	});

	test("sidepanel uses chrome-extension protocol", ({ harness }) => {
		expect(harness.sidepanel.url().startsWith("chrome-extension://")).toBe(true);
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
		const exec = await executeCell(harness.sidepanel, buildStrictRunnerSource(
			PIPELINE_PROBE_APIS,
			false,
			harness.extensionId,
		));
		expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
		const sentinels = parseAllSentinels(exec.stdout);
		expect(sentinels.length).toBe(PIPELINE_PROBE_APIS.length);
		for (const api of PIPELINE_PROBE_APIS) {
			const entry = sentinels.find((s) => s.api === api);
			expect(entry?.ok, `${api} stdout:\n${exec.stdout}`).toBe(true);
		}
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

		const bad = await executeCell(harness.sidepanel, `throw new Error("intentional");`);
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
