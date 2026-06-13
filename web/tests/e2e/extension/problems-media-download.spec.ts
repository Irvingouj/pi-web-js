import { expect, test } from "./fixtures.ts";
import { MEDIA_DOWNLOAD_URL, RESULT_PREFIX } from "./lib/constants.ts";
import { executeCell } from "./lib/harness.ts";
import type { ContractResult } from "./lib/types.ts";

function cellSource(...lines: string[]): string {
	return lines.join("\n");
}

function resultPrefixLine(): string {
	return `var RESULT_PREFIX = "${RESULT_PREFIX}";`;
}

function activateMediaTabSource(): string {
	const tabPattern = `${MEDIA_DOWNLOAD_URL}*`;
	return cellSource(
		`let mediaTabs = await chrome.tabs.query({ url: ${JSON.stringify(tabPattern)} });`,
		"if (mediaTabs.length === 0) {",
		'  throw new Error("media-download tab not found");',
		"}",
		"await chrome.tabs.update(mediaTabs[0].id, { active: true });",
		`await page.goto(${JSON.stringify(MEDIA_DOWNLOAD_URL)});`,
	);
}

test.describe
	.serial("media-download binary pipeline (AC-3, T-012)", () => {
		test.beforeEach(async ({ harness }) => {
			await harness.fixtureTab.goto(MEDIA_DOWNLOAD_URL, {
				waitUntil: "domcontentloaded",
			});
			await harness.fixtureTab.bringToFront();
		});

		test("T-012: full image download and verify pipeline", async ({
			harness,
		}) => {
			const exec = await executeCell<
				ContractResult<{
					imageUrl: string;
					fetchBodyEncoding: string;
					fetchByteLength: number;
					writePath: string;
					writeBytesWritten: number;
					statSize: number;
					fileHash: string;
					expectedHash: string;
				}>
			>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateMediaTabSource(),
					"const images = await page.find('img');",
					"if (images.length === 0) { throw new Error('No images found'); }",
					"const imageUrl = images[0].src;",
					"const fetchResult = await page.fetch(imageUrl);",
					"if (fetchResult.bodyEncoding !== 'base64') { throw new Error('Expected base64 encoding, got: ' + fetchResult.bodyEncoding); }",
					"const base64Data = fetchResult.body;",
					"const writeResult = await fs.writeBase64({ path: '/tmp/photo.jpg', data: base64Data });",
					"const statResult = await fs.stat('/tmp/photo.jpg');",
					"const hashResult = await fs.hash({ path: '/tmp/photo.jpg', algo: 'sha256' });",
					"const expectedHash = 'ea012fdbfb0cc17a2ee6c281efc094fd6f78381d831af03a7e658a9de04e936d';",
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: {",
					"  imageUrl: imageUrl,",
					"  fetchBodyEncoding: fetchResult.bodyEncoding,",
					"  fetchByteLength: fetchResult.byteLength,",
					"  writePath: writeResult.path,",
					"  writeBytesWritten: writeResult.bytes_written,",
					"  statSize: statResult.size,",
					"  fileHash: hashResult,",
					"  expectedHash: expectedHash",
					"} }));",
				),
				30_000,
			);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.imageUrl).toMatch(/photo\.jpg/);
				expect(exec.result.value.fetchBodyEncoding).toBe("base64");
				expect(exec.result.value.fetchByteLength).toBeGreaterThan(0);
				expect(exec.result.value.writePath).toBe("/tmp/photo.jpg");
				expect(exec.result.value.writeBytesWritten).toBe(
					exec.result.value.fetchByteLength,
				);
				expect(exec.result.value.statSize).toBe(
					exec.result.value.fetchByteLength,
				);
				expect(exec.result.value.fileHash).toBe(exec.result.value.expectedHash);
			}
		});

		test("T-012: text fetch still works alongside binary", async ({
			harness,
		}) => {
			const exec = await executeCell<
				ContractResult<{
					bodyEncoding: string;
					body: string;
					status: number;
				}>
			>(
				harness.sidepanel,
				cellSource(
					resultPrefixLine(),
					activateMediaTabSource(),
					`const fetchResult = await page.fetch(${JSON.stringify(MEDIA_DOWNLOAD_URL)});`,
					"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: {",
					"  bodyEncoding: fetchResult.bodyEncoding,",
					"  body: fetchResult.body,",
					"  status: fetchResult.status",
					"} }));",
				),
				20_000,
			);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.bodyEncoding).toBe("text");
				expect(typeof exec.result.value.body).toBe("string");
				expect(exec.result.value.status).toBe(200);
			}
		});
	});
