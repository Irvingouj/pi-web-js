import { test } from "@playwright/test";
import {
	expectCellOutputContains,
	launchExtensionContext,
	runCell,
	setCellCode,
	waitForCellStatus,
	waitForKernelReady,
} from "../extension-helpers";

test.describe("chrome.alarms", () => {
	test("chrome.alarms.create and clear", async () => {
		const { context, popup } = await launchExtensionContext();
		const consoleMessages: string[] = [];
		popup.on("console", (msg) => {
			consoleMessages.push(msg.text());
		});
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
				`
await chrome.alarms.create("test-alarm", {delayInMinutes: 0.1})
print("alarm created")
const cleared = await chrome.alarms.clear("test-alarm")
print("cleared: " + cleared)
      `,
			);
			await runCell(popup, 0);
			await waitForCellStatus(popup, 0, "success", 20_000);
			// Debug: log the actual cell stdout
			const stdout = await popup.evaluate(() => {
				const cells = document.querySelectorAll('[data-testid="cell-output"]');
				const cell = cells[0] as HTMLElement;
				return {
					textContent: cell?.textContent || "",
					innerHTML: cell?.innerHTML || "",
					kernel: !!(window as any).__kernel,
				};
			});
			console.log("DEBUG cell stdout:", JSON.stringify(stdout));
			console.log("DEBUG console messages:", consoleMessages.join("\n"));
			await expectCellOutputContains(popup, 0, "alarm created");
			await expectCellOutputContains(popup, 0, "cleared:");
		} finally {
			await context.close();
		}
	});
});

test.describe("chrome.contextMenus", () => {
	test("chrome.contextMenus.create returns menu id", async () => {
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
				`
const menuId = await chrome.contextMenus.create({id: "test-menu", title: "Test Menu", contexts: ["selection"]})
print("menu type: " + typeof menuId)
      `,
			);
			await runCell(popup, 0);
			await waitForCellStatus(popup, 0, "success", 20_000);
			await expectCellOutputContains(popup, 0, "menu type:");
		} finally {
			await context.close();
		}
	});
});
