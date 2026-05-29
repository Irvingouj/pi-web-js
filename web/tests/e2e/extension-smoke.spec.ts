import { expect, test } from "@playwright/test";
import {
  expectCellOutputContains,
  launchExtensionContext,
  runCell,
  setCellCode,
  waitForCellStatus,
  waitForKernelReady,
} from "../extension-helpers";

test.describe("Extension smoke", () => {
  test("popup loads and kernel becomes ready", async () => {
    const { context, popup } = await launchExtensionContext();
    try {
      await waitForKernelReady(popup, 30_000);
      // Should have at least one cell
      const cells = popup.locator('[data-testid="cells-container"] .cell');
      await expect(cells.first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await context.close();
    }
  });

  test("code cells execute in extension popup", async () => {
    const { context, popup } = await launchExtensionContext();
    const consoleMessages: string[] = [];
    popup.on("console", (msg) => {
      consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
    });
    try {
      await waitForKernelReady(popup, 30_000);
      // Wait for the first cell editor to be visible
      await popup
        .locator(".cm-content")
        .first()
        .waitFor({ state: "visible", timeout: 10_000 });

      // Small delay to let CodeMirror settle
      await popup.waitForTimeout(500);

      await setCellCode(popup, 0, `print("hello extension")`);
      await runCell(popup, 0);
      await waitForCellStatus(popup, 0, "success", 20_000);
      await expectCellOutputContains(popup, 0, "hello extension");
    } catch (e) {
      console.log("Console messages:", consoleMessages.join("\n"));
      throw e;
    } finally {
      await context.close();
    }
  });

  test("top-level await works in extension popup", async () => {
    const { context, popup } = await launchExtensionContext();
    try {
      await waitForKernelReady(popup, 30_000);
      await popup
        .locator(".cm-content")
        .first()
        .waitFor({ state: "visible", timeout: 10_000 });
      await popup.waitForTimeout(500);
      await setCellCode(popup, 0, `print("before")
await 1
print("after")`);
      await runCell(popup, 0);
      await waitForCellStatus(popup, 0, "success", 30_000);
      await expectCellOutputContains(popup, 0, "after");
    } finally {
      await context.close();
    }
  });

  test("web.sleep works in extension popup", async () => {
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
        `print("before")
await web.sleep(100)
print("after")`,
      );
      await runCell(popup, 0);
      await waitForCellStatus(popup, 0, "success", 30_000);
      await expectCellOutputContains(popup, 0, "after");
    } finally {
      await context.close();
    }
  });
});
