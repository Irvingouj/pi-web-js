import { expect, test } from "./fixtures.ts";
import { RESULT_PREFIX, SIMPLE_FORM_1_URL } from "./lib/constants.ts";
import { executeCell } from "./lib/harness.ts";
import type { ContractResult } from "./lib/types.ts";

async function prepareSimpleFormTab(harness: {
	fixtureTab: {
		goto(url: string, opts?: object): Promise<unknown>;
		bringToFront(): Promise<void>;
	};
}): Promise<void> {
	await harness.fixtureTab.goto(SIMPLE_FORM_1_URL, {
		waitUntil: "domcontentloaded",
	});
	await harness.fixtureTab.bringToFront();
}

function cellSource(...lines: string[]): string {
	return lines.join("\n");
}

function activateFormTabSource(): string {
	const tabPattern = `${SIMPLE_FORM_1_URL}*`;
	return cellSource(
		`let formTabs = await chrome.tabs.query({ url: ${JSON.stringify(tabPattern)} });`,
		"if (formTabs.length === 0) {",
		'  throw new Error("simple-form tab not found");',
		"}",
		"await chrome.tabs.update(formTabs[0].id, { active: true });",
		`await page.goto(${JSON.stringify(SIMPLE_FORM_1_URL)});`,
	);
}

function resultPrefixLine(): string {
	return `var RESULT_PREFIX = "${RESULT_PREFIX}";`;
}

test.describe
	.serial("simple-form-1 page APIs", () => {
		test.beforeEach(async ({ harness }) => {
			await prepareSimpleFormTab(harness);
		});

		test("snapshot without await is not useful", async ({ harness }) => {
			const exec = await executeCell<ContractResult<{ promiseType: string }>>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFormTabSource(),
					"const snapPromise = page.snapshot();",
					"print(snapPromise);",
					"const promiseType = typeof snapPromise;",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { promiseType: promiseType } }));",
				),
				20_000,
			);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.stdout).toContain("[Promise pending]");
			expect(exec.stdout).not.toContain('"{}"');
			expect(exec.result).toEqual({
				ok: true,
				value: { promiseType: "object" },
			});
		});

		test("page.snapshot returns text with refIds", async ({ harness }) => {
			const exec = await executeCell<
				ContractResult<{ hasTitle: boolean; hasRefId: boolean; length: number }>
			>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFormTabSource(),
					"const text = await page.snapshot();",
					"const hasTitle = text.indexOf('Simple Form 1') >= 0;",
					"const hasRefId = text.indexOf('[e1]') >= 0 || text.indexOf('[e2]') >= 0;",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { hasTitle: hasTitle, hasRefId: hasRefId, length: text.length } }));",
				),
				20_000,
			);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.hasTitle).toBe(true);
				expect(exec.result.value.hasRefId).toBe(true);
				expect(exec.result.value.length).toBeGreaterThan(20);
			}
		});

		test("page.snapshot_data returns nodes", async ({ harness }) => {
			const exec = await executeCell<
				ContractResult<{
					nodeCount: number;
					hasInput: boolean;
					hasButton: boolean;
					title: string;
				}>
			>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFormTabSource(),
					"const data = await page.snapshot_data();",
					"const tags = [];",
					"for (let i = 0; i < data.nodes.length; i++) {",
					"  tags.push(data.nodes[i].tag);",
					"}",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { nodeCount: data.nodes.length, hasInput: tags.indexOf('input') >= 0, hasButton: tags.indexOf('button') >= 0, title: data.title } }));",
				),
				20_000,
			);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.nodeCount).toBeGreaterThanOrEqual(2);
				expect(exec.result.value.hasInput).toBe(true);
				expect(exec.result.value.hasButton).toBe(true);
				expect(exec.result.value.title).toBe("Simple Form 1");
			}
		});

		test("page.fill updates input value", async ({ harness }) => {
			const exec = await executeCell<
				ContractResult<{ value: string | undefined }>
			>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFormTabSource(),
					"let data = await page.snapshot_data();",
					"let inputNode = null;",
					"for (let i = 0; i < data.nodes.length; i++) {",
					"  if (data.nodes[i].tag === 'input') {",
					"    inputNode = data.nodes[i];",
					"    break;",
					"  }",
					"}",
					"if (!inputNode || !inputNode.refId) {",
					'  throw new Error("input refId not found in snapshot");',
					"}",
					"await page.fill({ refId: inputNode.refId, value: 'Alice' });",
					"data = await page.snapshot_data();",
					"let updated = null;",
					"for (let i = 0; i < data.nodes.length; i++) {",
					"  if (data.nodes[i].refId === inputNode.refId) {",
					"    updated = data.nodes[i];",
					"    break;",
					"  }",
					"}",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { value: updated ? updated.value : undefined } }));",
				),
				20_000,
			);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result).toEqual({
				ok: true,
				value: { value: "Alice" },
			});
		});

		test("page.click updates status after fill", async ({ harness }) => {
			const exec = await executeCell<
				ContractResult<{ statusText: string; snapshotHasFilled: boolean }>
			>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFormTabSource(),
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
					"await page.fill({ refId: inputNode.refId, value: 'Alice' });",
					"await page.click({ refId: buttonNode.refId });",
					"const extracted = await page.extract(['text']);",
					"const text = typeof extracted.text === 'string' ? extracted.text : '';",
					"const snap = await page.snapshot();",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { statusText: text, snapshotHasFilled: snap.indexOf('filled:Alice') >= 0 } }));",
				),
				20_000,
			);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.statusText).toContain("filled:Alice");
				expect(exec.result.value.snapshotHasFilled).toBe(true);
			}
		});
	});
