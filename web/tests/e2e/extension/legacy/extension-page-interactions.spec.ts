import { test } from "@playwright/test";
import {
	expectCellOutputContains,
	launchExtensionContext,
	runCell,
	setCellCode,
	waitForCellStatus,
	waitForKernelReady,
} from "../extension-helpers";

test.describe("page interactions", () => {
	test("page.url, title, snapshot, scroll work", async () => {
		const { context, popup } = await launchExtensionContext();
		try {
			await waitForKernelReady(popup, 30_000);
			await popup
				.locator(".cm-content")
				.first()
				.waitFor({ state: "visible", timeout: 10_000 });
			await popup.waitForTimeout(500);

			await setCellCode(
				popup,
				0,
				`const url = await page.url();
const title = await page.title();
console.log('Current page:');
console.log('  URL:', url);
console.log('  Title:', title);
const snap = await page.snapshot();
console.log('\\nPage snapshot (first 800 chars):');
console.log(snap.slice(0, 800));
await page.scroll('down', 300);
console.log('\\nScrolled down 300px');
await page.scroll('up', 300);
console.log('Scrolled back up');`,
			);
			await runCell(popup, 0);
			await waitForCellStatus(popup, 0, "success", 20_000);
			await expectCellOutputContains(popup, 0, "Current page:");
			await expectCellOutputContains(popup, 0, "URL:");
			await expectCellOutputContains(popup, 0, "Title:");
			await expectCellOutputContains(popup, 0, "Page snapshot");
			await expectCellOutputContains(popup, 0, "Scrolled down 300px");
			await expectCellOutputContains(popup, 0, "Scrolled back up");
		} finally {
			await context.close();
		}
	});
});
