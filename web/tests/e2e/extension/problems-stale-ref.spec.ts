import { test, expect } from "./fixtures.ts";
import { executeCell } from "./lib/harness.ts";
import { RESULT_PREFIX, STALE_REF_URL } from "./lib/constants.ts";
import type { ContractResult } from "./lib/types.ts";

function cellSource(...lines: string[]): string {
	return lines.join("\n");
}

function resultPrefixLine(): string {
	return `var RESULT_PREFIX = "${RESULT_PREFIX}";`;
}

function activateStaleRefTabSource(): string {
	const tabPattern = `${STALE_REF_URL}*`;
	return cellSource(
		`let staleTabs = await chrome.tabs.query({ url: ${JSON.stringify(tabPattern)} });`,
		"if (staleTabs.length === 0) {",
		'  throw new Error("stale-ref tab not found");',
		"}",
		"await chrome.tabs.update(staleTabs[0].id, { active: true });",
		`await page.goto(${JSON.stringify(STALE_REF_URL)});`,
	);
}

test.describe.serial("stale dynamic reference (AC-5)", () => {
	test.beforeEach(async ({ harness }) => {
		await harness.fixtureTab.goto(STALE_REF_URL, {
			waitUntil: "domcontentloaded",
		});
		await harness.fixtureTab.bringToFront();
	});

	test("T-009: capture ref, rerender, E_STALE, then re-target success", async ({
		harness,
	}) => {
		// Step 1: capture refId of #action-btn
		const captureExec = await executeCell<
			ContractResult<{ refId: string; version: string }>
		>(
			harness.sidepanel,
			cellSource(
				resultPrefixLine(),
				activateStaleRefTabSource(),
				"const btn = await page.find('#action-btn');",
				"if (btn.length === 0) throw new Error('action-btn not found');",
				"const refId = btn[0].refId;",
				"const version = btn[0].version || '';",
				"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { refId, version } }));",
			),
			20_000,
		);
		expect(captureExec.status, `${captureExec.stderr}\n${captureExec.stdout}`).toBe(
			"success",
		);
		expect(captureExec.result?.ok).toBe(true);
		const oldRefId = captureExec.result?.ok
			? captureExec.result.value.refId
			: "";
		expect(oldRefId).toMatch(/^e\d+$/);

		// Step 2: trigger rerender by clicking #rerender
		const rerenderExec = await executeCell<ContractResult<{ ok: boolean }>>(
			harness.sidepanel,
			cellSource(
				resultPrefixLine(),
				activateStaleRefTabSource(),
				"const rerenderBtn = await page.find('#rerender');",
				"if (rerenderBtn.length === 0) throw new Error('rerender btn not found');",
				"await page.click({ refId: rerenderBtn[0].refId });",
				"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { ok: true } }));",
			),
			20_000,
		);
		expect(
			rerenderExec.status,
			`${rerenderExec.stderr}\n${rerenderExec.stdout}`,
		).toBe("success");

		// Step 3: click old refId → expect E_STALE error with details.staleRefId
		const staleExec = await executeCell<
			ContractResult<{ staleRefId: string; code: string }>
		>(
			harness.sidepanel,
			cellSource(
				resultPrefixLine(),
				activateStaleRefTabSource(),
				`const oldRefId = ${JSON.stringify(oldRefId)};`,
				"let staleRefId = '';",
				"let code = '';",
				"try {",
				"  await page.click({ refId: oldRefId });",
				"} catch (e) {",
				"  const err = e;",
				"  code = err.code || '';",
				"  staleRefId = err.details?.staleRefId || '';",
				"}",
				"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { staleRefId, code } }));",
			),
			20_000,
		);
		expect(staleExec.status, `${staleExec.stderr}\n${staleExec.stdout}`).toBe("success");
		expect(staleExec.result?.ok).toBe(true);
		if (staleExec.result?.ok) {
			expect(staleExec.result.value.code).toBe("E_STALE");
			expect(staleExec.result.value.staleRefId).toBe(oldRefId);
		}

		// Step 4: re-snapshot, find new #action-btn, click it → success
		const retryExec = await executeCell<ContractResult<{ clicked: boolean }>>(
			harness.sidepanel,
			cellSource(
				resultPrefixLine(),
				activateStaleRefTabSource(),
				"const data = await page.snapshot_data();",
				"let newRefId = '';",
				"for (const node of data.nodes) {",
				"  if (node.tag === 'button' && node.name === 'Action Button') {",
				"    newRefId = node.refId;",
				"    break;",
				"  }",
				"}",
				"if (!newRefId) throw new Error('new action-btn refId not found');",
				"await page.click({ refId: newRefId });",
				"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { clicked: true } }));",
			),
			20_000,
		);
		expect(retryExec.status, `${retryExec.stderr}\n${retryExec.stdout}`).toBe("success");
		expect(retryExec.result?.ok).toBe(true);
		if (retryExec.result?.ok) {
			expect(retryExec.result.value.clicked).toBe(true);
		}
	});
});
