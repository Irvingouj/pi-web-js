import { test } from "@playwright/test";
import {
  expectCellOutputContains,
  launchExtensionContext,
  runCell,
  setCellCode,
  waitForCellStatus,
  waitForKernelReady,
} from "../extension-helpers";

test.describe("chrome.tabs", () => {
  test("chrome.tabs.query returns tabs", async () => {
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
const tabs = await chrome.tabs.query({currentWindow: true})
print("count: " + tabs.length)
print("type: " + typeof tabs)
      `,
      );
      await runCell(popup, 0);
      await waitForCellStatus(popup, 0, "success", 20_000);
      await expectCellOutputContains(popup, 0, "type: object");
      await expectCellOutputContains(popup, 0, "count:");
    } finally {
      await context.close();
    }
  });

  test("chrome.tabs.create opens a new tab", async () => {
    const { context, popup } = await launchExtensionContext();
    const consoleMessages: string[] = [];
    popup.on("console", (msg) => consoleMessages.push(msg.text()));
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
const tab = await chrome.tabs.create({url: "https://example.com"})
print("created: " + typeof tab.id)
      `,
      );
      await runCell(popup, 0);
      await waitForCellStatus(popup, 0, "success", 20_000);
      await expectCellOutputContains(popup, 0, "created: number");
    } catch (e) {
      const status = await popup.evaluate(() => {
        const cells = document.querySelectorAll('[data-testid="cell-status"]');
        return (cells[0] as HTMLElement)?.textContent || 'no-status';
      });
      const stdout = await popup.evaluate(() => {
        const cells = document.querySelectorAll('[data-testid="cell-output"]');
        return (cells[0] as HTMLElement)?.textContent || '';
      });
      console.log("DEBUG status:", status);
      console.log("DEBUG stdout:", stdout);
      console.log("DEBUG console:", consoleMessages.join("\n"));
      throw e;
    } finally {
      await context.close();
    }
  });

  test("chrome.tabs.create then chrome.tabs.remove", async () => {
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
const tab = await chrome.tabs.create({url: "https://example.com"})
const tabId = tab.id
print("created: " + tabId)
await chrome.tabs.remove(tabId)
print("removed")
      `,
      );
      await runCell(popup, 0);
      await waitForCellStatus(popup, 0, "success", 20_000);
      await expectCellOutputContains(popup, 0, "created:");
      await expectCellOutputContains(popup, 0, "removed");
    } finally {
      await context.close();
    }
  });

  test("chrome.tabs.query with active filter", async () => {
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
const tabs = await chrome.tabs.query({active: true, currentWindow: true})
print("active tabs: " + tabs.length)
print("has id: " + (tabs[0] != null && tabs[0].id != null))
      `,
      );
      await runCell(popup, 0);
      await waitForCellStatus(popup, 0, "success", 20_000);
      await expectCellOutputContains(popup, 0, "active tabs: 1");
      await expectCellOutputContains(popup, 0, "has id: true");
    } finally {
      await context.close();
    }
  });
});

test.describe("web.tab high-level APIs", () => {
  test("web.tab.create opens a new tab and returns id", async () => {
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
const tab = await web.tab.create({url: "https://example.com"})
print("id_type: " + typeof tab.id)
print("id_val: " + tab.id)
      `,
      );
      await runCell(popup, 0);
      await waitForCellStatus(popup, 0, "success", 20_000);
      await expectCellOutputContains(popup, 0, "id_type: number");
    } finally {
      await context.close();
    }
  });

  test("web.tab.query returns active tab", async () => {
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
const tabs = await web.tab.query({active: true, currentWindow: true})
const id = tabs[0]?.id
print("type: " + typeof id)
print("has_id: " + (id != null))
      `,
      );
      await runCell(popup, 0);
      await waitForCellStatus(popup, 0, "success", 20_000);
      await expectCellOutputContains(popup, 0, "has_id: true");
    } finally {
      await context.close();
    }
  });

  test("chrome.tabs.reload returns tab id", async () => {
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
const newTab = await web.tab.create({url: "https://example.com"})
await chrome.tabs.reload(newTab.id)
print("reloaded: true")
      `,
      );
      await runCell(popup, 0);
      await waitForCellStatus(popup, 0, "success", 20_000);
      await expectCellOutputContains(popup, 0, "reloaded: true");
    } finally {
      await context.close();
    }
  });
});

test.describe("web.tab content-script APIs", () => {
  test("web.tab.evaluate runs JS in target tab", async () => {
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
const newTab = await web.tab.create({url: "https://example.com"})
const result = await web.tab.evaluate(newTab.id, "1 + 1")
print("result: " + result)
      `,
      );
      await runCell(popup, 0);
      await waitForCellStatus(popup, 0, "success", 20_000);
      await expectCellOutputContains(popup, 0, "result: 2");
    } finally {
      await context.close();
    }
  });

  test("web.tab.snapshot returns DOM snapshot from target tab", async () => {
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
const newTab = await web.tab.create({url: "https://example.com"})
await web.tab.wait_for_load(newTab.id)
const snap = await web.tab.snapshot_data(newTab.id)
print("has_nodes: " + (snap.nodes != null))
print("has_url: " + (snap.url != null))
      `,
      );
      await runCell(popup, 0);
      await waitForCellStatus(popup, 0, "success", 20_000);
      await expectCellOutputContains(popup, 0, "has_nodes: true");
      await expectCellOutputContains(popup, 0, "has_url: true");
    } finally {
      await context.close();
    }
  });

  test("web.tab.fetch runs fetch in target tab origin", async () => {
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
const newTab = await web.tab.create({url: "https://example.com"})
await web.tab.wait_for_load(newTab.id)
const resp = await web.tab.fetch(newTab.id, "https://example.com")
print("status: " + resp.status)
print("has_body: " + (resp.body != null))
      `,
      );
      await runCell(popup, 0);
      await waitForCellStatus(popup, 0, "success", 20_000);
      await expectCellOutputContains(popup, 0, "status: 200");
      await expectCellOutputContains(popup, 0, "has_body: true");
    } finally {
      await context.close();
    }
  });
});

test.describe("page.fetch", () => {
  test("page.fetch uses active tab origin and cookie", async () => {
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
const newTab = await web.tab.create({url: "https://example.com"})
await web.tab.wait_for_load(newTab.id)
const resp = await page.fetch("https://example.com")
print("status: " + resp.status)
print("has_body: " + (resp.body != null))
      `,
      );
      await runCell(popup, 0);
      await waitForCellStatus(popup, 0, "success", 20_000);
      await expectCellOutputContains(popup, 0, "status: 200");
      await expectCellOutputContains(popup, 0, "has_body: true");
    } finally {
      await context.close();
    }
  });
});

test.describe("chrome.runtime", () => {
  test("chrome.runtime.sendMessage to background", async () => {
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
const resp = await chrome.runtime.sendMessage({action: "ping"})
print("type: " + typeof resp)
print("pong: " + resp.pong)
      `,
      );
      await runCell(popup, 0);
      await waitForCellStatus(popup, 0, "success", 20_000);
      await expectCellOutputContains(popup, 0, "type: object");
      await expectCellOutputContains(popup, 0, "pong: true");
    } finally {
      await context.close();
    }
  });
});

test.describe("chrome.storage.local", () => {
  test("chrome.storage.local.set and get", async () => {
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
await chrome.storage.local.set({myKey: "myValue"})
const result = await chrome.storage.local.get("myKey")
print("value: " + result.myKey)
      `,
      );
      await runCell(popup, 0);
      await waitForCellStatus(popup, 0, "success", 20_000);
      await expectCellOutputContains(popup, 0, "value: myValue");
    } finally {
      await context.close();
    }
  });

  test("chrome.storage.local.remove and clear", async () => {
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
await chrome.storage.local.set({key1: "val1", key2: "val2"})
await chrome.storage.local.remove("key1")
const afterRemove = await chrome.storage.local.get(null)
print("afterRemove_keys: " + Object.keys(afterRemove).length)
await chrome.storage.local.clear()
const afterClear = await chrome.storage.local.get(null)
print("afterClear_keys: " + Object.keys(afterClear).length)
      `,
      );
      await runCell(popup, 0);
      await waitForCellStatus(popup, 0, "success", 20_000);
      await expectCellOutputContains(popup, 0, "afterRemove_keys: 1");
      await expectCellOutputContains(popup, 0, "afterClear_keys: 0");
    } finally {
      await context.close();
    }
  });
});
