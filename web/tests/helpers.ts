import type { Locator, Page } from "@playwright/test";

/**
 * Get the cell locator by index.
 */
export function getCell(page: Page, index: number): Locator {
  return page.locator('[data-testid="cell"]').nth(index);
}

/**
 * Get the CodeMirror editor content area for a cell.
 * CodeMirror renders a contenteditable div inside .cm-content.
 */
export function getCellEditor(page: Page, index: number): Locator {
  return getCell(page, index).locator(".cm-content");
}

/**
 * Get the cell output area.
 */
export function getCellOutput(page: Page, index: number): Locator {
  return getCell(page, index).locator('[data-testid="cell-output"]');
}

/**
 * Get cell error elements.
 */
export function getCellError(page: Page, index: number): Locator {
  return getCell(page, index).locator('[data-testid="cell-error"]');
}

/**
 * Get cell status badge.
 */
export function getCellStatus(page: Page, index: number): Locator {
  return getCell(page, index).locator('[data-testid="cell-status"]');
}

/**
 * Get cell run button.
 */
export function getCellRunButton(page: Page, index: number): Locator {
  return getCell(page, index).locator('[data-testid="cell-run-button"]');
}

/**
 * Set code in a cell's CodeMirror editor.
 * Uses keyboard: click, select all, type.
 */
export async function setCellCode(page: Page, index: number, code: string) {
  const editor = getCellEditor(page, index);
  await editor.click();
  // Select all existing content
  await page.keyboard.press("Meta+a");
  // Delete it
  await page.keyboard.press("Backspace");
  // Type new content (split into chunks for reliability with special chars)
  await page.keyboard.insertText(code);
}

/**
 * Run a cell by clicking its run button.
 */
export async function runCell(page: Page, index: number) {
  console.log(`[helpers.runCell] clicking cell ${index}`);
  await getCellRunButton(page, index).click();
  console.log(`[helpers.runCell] clicked cell ${index}`);
}

export async function runCellViaKernel(page: Page, index: number) {
  await page.evaluate((idx) => {
    const cells = document.querySelectorAll('[data-testid="cell"]');
    const cell = cells[idx];
    const cellId = cell?.getAttribute('data-cell-id');
    const editorWrapper = cell?.querySelector('.cm-editor-wrapper') as any;
    const view = editorWrapper?.__codemirror;
    const code = view?.state?.doc?.toString() || '';
    if (cellId && (window as any).__kernel) {
      (window as any).__kernel.runCell(cellId, code, '');
    }
  }, index);
}

/**
 * Add a code cell.
 */
export async function addCell(page: Page) {
  await page.locator('[data-testid="add-cell-button"]').click();
}

/**
 * Wait for a cell to reach a specific status.
 */
export async function waitForCellStatus(
  page: Page,
  index: number,
  status: string | RegExp,
  timeout = 15_000,
) {
  const statusEl = getCellStatus(page, index);
  await statusEl.waitFor({ state: "visible", timeout });
  // Force re-check with text
  await page.waitForFunction(
    ({ idx, expected }) => {
      const cells = document.querySelectorAll('[data-testid="cell-status"]');
      const cell = cells[idx] as HTMLElement;
      if (!cell) return false;
      if (expected instanceof RegExp)
        return expected.test(cell.textContent || "");
      return cell.textContent?.includes(expected);
    },
    { idx: index, expected: status },
    { timeout },
  );
}

/**
 * Wait for kernel to be ready.
 */
export async function waitForKernelReady(page: Page, timeout = 15_000) {
  const el = page.locator('[data-testid="kernel-status"]');
  await el.waitFor({ state: "visible", timeout });
  await page.waitForFunction(
    () => {
      const el = document.querySelector(
        '[data-testid="kernel-status"]',
      ) as HTMLElement;
      return el?.textContent?.includes("ready");
    },
    { timeout },
  );
}

/**
 * Restart the kernel.
 */
export async function restartKernel(page: Page) {
  await page.locator('[data-testid="restart-kernel-button"]').click();
  await waitForKernelReady(page);
  // Wait for Cell.tsx's 500ms debounce window to pass before any subsequent runCell calls.
  await page.waitForTimeout(500);
}

/**
 * Expect cell output to contain text.
 */
export async function expectCellOutputContains(
  page: Page,
  index: number,
  text: string,
) {
  await page.waitForFunction(
    ({ idx, expected }) => {
      const cells = document.querySelectorAll('[data-testid="cell-output"]');
      const cell = cells[idx] as HTMLElement;
      return cell?.textContent?.includes(expected);
    },
    { idx: index, expected: text },
    { timeout: 10_000 },
  );
}

/**
 * Expect cell error to contain text.
 */
export async function expectCellErrorContains(
  page: Page,
  index: number,
  text: string | RegExp,
) {
  const errorEl = getCellError(page, index);
  await errorEl.first().waitFor({ state: "visible" });
  if (typeof text === "string") {
    await page.waitForFunction(
      ({ idx, expected }) => {
        const cells = document.querySelectorAll('[data-testid="cell"]');
        const errors = cells[idx]?.querySelectorAll(
          '[data-testid="cell-error"]',
        );
        if (!errors || errors.length === 0) return false;
        return Array.from(errors).some((e) =>
          e.textContent?.includes(expected),
        );
      },
      { idx: index, expected: text },
      { timeout: 10_000 },
    );
  }
}
