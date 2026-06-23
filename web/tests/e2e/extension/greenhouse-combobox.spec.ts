import { expect, test } from "./fixtures.ts";
import { GREENHOUSE_COMBOBOX_URL, RESULT_PREFIX } from "./lib/constants.ts";
import { executeCell } from "./lib/harness.ts";
import type { ContractResult } from "./lib/types.ts";

function cellSource(...lines: string[]): string {
	return lines.join("\n");
}

function resultPrefixLine(): string {
	return `var RESULT_PREFIX = "${RESULT_PREFIX}";`;
}

function activateTabSource(): string {
	const tabPattern = `${GREENHOUSE_COMBOBOX_URL}*`;
	return cellSource(
		`let tabs = await chrome.tabs.query({ url: ${JSON.stringify(tabPattern)} });`,
		"if (tabs.length === 0) {",
		'  throw new Error("greenhouse-combobox tab not found");',
		"}",
		"await chrome.tabs.update(tabs[0].id, { active: true });",
		`await page.goto(${JSON.stringify(GREENHOUSE_COMBOBOX_URL)});`,
	);
}

test.describe
	.serial("greenhouse-combobox page APIs", () => {
		test.beforeEach(async ({ harness }) => {
			await harness.fixtureTab.goto(GREENHOUSE_COMBOBOX_URL, {
				waitUntil: "domcontentloaded",
			});
			await harness.fixtureTab.bringToFront();
		});

		test("select_option fills degree/veteran/disability despite persistent phone listbox", async ({
			harness,
		}) => {
			const exec = await executeCell<
				ContractResult<{ status: string; degreePhoneOk: boolean }>
			>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateTabSource(),
					"const snap = await page.snapshot_data();",
					"const combos = snap.nodes.filter(n => n.role === 'combobox');",
					"const degree = combos.find(n => (n.name || '').includes('Degree'));",
					"if (!degree) throw new Error('Degree combobox not found in snapshot');",
					"const veteran = combos.find(n => (n.name || '').includes('Veteran'));",
					"if (!veteran) throw new Error('Veteran combobox not found in snapshot');",
					"const disability = combos.find(n => (n.name || '').includes('Disability'));",
					"if (!disability) throw new Error('Disability combobox not found in snapshot');",
					'await page.select_option({ refId: degree.refId, value: "Bachelor\'s Degree" });',
					'await page.select_option({ refId: veteran.refId, value: "I don\'t wish to answer" });',
					'await page.select_option({ refId: disability.refId, value: "No" });',
					// Negative assertion: a phone-only value must NOT match on the degree combobox.
					// If the global listbox fallback were restored, this would succeed (finding
					// "Canada +1" in the phone listbox) and degreePhoneOk would be true.
					"let degreePhoneResult;",
					'await page.select_option({ refId: degree.refId, value: "Canada +1" }).then(r => { degreePhoneResult = r; }).catch(e => { degreePhoneResult = { ok: false }; });',
					"const statusFound = await page.find({ selector: '#status' });",
					"const status = statusFound.length && statusFound[0].text ? statusFound[0].text : '';",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { status: status, degreePhoneOk: degreePhoneResult.ok } }));",
				),
				30_000,
			);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				const value = exec.result.value;
				expect(value.status).toContain("degree:Bachelor's Degree");
				expect(value.status).toContain("veteran:I don't wish to answer");
				expect(value.status).toContain("disability:No");
				expect(value.degreePhoneOk).toBe(false);
			}
		});
	});
