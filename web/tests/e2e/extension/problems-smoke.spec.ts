import { expect, test } from "./fixtures.ts";
import { DYNAMIC_FEED_URL, GREENHOUSE_REAL_URL } from "./lib/constants.ts";
import { activateTestcaseTab, runAgentCell } from "./lib/testcase-harness.ts";
import type { ContractResult } from "./lib/types.ts";

function activateTabSource(url: string): string {
	const tabPattern = `${url}*`;
	return [
		`let tabs = await chrome.tabs.query({ url: ${JSON.stringify(tabPattern)} });`,
		"if (tabs.length === 0) {",
		'  throw new Error("testcase tab not found");',
		"}",
		"await chrome.tabs.update(tabs[0].id, { active: true });",
		`await page.goto(${JSON.stringify(url)});`,
	].join("\n");
}

test.describe
	.serial("T-000: problems smoke test", () => {
		test("testcase server returns 200 and page.url matches dynamic-feed fixture", async ({
			harness,
		}) => {
			await activateTestcaseTab(harness.fixtureTab, DYNAMIC_FEED_URL);

			const exec = await runAgentCell<ContractResult<{ url: string }>>(
				harness.sidepanel,
				[
					activateTabSource(DYNAMIC_FEED_URL),
					"const url = await page.url();",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { url } }));",
				].join("\n"),
				20_000,
			);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.url).toBe(DYNAMIC_FEED_URL);
			}
		});

		test("greenhouse real page snapshot exposes phone input", async ({
			harness,
		}) => {
			await activateTestcaseTab(harness.fixtureTab, GREENHOUSE_REAL_URL);

			const exec = await runAgentCell<
				ContractResult<{ refId: string; role: string; value: string }>
			>(
				harness.sidepanel,
				[
					activateTabSource(GREENHOUSE_REAL_URL),
					"const snap = await page.snapshot_data();",
					"const phone = snap.nodes.find(n => n.tag === 'input' && n.name === 'Phone' && n.role === 'textbox');",
					"if (!phone) throw new Error('phone input not found in snapshot_data');",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { refId: phone.refId, role: phone.role, value: phone.value || '' } }));",
				].join("\n"),
				20_000,
			);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.refId).toMatch(/^e\d+$/);
				expect(exec.result.value.role).toBe("textbox");
				expect(exec.result.value.value).toBe("");
			}
		});
	});
