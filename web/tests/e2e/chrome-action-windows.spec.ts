import { test } from "@playwright/test";
import {
  expectCellOutputContains,
  launchExtensionContext,
  runCell,
  setCellCode,
  waitForCellStatus,
  waitForKernelReady,
} from "../extension-helpers";

test.describe("chrome.action", () => {
  test("chrome.action.setBadgeText sets badge", async () => {
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
await chrome.action.setBadgeText({text: "3"})
await chrome.action.setBadgeBackgroundColor({color: "#FF0000"})
await chrome.action.setTitle({title: "JS Notebook - 3 cells"})
print("badge set")
      `,
      );
      await runCell(popup, 0);
      await waitForCellStatus(popup, 0, "success", 20_000);
      await expectCellOutputContains(popup, 0, "badge set");
    } finally {
      await context.close();
    }
  });
});

test.describe("chrome.windows", () => {
  test("chrome.windows.getAll returns windows", async () => {
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
const wins = await chrome.windows.getAll({})
print("windows: " + wins.length)
print("type: " + typeof wins[0].id)
      `,
      );
      await runCell(popup, 0);
      await waitForCellStatus(popup, 0, "success", 20_000);
      await expectCellOutputContains(popup, 0, "windows:");
      await expectCellOutputContains(popup, 0, "type: number");
    } finally {
      await context.close();
    }
  });

  test("chrome.windows.create then chrome.windows.remove", async () => {
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
const win = await chrome.windows.create({url: "https://example.com", focused: false})
print("created window: " + typeof win.id)
await chrome.windows.remove({windowId: win.id})
print("removed")
      `,
      );
      await runCell(popup, 0);
      await waitForCellStatus(popup, 0, "success", 20_000);
      await expectCellOutputContains(popup, 0, "created window: number");
      await expectCellOutputContains(popup, 0, "removed");
    } finally {
      await context.close();
    }
  });
});
