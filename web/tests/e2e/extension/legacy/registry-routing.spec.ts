import { test } from "@playwright/test";
import {
	expectCellOutputContains,
	launchExtensionContext,
	runCell,
	setCellCode,
	waitForCellStatus,
	waitForKernelReady,
} from "../extension-helpers";

test.describe("registry routing", () => {
	test("page.url reads from the active tab via content-script routing", async () => {
		const { context, popup, helperTab } = await launchExtensionContext();
		try {
			await helperTab.goto("https://example.com/registry-routing-test");
			await helperTab.bringToFront();
			await waitForKernelReady(popup, 60_000);
			await popup
				.locator(".cm-content")
				.first()
				.waitFor({ state: "visible", timeout: 10_000 });
			await popup.waitForTimeout(500);

			await setCellCode(
				popup,
				0,
				`const url = await page.url();
print("url: " + url);`,
			);
			await runCell(popup, 0);
			await waitForCellStatus(popup, 0, "success", 60_000);
			await expectCellOutputContains(
				popup,
				0,
				"url: https://example.com/registry-routing-test",
			);
		} finally {
			await context.close();
		}
	});

	test("sidepanel.url succeeds through main-thread routing", async () => {
		const { context, popup } = await launchExtensionContext();
		try {
			await waitForKernelReady(popup, 60_000);
			await popup
				.locator(".cm-content")
				.first()
				.waitFor({ state: "visible", timeout: 10_000 });
			await popup.waitForTimeout(500);

			await setCellCode(
				popup,
				0,
				`const url = await sidepanel.url();
print("sidepanel: " + url);`,
			);
			await runCell(popup, 0);
			await waitForCellStatus(popup, 0, "success", 60_000);
			await expectCellOutputContains(popup, 0, "sidepanel: chrome-extension://");
		} finally {
			await context.close();
		}
	});
});
