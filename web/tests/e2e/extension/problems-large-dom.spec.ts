import { test, expect } from "./fixtures.ts";
import { executeCell } from "./lib/harness.ts";
import { RESULT_PREFIX, LARGE_DOM_URL } from "./lib/constants.ts";
import type { ContractResult } from "./lib/types.ts";

function cellSource(...lines: string[]): string {
	return lines.join("\n");
}

function resultPrefixLine(): string {
	return `var RESULT_PREFIX = "${RESULT_PREFIX}";`;
}

function activateLargeDomTabSource(): string {
	const tabPattern = `${LARGE_DOM_URL}*`;
	return cellSource(
		`let largeTabs = await chrome.tabs.query({ url: ${JSON.stringify(tabPattern)} });`,
		"if (largeTabs.length === 0) {",
		'  throw new Error("large-dom tab not found");',
		"}",
		"await chrome.tabs.update(largeTabs[0].id, { active: true });",
		`await page.goto(${JSON.stringify(LARGE_DOM_URL + "?nodes=5000")});`,
	);
}

function activateLargeDomTabSourceNoReload(): string {
	const tabPattern = `${LARGE_DOM_URL}*`;
	return cellSource(
		`let largeTabs = await chrome.tabs.query({ url: ${JSON.stringify(tabPattern)} });`,
		"if (largeTabs.length === 0) {",
		'  throw new Error("large-dom tab not found");',
		"}",
		"await chrome.tabs.update(largeTabs[0].id, { active: true });",
	);
}

test.describe.serial("large-dom snapshot (AC-2)", () => {
	test.beforeEach(async ({ harness }) => {
		await harness.fixtureTab.goto(LARGE_DOM_URL + "?nodes=5000", {
			waitUntil: "domcontentloaded",
		});
		await harness.fixtureTab.bringToFront();
	});

	test("T-007: page.snapshot() succeeds on large DOM", async ({ harness }) => {
		const exec = await executeCell<
			ContractResult<{ textLength: number; hasNodes: boolean }>
		>(
			harness.sidepanel,
			cellSource(
				resultPrefixLine(),
				activateLargeDomTabSource(),
				"const text = await page.snapshot();",
				"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: {",
				"  textLength: text.length,",
				"  hasNodes: text.includes('[e1]')",
				"} }));",
			),
			20_000,
		);

		expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
		expect(exec.result?.ok).toBe(true);
		if (exec.result?.ok) {
			expect(exec.result.value.textLength).toBeGreaterThan(0);
			expect(exec.result.value.hasNodes).toBe(true);
		}
	});

	test("T-007: page.snapshot_data({ max_nodes: 50 }) returns ≤50 nodes", async ({
		harness,
	}) => {
		const exec = await executeCell<
			ContractResult<{ nodeCount: number; success: boolean }>
		>(
			harness.sidepanel,
			cellSource(
				resultPrefixLine(),
				activateLargeDomTabSource(),
				"const data = await page.snapshot_data({ max_nodes: 50 });",
				"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: {",
				"  nodeCount: data.nodes.length,",
				"  success: data.nodes.length <= 50",
				"} }));",
			),
			20_000,
		);

		expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
		expect(exec.result?.ok).toBe(true);
		if (exec.result?.ok) {
			expect(exec.result.value.nodeCount).toBeLessThanOrEqual(50);
			expect(exec.result.value.success).toBe(true);
		}
	});

	test("T-007: page.snapshot_data({ max_nodes: 200 }) returns more nodes than 50", async ({
		harness,
	}) => {
		const exec = await executeCell<
			ContractResult<{
				count50: number;
				count200: number;
				moreThan50: boolean;
			}>
		>(
			harness.sidepanel,
			cellSource(
				resultPrefixLine(),
				activateLargeDomTabSource(),
				"const data50 = await page.snapshot_data({ max_nodes: 50 });",
				"const data200 = await page.snapshot_data({ max_nodes: 200 });",
				"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: {",
				"  count50: data50.nodes.length,",
				"  count200: data200.nodes.length,",
				"  moreThan50: data200.nodes.length > data50.nodes.length",
				"} }));",
			),
			20_000,
		);

		expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
		expect(exec.result?.ok).toBe(true);
		if (exec.result?.ok) {
			expect(exec.result.value.count50).toBeLessThanOrEqual(50);
			expect(exec.result.value.count200).toBeLessThanOrEqual(200);
			expect(exec.result.value.moreThan50).toBe(true);
		}
	});

	test("T-007: snapshot during concurrent rerender returns structured result", async ({
		harness,
	}) => {
		await harness.fixtureTab.click("#rerender");

		const exec = await executeCell<
			ContractResult<{
				hasNodes: boolean;
				hasStructuredMutationCause: boolean;
				noGenericError: boolean;
			}>
		>(
			harness.sidepanel,
			cellSource(
				resultPrefixLine(),
				activateLargeDomTabSourceNoReload(),
				"let hasNodes = false;",
				"let hasStructuredMutationCause = false;",
				"let noGenericError = true;",
				"try {",
				"  const data = await page.snapshot_data({ max_nodes: 50 });",
				"  hasNodes = data.nodes.length > 0;",
				"} catch (e) {",
				"  const err = typeof e === 'object' && e ? e : {};",
				"  const details = err.details || {};",
				"  if (details.cause === 'dom_mutated_during_snapshot') {",
				"    hasStructuredMutationCause = true;",
				"  }",
				"  const msg = String(e);",
				"  if (msg.includes('Failed to get page snapshot') && !msg.includes('cause')) {",
				"    noGenericError = false;",
				"  }",
				"}",
				"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: {",
				"  hasNodes: hasNodes,",
				"  hasStructuredMutationCause: hasStructuredMutationCause,",
				"  noGenericError: noGenericError",
				"} }));",
			),
			20_000,
		);

		expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
		expect(exec.result?.ok).toBe(true);
		if (exec.result?.ok) {
			expect(
				exec.result.value.hasNodes || exec.result.value.hasStructuredMutationCause,
			).toBe(true);
			expect(exec.result.value.noGenericError).toBe(true);
		}
	});

	test("T-007: rerender does not produce generic E_SNAPSHOT", async ({
		harness,
	}) => {
		// Trigger rerender by clicking the rerender button in the fixture tab
		await harness.fixtureTab.click("#rerender");
		// Wait for the DOM rebuild to complete (5000 nodes in 100-node rAF batches)
		await harness.fixtureTab.waitForSelector("body[data-rerender-complete='true']", {
			timeout: 10_000,
		});

		const exec = await executeCell<
			ContractResult<{ snapshotOk: boolean; noGenericError: boolean }>
		>(
			harness.sidepanel,
			cellSource(
				resultPrefixLine(),
				activateLargeDomTabSourceNoReload(),
				"let snapshotOk = false;",
				"let noGenericError = true;",
				"try {",
				"  const data = await page.snapshot_data({ max_nodes: 100 });",
				"  snapshotOk = data.nodes.length > 0;",
				"} catch (e) {",
				"  const msg = String(e);",
				"  if (msg.includes('Failed to get page snapshot') && !msg.includes('cause')) {",
				"    noGenericError = false;",
				"  }",
				"}",
				"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: {",
				"  snapshotOk: snapshotOk,",
				"  noGenericError: noGenericError",
				"} }));",
			),
			20_000,
		);

		expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
		expect(exec.result?.ok).toBe(true);
		if (exec.result?.ok) {
			expect(exec.result.value.snapshotOk).toBe(true);
			expect(exec.result.value.noGenericError).toBe(true);
		}
	});
});
