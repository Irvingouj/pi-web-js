import path from "node:path";
import { fileURLToPath } from "node:url";
import { type BrowserContext, chromium, type Page } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, "../dist");

/**
 * Launch Chromium with the extension loaded and open the popup.
 * Also opens a blank tab so page.* / web.tab.* APIs have an active tab.
 * Returns the context, extension ID, popup page, and the helper tab.
 */
export async function launchExtensionContext(): Promise<{
  context: BrowserContext;
  extensionId: string;
  popup: Page;
  helperTab: Page;
}> {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  // Find service worker to get extension ID
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker");
  }
  const extensionId = serviceWorker.url().split("/")[2];

  // Open a helper tab so extension's getActiveTabId() returns a valid tab.
  // Must use http/https URL so chrome.scripting.executeScript works (data:, about: don't).
  const helperTab = await context.newPage();
  await helperTab.goto("https://example.com");

  // Open popup
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/index.html`);

  // Wait for popup to fully load and initialize extension listeners
  await popup.waitForTimeout(1000);

  // Bring helper tab to front so chrome.tabs.onActivated fires in extension
  await helperTab.bringToFront();

  // Give extension time to process the tab activation
  await popup.waitForTimeout(500);

  return { context, extensionId, popup, helperTab };
}

// Re-export all regular test helpers for use in extension tests
export {
  addCell,
  expectCellErrorContains,
  expectCellOutputContains,
  getCell,
  getCellEditor,
  getCellError,
  getCellOutput,
  getCellRunButton,
  getCellStatus,
  restartKernel,
  runCell,
  setCellCode,
  waitForCellStatus,
  waitForKernelReady,
} from "./helpers";
