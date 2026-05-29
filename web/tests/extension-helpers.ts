import path from "node:path";
import { fileURLToPath } from "node:url";
import { type BrowserContext, chromium, type Page } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, "../dist");

/**
 * Launch Chromium with the extension loaded and open the popup.
 * Returns the context, extension ID, and popup page.
 */
export async function launchExtensionContext(): Promise<{
  context: BrowserContext;
  extensionId: string;
  popup: Page;
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

  // Open popup
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/index.html`);

  return { context, extensionId, popup };
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
