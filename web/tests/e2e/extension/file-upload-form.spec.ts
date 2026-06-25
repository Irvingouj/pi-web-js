import { expect, test } from "./fixtures.ts";
import {
	FILE_UPLOAD_FORM_URL,
	MEDIA_DOWNLOAD_URL,
	RESULT_PREFIX,
} from "./lib/constants.ts";
import { executeCell } from "./lib/harness.ts";
import type { ContractResult } from "./lib/types.ts";

async function prepareFileUploadTab(harness: {
	fixtureTab: {
		goto(url: string, opts?: object): Promise<unknown>;
		bringToFront(): Promise<void>;
	};
}): Promise<void> {
	await harness.fixtureTab.goto(FILE_UPLOAD_FORM_URL, {
		waitUntil: "domcontentloaded",
	});
	await harness.fixtureTab.bringToFront();
}

function cellSource(...lines: string[]): string {
	return lines.join("\n");
}

function activateFileUploadTabSource(): string {
	const tabPattern = `${FILE_UPLOAD_FORM_URL}*`;
	return cellSource(
		`let formTabs = await chrome.tabs.query({ url: ${JSON.stringify(tabPattern)} });`,
		"if (formTabs.length === 0) {",
		'  throw new Error("file-upload tab not found");',
		"}",
		"await chrome.tabs.update(formTabs[0].id, { active: true });",
		`await page.goto(${JSON.stringify(FILE_UPLOAD_FORM_URL)});`,
	);
}

function resultPrefixLine(): string {
	return `var RESULT_PREFIX = "${RESULT_PREFIX}";`;
}

const PHOTO_ASSET_URL = `${MEDIA_DOWNLOAD_URL}assets/photo.jpg`;

test.describe
	.serial("file-upload-form page.setFiles", () => {
		test.beforeEach(async ({ harness }) => {
			await prepareFileUploadTab(harness);
		});

		test("page.setFiles uploads via same-origin URL without passing bytes", async ({
			harness,
		}) => {
			const exec = await executeCell<
				ContractResult<{
					statusText: string;
					fileCount: number;
				}>
			>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFileUploadTabSource(),
					`const assetUrl = ${JSON.stringify(PHOTO_ASSET_URL)};`,
					"const fileNodes = await page.find({ selector: 'input#file' });",
					"if (!fileNodes.length || !fileNodes[0].refId) {",
					'  throw new Error("file input refId not found");',
					"}",
					"const setResult = await page.setFiles({",
					"  refId: fileNodes[0].refId,",
					"  files: [{ url: assetUrl, name: 'photo.jpg', mimeType: 'image/jpeg' }],",
					"});",
					"const extracted = await page.extract(['text']);",
					"const text = typeof extracted.text === 'string' ? extracted.text : '';",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: {",
					"  statusText: text,",
					"  fileCount: setResult.fileCount,",
					"} }));",
				),
				30_000,
			);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.statusText).toContain(
					"uploaded:photo.jpg:6636",
				);
				expect(exec.result.value.fileCount).toBe(1);
			}
		});

		test("page.setFiles uploads via vfs path after writeBase64 setup", async ({
			harness,
		}) => {
			const exec = await executeCell<
				ContractResult<{ statusText: string; fileCount: number }>
			>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFileUploadTabSource(),
					`const assetUrl = ${JSON.stringify(PHOTO_ASSET_URL)};`,
					"const fetchResult = await page.fetch(assetUrl);",
					"await fs.writeBase64({ path: '/tmp/photo.jpg', data: fetchResult.body });",
					"const fileNodes = await page.find({ selector: 'input#file' });",
					"if (!fileNodes.length || !fileNodes[0].refId) {",
					'  throw new Error("file input refId not found");',
					"}",
					"const setResult = await page.setFiles({",
					"  refId: fileNodes[0].refId,",
					"  files: [{ path: '/tmp/photo.jpg', name: 'photo.jpg', mimeType: 'image/jpeg' }],",
					"});",
					"const extracted = await page.extract(['text']);",
					"const text = typeof extracted.text === 'string' ? extracted.text : '';",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: {",
					"  statusText: text,",
					"  fileCount: setResult.fileCount,",
					"} }));",
				),
				60_000,
			);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.statusText).toContain(
					"uploaded:photo.jpg:6636",
				);
				expect(exec.result.value.fileCount).toBe(1);
			}
		});

		test("page.setFiles uploads via pre-existing vfs path across cells", async ({
			harness,
		}) => {
			// Cell 1: write the file to VFS in its own cell. The JS write cache is
			// consumed/discarded by the time this cell returns, so the upload cell
			// below must resolve the pre-existing path via a borrow-free OPFS read
			// (re-entering ExtensionSession.fsReadBase64 mid-runCellAsync panics).
			const writeExec = await executeCell(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFileUploadTabSource(),
					`const assetUrl = ${JSON.stringify(PHOTO_ASSET_URL)};`,
					"const fetchResult = await page.fetch(assetUrl);",
					"await fs.writeBase64({ path: '/tmp/photo-preexisting.jpg', data: fetchResult.body });",
					`print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { written: true } }));`,
				),
				60_000,
			);
			expect(writeExec.status, `${writeExec.stderr}\n${writeExec.stdout}`).toBe(
				"success",
			);

			// Cell 2: upload the pre-existing path. Today this panics with
			// "recursive use of an object detected"; after the fix it resolves via
			// the borrow-free free function and uploads the bytes.
			const uploadExec = await executeCell<
				ContractResult<{ statusText: string; fileCount: number }>
			>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFileUploadTabSource(),
					"const fileNodes = await page.find({ selector: 'input#file' });",
					"if (!fileNodes.length || !fileNodes[0].refId) {",
					'  throw new Error("file input refId not found");',
					"}",
					"const setResult = await page.setFiles({",
					"  refId: fileNodes[0].refId,",
					"  files: [{ path: '/tmp/photo-preexisting.jpg', name: 'photo.jpg', mimeType: 'image/jpeg' }],",
					"});",
					"const extracted = await page.extract(['text']);",
					"const text = typeof extracted.text === 'string' ? extracted.text : '';",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: {",
					"  statusText: text,",
					"  fileCount: setResult.fileCount,",
					"} }));",
				),
				60_000,
			);
			expect(
				uploadExec.status,
				`${uploadExec.stderr}\n${uploadExec.stdout}`,
			).toBe("success");
			expect(uploadExec.result?.ok).toBe(true);
			if (uploadExec.result?.ok) {
				expect(uploadExec.result.value.statusText).toContain(
					"uploaded:photo.jpg:6636",
				);
				expect(uploadExec.result.value.fileCount).toBe(1);
			}

			// Cell 3: prove the acting runtime is still healthy after the cross-cell
			// upload — the regression that today leaves ExtensionJsClient dead.
			const healthExec = await executeCell<
				ContractResult<{ ok: boolean; url: string }>
			>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					"const url = await page.url();",
					`print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { ok: true, url } }));`,
				),
				60_000,
			);
			expect(
				healthExec.status,
				`${healthExec.stderr}\n${healthExec.stdout}`,
			).toBe("success");
		});

		test("page.setFiles uploads via fetch handle", async ({ harness }) => {
			const exec = await executeCell<
				ContractResult<{
					statusText: string;
					fileCount: number;
					bodyEncoding: string;
					hasBody: boolean;
				}>
			>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFileUploadTabSource(),
					`const assetUrl = ${JSON.stringify(PHOTO_ASSET_URL)};`,
					"const fetchResult = await page.fetch({ url: assetUrl, store: true });",
					"if (!fetchResult.handle) { throw new Error('expected fetch handle'); }",
					"const fileNodes = await page.find({ selector: 'input#file' });",
					"const setResult = await page.setFiles({",
					"  refId: fileNodes[0].refId,",
					"  files: [{ handle: fetchResult.handle, name: 'photo.jpg' }],",
					"});",
					"const extracted = await page.extract(['text']);",
					"const text = typeof extracted.text === 'string' ? extracted.text : '';",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: {",
					"  statusText: text,",
					"  fileCount: setResult.fileCount,",
					"  bodyEncoding: fetchResult.bodyEncoding,",
					"  hasBody: typeof fetchResult.body === 'string' && fetchResult.body.length > 0,",
					"} }));",
				),
				30_000,
			);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.bodyEncoding).toBe("handle");
				expect(exec.result.value.hasBody).toBe(false);
				expect(exec.result.value.statusText).toContain(
					"uploaded:photo.jpg:6636",
				);
				expect(exec.result.value.fileCount).toBe(1);
			}
		});

		test("page.setFiles on text input returns E_NOT_INTERACTABLE", async ({
			harness,
		}) => {
			const exec = await executeCell<ContractResult<{ code: string }>>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFileUploadTabSource(),
					`const assetUrl = ${JSON.stringify(PHOTO_ASSET_URL)};`,
					"const textNodes = await page.find({ selector: 'input#name' });",
					"let code = '';",
					"try {",
					"  await page.setFiles({",
					"    refId: textNodes[0].refId,",
					"    files: [{ url: assetUrl, name: 'photo.jpg' }],",
					"  });",
					"} catch (e) { code = e.code || ''; }",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { code } }));",
				),
				20_000,
			);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.code).toBe("E_NOT_INTERACTABLE");
			}
		});

		test("page.setFiles supports multiple files via URL on multiple input", async ({
			harness,
		}) => {
			const exec = await executeCell<
				ContractResult<{ statusText: string; fileCount: number }>
			>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateFileUploadTabSource(),
					"const fileNodes = await page.find({ selector: 'input#files' });",
					`const assetUrl = ${JSON.stringify(PHOTO_ASSET_URL)};`,
					"const setResult = await page.setFiles({",
					"  refId: fileNodes[0].refId,",
					"  files: [",
					"    { url: assetUrl, name: 'a.jpg' },",
					"    { url: assetUrl, name: 'b.jpg' },",
					"  ],",
					"});",
					"const extracted = await page.extract(['text']);",
					"const text = typeof extracted.text === 'string' ? extracted.text : '';",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: {",
					"  statusText: text,",
					"  fileCount: setResult.fileCount,",
					"} }));",
				),
				30_000,
			);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.fileCount).toBe(2);
				expect(exec.result.value.statusText).toContain("uploaded:a.jpg:6636");
				expect(exec.result.value.statusText).toContain("uploaded:b.jpg:6636");
			}
		});
	});
