import { expect, test } from "./fixtures.ts";
import { COMPLEX_FORM_URL, RESULT_PREFIX } from "./lib/constants.ts";
import { executeCell } from "./lib/harness.ts";
import type { ContractResult } from "./lib/types.ts";

async function prepareComplexFormTab(harness: {
	fixtureTab: {
		goto: (url: string, opts?: object) => Promise<unknown>;
		bringToFront: () => Promise<unknown>;
	};
}): Promise<void> {
	await harness.fixtureTab.goto(COMPLEX_FORM_URL, {
		waitUntil: "domcontentloaded",
	});
	await harness.fixtureTab.bringToFront();
}

function cellSource(...lines: string[]): string {
	return lines.join("\n");
}

function activateFormTabSource(): string {
	const tabPattern = `${COMPLEX_FORM_URL}*`;
	return cellSource(
		`let formTabs = await chrome.tabs.query({ url: ${JSON.stringify(tabPattern)} });`,
		"if (formTabs.length === 0) {",
		'  throw new Error("complex-form tab not found");',
		"}",
		"await chrome.tabs.update(formTabs[0].id, { active: true });",
		`await page.goto(${JSON.stringify(COMPLEX_FORM_URL)});`,
	);
}

function resultPrefixLine(): string {
	return `var RESULT_PREFIX = "${RESULT_PREFIX}";`;
}

test.describe
	.serial("complex-form page APIs", () => {
		test.beforeEach(async ({ harness }) => {
			await prepareComplexFormTab(harness);
		});

		test("snapshot option nodes expose value + selected fields", async ({
			harness,
		}) => {
			const exec = await executeCell<
				ContractResult<{
					redValue: string | undefined;
					redSelected: boolean | undefined;
					anyHasValue: boolean;
					anyHasSelected: boolean;
				}>
			>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFormTabSource(),
					"let data = await page.snapshot_data();",
					"let redOpt = null;",
					"let anyHasValue = false;",
					"let anyHasSelected = false;",
					"for (let i = 0; i < data.nodes.length; i++) {",
					"  if (data.nodes[i].tag === 'option') {",
					"    if (data.nodes[i].value !== undefined) anyHasValue = true;",
					"    if (data.nodes[i].selected !== undefined) anyHasSelected = true;",
					"    if (data.nodes[i].text === 'Red' || data.nodes[i].name === 'Red') redOpt = data.nodes[i];",
					"  }",
					"}",
					"if (!redOpt) {",
					'  throw new Error("Red option not found in snapshot");',
					"}",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: {",
					"  redValue: redOpt.value,",
					"  redSelected: redOpt.selected,",
					"  anyHasValue: anyHasValue,",
					"  anyHasSelected: anyHasSelected,",
					"} }));",
				),
				20_000,
			);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.redValue).toBe("red");
				expect(exec.result.value.redSelected).toBe(false);
				expect(exec.result.value.anyHasValue).toBe(true);
				expect(exec.result.value.anyHasSelected).toBe(true);
			}
		});

		test("page.select picks multiple options on select[multiple]", async ({
			harness,
		}) => {
			const exec = await executeCell<
				ContractResult<{ selectedValues: string; status: string }>
			>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFormTabSource(),
					"const found = await page.find({ selector: 'select#select-multi' });",
					"if (!found.length || !found[0].refId) {",
					'  throw new Error("multiple select refId not found");',
					"}",
					"const multiRefId = found[0].refId;",
					"await page.select({ refId: multiRefId, value: ['red','blue'] });",
					"const statusFound = await page.find({ selector: '#status' });",
					"const status = statusFound.length && statusFound[0].text ? statusFound[0].text : '';",
					"const after = await page.find({ selector: 'select#select-multi' });",
					"const selValues = (after[0].value || '').split(',');",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { selectedValues: selValues.join(','), status: status } }));",
				),
				20_000,
			);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.selectedValues).toBe("red,blue");
				expect(exec.result.value.status).toContain("select-multi:red,blue");
			}
		});

		test("page.select with empty array clears select[multiple]", async ({
			harness,
		}) => {
			const exec = await executeCell<
				ContractResult<{ selectedValues: string }>
			>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFormTabSource(),
					"const found = await page.find({ selector: 'select#select-multi' });",
					"if (!found.length || !found[0].refId) {",
					'  throw new Error("multiple select refId not found");',
					"}",
					"const multiRefId = found[0].refId;",
					"await page.select({ refId: multiRefId, value: ['red','blue'] });",
					"await page.select({ refId: multiRefId, value: [] });",
					"const after = await page.find({ selector: 'select#select-multi' });",
					"const selValues = (after[0].value || '').split(',').filter(function(v){return v;});",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { selectedValues: selValues.join(',') } }));",
				),
				20_000,
			);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.selectedValues).toBe("");
			}
		});

		test("page.fill sets text on contenteditable element", async ({
			harness,
		}) => {
			const exec = await executeCell<
				ContractResult<{ text: string; status: string }>
			>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFormTabSource(),
					"const found = await page.find({ selector: '#contenteditable' });",
					"if (!found.length || !found[0].refId) {",
					'  throw new Error("contenteditable refId not found");',
					"}",
					"const ceRefId = found[0].refId;",
					"await page.fill({ refId: ceRefId, value: 'hello editable' });",
					"const after = await page.find({ selector: '#contenteditable' });",
					"const statusFound = await page.find({ selector: '#status' });",
					"const status = statusFound.length && statusFound[0].text ? statusFound[0].text : '';",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: {",
					"  text: after[0].text || '',",
					"  status: status,",
					"} }));",
				),
				20_000,
			);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.text).toBe("hello editable");
				expect(exec.result.value.status).toContain(
					"contenteditable:hello editable",
				);
			}
		});

		test("page.press with refId dispatches keydown on element", async ({
			harness,
		}) => {
			const exec = await executeCell<ContractResult<{ status: string }>>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFormTabSource(),
					"const found = await page.find({ selector: '#text' });",
					"if (!found.length || !found[0].refId) {",
					'  throw new Error("text input refId not found");',
					"}",
					"const textRefId = found[0].refId;",
					"await page.press({ refId: textRefId, key: 'Enter' });",
					"const statusFound = await page.find({ selector: '#status' });",
					"const status = statusFound.length && statusFound[0].text ? statusFound[0].text : '';",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { status: status } }));",
				),
				20_000,
			);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.status).toBe("press:Enter");
			}
		});

		test("page.submit triggers form submit event", async ({ harness }) => {
			const exec = await executeCell<ContractResult<{ status: string }>>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFormTabSource(),
					"const found = await page.find({ selector: '#form' });",
					"if (!found.length || !found[0].refId) {",
					'  throw new Error("form refId not found");',
					"}",
					"await page.submit({ refId: found[0].refId });",
					"const statusFound = await page.find({ selector: '#status' });",
					"const status = statusFound.length && statusFound[0].text ? statusFound[0].text : '';",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { status: status } }));",
				),
				20_000,
			);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.status).toBe("submitted");
			}
		});

		test("page.checkRadio picks radio by name and value", async ({
			harness,
		}) => {
			const exec = await executeCell<
				ContractResult<{ status: string; checkedValue: string }>
			>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFormTabSource(),
					"await page.checkRadio({ name: 'radio-grp', value: 'opt2' });",
					"const statusFound = await page.find({ selector: '#status' });",
					"const status = statusFound.length && statusFound[0].text ? statusFound[0].text : '';",
					"let checkedValue = '';",
					"const radios = await page.find({ selector: 'input[name=\"radio-grp\"]' });",
					"for (let i = 0; i < radios.length; i++) {",
					"  if (radios[i].checked) { checkedValue = radios[i].value; break; }",
					"}",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: {",
					"  status: status,",
					"  checkedValue: checkedValue,",
					"} }));",
				),
				20_000,
			);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.checkedValue).toBe("opt2");
				expect(exec.result.value.status).toContain("radio:opt2");
			}
		});

		test("page.fill on textarea updates value", async ({ harness }) => {
			const exec = await executeCell<
				ContractResult<{ value: string; status: string }>
			>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFormTabSource(),
					"const found = await page.find({ selector: '#textarea' });",
					"if (!found.length || !found[0].refId) throw new Error('textarea refId not found');",
					"await page.fill({ refId: found[0].refId, value: 'multi line\\ntext' });",
					"const after = await page.find({ selector: '#textarea' });",
					"const statusFound = await page.find({ selector: '#status' });",
					"const status = statusFound.length && statusFound[0].text ? statusFound[0].text : '';",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { value: after[0].value || '', status: status } }));",
				),
				20_000,
			);
			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.value).toBe("multi line\ntext");
			}
		});

		test("page.fill on number input updates value", async ({ harness }) => {
			const exec = await executeCell<
				ContractResult<{ value: string; status: string }>
			>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFormTabSource(),
					"const found = await page.find({ selector: '#number' });",
					"if (!found.length || !found[0].refId) throw new Error('number refId not found');",
					"await page.fill({ refId: found[0].refId, value: '42' });",
					"const after = await page.find({ selector: '#number' });",
					"const statusFound = await page.find({ selector: '#status' });",
					"const status = statusFound.length && statusFound[0].text ? statusFound[0].text : '';",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { value: after[0].value || '', status: status } }));",
				),
				20_000,
			);
			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.value).toBe("42");
				expect(exec.result.value.status).toContain("number:42");
			}
		});

		test("page.fill on date input updates value", async ({ harness }) => {
			const exec = await executeCell<
				ContractResult<{ value: string; status: string }>
			>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFormTabSource(),
					"const found = await page.find({ selector: '#date' });",
					"if (!found.length || !found[0].refId) throw new Error('date refId not found');",
					"await page.fill({ refId: found[0].refId, value: '2026-01-15' });",
					"const after = await page.find({ selector: '#date' });",
					"const statusFound = await page.find({ selector: '#status' });",
					"const status = statusFound.length && statusFound[0].text ? statusFound[0].text : '';",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { value: after[0].value || '', status: status } }));",
				),
				20_000,
			);
			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.value).toBe("2026-01-15");
				expect(exec.result.value.status).toContain("date:2026-01-15");
			}
		});

		test("page.fill on range input updates value", async ({ harness }) => {
			const exec = await executeCell<
				ContractResult<{ value: string; status: string }>
			>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFormTabSource(),
					"const found = await page.find({ selector: '#range' });",
					"if (!found.length || !found[0].refId) throw new Error('range refId not found');",
					"await page.fill({ refId: found[0].refId, value: '50' });",
					"const after = await page.find({ selector: '#range' });",
					"const statusFound = await page.find({ selector: '#status' });",
					"const status = statusFound.length && statusFound[0].text ? statusFound[0].text : '';",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { value: after[0].value || '', status: status } }));",
				),
				20_000,
			);
			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.value).toBe("50");
				expect(exec.result.value.status).toContain("range:50");
			}
		});

		test("page.fill on email input updates value", async ({ harness }) => {
			const exec = await executeCell<
				ContractResult<{ value: string; status: string }>
			>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFormTabSource(),
					"const found = await page.find({ selector: '#email' });",
					"if (!found.length || !found[0].refId) throw new Error('email refId not found');",
					"await page.fill({ refId: found[0].refId, value: 'a@b.com' });",
					"const after = await page.find({ selector: '#email' });",
					"const statusFound = await page.find({ selector: '#status' });",
					"const status = statusFound.length && statusFound[0].text ? statusFound[0].text : '';",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { value: after[0].value || '', status: status } }));",
				),
				20_000,
			);
			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.value).toBe("a@b.com");
				expect(exec.result.value.status).toContain("text:a@b.com");
			}
		});

		test("page.setFiles regression on file input", async ({ harness }) => {
			const exec = await executeCell<ContractResult<{ status: string }>>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFormTabSource(),
					"const found = await page.find({ selector: '#file-single' });",
					"if (!found.length || !found[0].refId) throw new Error('file refId not found');",
					"const assetUrl = 'http://127.0.0.1:9292/testcases/media-download/assets/photo.jpg';",
					"await page.setFiles({ refId: found[0].refId, files: [{ url: assetUrl, name: 'photo.jpg', mimeType: 'image/jpeg' }] });",
					"const statusFound = await page.find({ selector: '#status' });",
					"const status = statusFound.length && statusFound[0].text ? statusFound[0].text : '';",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { status: status } }));",
				),
				30_000,
			);
			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.status).toContain("file:photo.jpg");
			}
		});

		test("page.click on radio via refId checks it", async ({ harness }) => {
			const exec = await executeCell<
				ContractResult<{ status: string; checkedValue: string }>
			>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFormTabSource(),
					"const radios = await page.find({ selector: 'input[name=\"radio-grp\"]' });",
					"let opt3RefId = null;",
					"for (let i = 0; i < radios.length; i++) {",
					"  if (radios[i].value === 'opt3') { opt3RefId = radios[i].refId; break; }",
					"}",
					"if (!opt3RefId) throw new Error('opt3 radio refId not found');",
					"await page.click({ refId: opt3RefId });",
					"const statusFound = await page.find({ selector: '#status' });",
					"const status = statusFound.length && statusFound[0].text ? statusFound[0].text : '';",
					"const after = await page.find({ selector: 'input[name=\"radio-grp\"]' });",
					"let checkedValue = '';",
					"for (let i = 0; i < after.length; i++) {",
					"  if (after[i].checked) { checkedValue = after[i].value; break; }",
					"}",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { status: status, checkedValue: checkedValue } }));",
				),
				20_000,
			);
			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.checkedValue).toBe("opt3");
				expect(exec.result.value.status).toContain("radio:opt3");
			}
		});

		test("page.select_option on custom ARIA listbox picks option", async ({
			harness,
		}) => {
			const exec = await executeCell<ContractResult<{ status: string }>>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFormTabSource(),
					"const found = await page.find({ selector: '#listbox' });",
					"if (!found.length || !found[0].refId) throw new Error('listbox refId not found');",
					"await page.select_option({ refId: found[0].refId, value: 'Y' });",
					"const statusFound = await page.find({ selector: '#status' });",
					"const status = statusFound.length && statusFound[0].text ? statusFound[0].text : '';",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { status: status } }));",
				),
				20_000,
			);
			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.status).toContain("listbox:Y");
			}
		});
	});
