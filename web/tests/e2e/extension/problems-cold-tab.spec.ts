import { expect, test } from "./fixtures.ts";
import { SIMPLE_FORM_1_URL } from "./lib/constants.ts";
import { runAgentCell } from "./lib/testcase-harness.ts";
import type { ContractResult } from "./lib/types.ts";

test.describe
	.serial("cold tab read/write consistency (AC-4)", () => {
		test.beforeEach(async ({ harness }) => {
			// Navigate fixture tab to chrome://version (no content script)
			await harness.fixtureTab.goto("chrome://version", {
				waitUntil: "domcontentloaded",
			});
			await harness.fixtureTab.bringToFront();
		});

		test("page.health reports missing content script on cold tab", async ({
			harness,
		}) => {
			const exec = await runAgentCell<ContractResult<{ health: unknown }>>(
				harness.sidepanel,
				[
					"const health = await page.health();",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { health } }));",
				].join("\n"),
				20_000,
			);
			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				const health = exec.result.value.health as Record<string, unknown>;
				expect(health.mutationsReady).toBe(false);
				expect(health.contentScript).toBe("missing");
				expect(["ok", "blocked"]).toContain(health.domApis);
				expect(health.hint).toBeTruthy();
				expect(health.recovery).toBeInstanceOf(Array);
				expect(health.recovery.length).toBeGreaterThan(0);
			}
		});

		test("mutation on cold tab returns specific error without raw Chrome strings", async ({
			harness,
		}) => {
			const exec = await runAgentCell<ContractResult<{ errorCode: string }>>(
				harness.sidepanel,
				[
					"try {",
					'  await page.fill({ refId: "e1", value: "test" });',
					'  print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { errorCode: "none" } }));',
					"} catch (err) {",
					"  print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { errorCode: err.code || err.message } }));",
					"}",
				].join("\n"),
				20_000,
			);
			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				// chrome://version is blocked by preflightDomTab (E_PERMISSION),
				// not content-script missing (E_CONTENT_SCRIPT). Both are acceptable
				// as long as the error is structured and no raw Chrome string leaks.
				expect(["E_CONTENT_SCRIPT", "E_PERMISSION"]).toContain(
					exec.result.value.errorCode,
				);
			}
			// Verify no raw Chrome error strings leak through
			const combined = exec.stdout + exec.stderr;
			expect(combined).not.toContain("Receiving end does not exist");
			expect(combined).not.toContain("Could not establish connection");
		});

		test("recovery via navigation enables mutations with explicit receipts", async ({
			harness,
		}) => {
			// 1. Health on cold tab
			const healthExec = await runAgentCell<
				ContractResult<{ health: unknown }>
			>(
				harness.sidepanel,
				[
					"const health = await page.health();",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { health } }));",
				].join("\n"),
				20_000,
			);
			expect(healthExec.status).toBe("success");
			expect(healthExec.result?.ok).toBe(true);
			if (healthExec.result?.ok) {
				const health = healthExec.result.value.health as Record<
					string,
					unknown
				>;
				expect(health.mutationsReady).toBe(false);
				expect(health.contentScript).toBe("missing");
			}

			// 2. Navigate fixture tab to simple-form-1 via Playwright
			// Note: page.goto from chrome://version crashes the sidepanel in this
			// E2E environment (Chrome/Playwright limitation). The unit test covers
			// page.goto recovery from a cold HTTP tab.
			await harness.fixtureTab.goto(SIMPLE_FORM_1_URL, {
				waitUntil: "domcontentloaded",
			});
			await harness.fixtureTab.bringToFront();

			// 3. Health after recovery
			const healthAfterExec = await runAgentCell<
				ContractResult<{ health: unknown }>
			>(
				harness.sidepanel,
				[
					`let formTabs = await chrome.tabs.query({ url: ${JSON.stringify(`${SIMPLE_FORM_1_URL}*`)} });`,
					"if (formTabs.length === 0) {",
					'  throw new Error("simple-form tab not found");',
					"}",
					"await chrome.tabs.update(formTabs[0].id, { active: true });",
					"const health = await page.health();",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { health } }));",
				].join("\n"),
				20_000,
			);
			expect(healthAfterExec.status).toBe("success");
			expect(healthAfterExec.result?.ok).toBe(true);
			if (healthAfterExec.result?.ok) {
				const health = healthAfterExec.result.value.health as Record<
					string,
					unknown
				>;
				expect(health.mutationsReady).toBe(true);
				expect(health.contentScript).toBe("connected");
				expect(health.domApis).toBe("ok");
				expect(health.hint).toBeUndefined();
				expect(health.recovery).toBeUndefined();
			}

			// 4. Fill and click with explicit receipts
			const mutationExec = await runAgentCell<
				ContractResult<{ fillResult: unknown; clickResult: unknown }>
			>(
				harness.sidepanel,
				[
					`let formTabs = await chrome.tabs.query({ url: ${JSON.stringify(`${SIMPLE_FORM_1_URL}*`)} });`,
					"if (formTabs.length === 0) {",
					'  throw new Error("simple-form tab not found");',
					"}",
					"await chrome.tabs.update(formTabs[0].id, { active: true });",
					"let data = await page.snapshot_data();",
					"let inputNode = null;",
					"let buttonNode = null;",
					"for (let i = 0; i < data.nodes.length; i++) {",
					"  if (data.nodes[i].tag === 'input') inputNode = data.nodes[i];",
					"  if (data.nodes[i].tag === 'button') buttonNode = data.nodes[i];",
					"}",
					"if (!inputNode || !inputNode.refId || !buttonNode || !buttonNode.refId) {",
					'  throw new Error("input or button refId not found");',
					"}",
					"const fillResult = await page.fill({ refId: inputNode.refId, value: 'Alice' });",
					"const clickResult = await page.click({ refId: buttonNode.refId });",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { fillResult, clickResult } }));",
				].join("\n"),
				20_000,
			);
			expect(
				mutationExec.status,
				`${mutationExec.stderr}\n${mutationExec.stdout}`,
			).toBe("success");
			expect(mutationExec.result?.ok).toBe(true);
			if (mutationExec.result?.ok) {
				const fillResult = mutationExec.result.value.fillResult as Record<
					string,
					unknown
				>;
				const clickResult = mutationExec.result.value.clickResult as Record<
					string,
					unknown
				>;
				expect(fillResult.ok).toBe(true);
				expect(fillResult.action).toBe("fill");
				expect(fillResult.refId).toBeTruthy();
				expect(clickResult.ok).toBe(true);
				expect(clickResult.action).toBe("click");
				expect(clickResult.refId).toBeTruthy();
			}
		});
	});
