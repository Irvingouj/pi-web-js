# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chrome-tabs.spec.ts >> web.tab content-script APIs >> web.tab.fetch runs fetch in target tab origin
- Location: tests/e2e/chrome-tabs.spec.ts:267:3

# Error details

```
TimeoutError: page.waitForFunction: Timeout 20000ms exceeded.
```

# Test source

```ts
  1   | import type { Locator, Page } from "@playwright/test";
  2   | 
  3   | /**
  4   |  * Get the cell locator by index.
  5   |  */
  6   | export function getCell(page: Page, index: number): Locator {
  7   |   return page.locator('[data-testid="cell"]').nth(index);
  8   | }
  9   | 
  10  | /**
  11  |  * Get the CodeMirror editor content area for a cell.
  12  |  * CodeMirror renders a contenteditable div inside .cm-content.
  13  |  */
  14  | export function getCellEditor(page: Page, index: number): Locator {
  15  |   return getCell(page, index).locator(".cm-content");
  16  | }
  17  | 
  18  | /**
  19  |  * Get the cell output area.
  20  |  */
  21  | export function getCellOutput(page: Page, index: number): Locator {
  22  |   return getCell(page, index).locator('[data-testid="cell-output"]');
  23  | }
  24  | 
  25  | /**
  26  |  * Get cell error elements.
  27  |  */
  28  | export function getCellError(page: Page, index: number): Locator {
  29  |   return getCell(page, index).locator('[data-testid="cell-error"]');
  30  | }
  31  | 
  32  | /**
  33  |  * Get cell status badge.
  34  |  */
  35  | export function getCellStatus(page: Page, index: number): Locator {
  36  |   return getCell(page, index).locator('[data-testid="cell-status"]');
  37  | }
  38  | 
  39  | /**
  40  |  * Get cell run button.
  41  |  */
  42  | export function getCellRunButton(page: Page, index: number): Locator {
  43  |   return getCell(page, index).locator('[data-testid="cell-run-button"]');
  44  | }
  45  | 
  46  | /**
  47  |  * Set code in a cell's CodeMirror editor.
  48  |  * Uses keyboard: click, select all, type.
  49  |  */
  50  | export async function setCellCode(page: Page, index: number, code: string) {
  51  |   const editor = getCellEditor(page, index);
  52  |   await editor.click();
  53  |   // Select all existing content
  54  |   await page.keyboard.press("Meta+a");
  55  |   // Delete it
  56  |   await page.keyboard.press("Backspace");
  57  |   // Type new content (split into chunks for reliability with special chars)
  58  |   await page.keyboard.insertText(code);
  59  | }
  60  | 
  61  | /**
  62  |  * Run a cell by clicking its run button.
  63  |  */
  64  | export async function runCell(page: Page, index: number) {
  65  |   await getCellRunButton(page, index).click();
  66  | }
  67  | 
  68  | /**
  69  |  * Add a code cell.
  70  |  */
  71  | export async function addCell(page: Page) {
  72  |   await page.locator('[data-testid="add-cell-button"]').click();
  73  | }
  74  | 
  75  | /**
  76  |  * Wait for a cell to reach a specific status.
  77  |  */
  78  | export async function waitForCellStatus(
  79  |   page: Page,
  80  |   index: number,
  81  |   status: string | RegExp,
  82  |   timeout = 15_000,
  83  | ) {
  84  |   const statusEl = getCellStatus(page, index);
  85  |   await statusEl.waitFor({ state: "visible", timeout });
  86  |   // Force re-check with text
> 87  |   await page.waitForFunction(
      |              ^ TimeoutError: page.waitForFunction: Timeout 20000ms exceeded.
  88  |     ({ idx, expected }) => {
  89  |       const cells = document.querySelectorAll('[data-testid="cell-status"]');
  90  |       const cell = cells[idx] as HTMLElement;
  91  |       if (!cell) return false;
  92  |       if (expected instanceof RegExp)
  93  |         return expected.test(cell.textContent || "");
  94  |       return cell.textContent?.includes(expected);
  95  |     },
  96  |     { idx: index, expected: status },
  97  |     { timeout },
  98  |   );
  99  | }
  100 | 
  101 | /**
  102 |  * Wait for kernel to be ready.
  103 |  */
  104 | export async function waitForKernelReady(page: Page, timeout = 15_000) {
  105 |   const el = page.locator('[data-testid="kernel-status"]');
  106 |   await el.waitFor({ state: "visible", timeout });
  107 |   await page.waitForFunction(
  108 |     () => {
  109 |       const el = document.querySelector(
  110 |         '[data-testid="kernel-status"]',
  111 |       ) as HTMLElement;
  112 |       return el?.textContent?.includes("ready");
  113 |     },
  114 |     { timeout },
  115 |   );
  116 | }
  117 | 
  118 | /**
  119 |  * Restart the kernel.
  120 |  */
  121 | export async function restartKernel(page: Page) {
  122 |   await page.locator('[data-testid="restart-kernel-button"]').click();
  123 |   await waitForKernelReady(page);
  124 | }
  125 | 
  126 | /**
  127 |  * Expect cell output to contain text.
  128 |  */
  129 | export async function expectCellOutputContains(
  130 |   page: Page,
  131 |   index: number,
  132 |   text: string,
  133 | ) {
  134 |   await page.waitForFunction(
  135 |     ({ idx, expected }) => {
  136 |       const cells = document.querySelectorAll('[data-testid="cell-output"]');
  137 |       const cell = cells[idx] as HTMLElement;
  138 |       return cell?.textContent?.includes(expected);
  139 |     },
  140 |     { idx: index, expected: text },
  141 |     { timeout: 10_000 },
  142 |   );
  143 | }
  144 | 
  145 | /**
  146 |  * Expect cell error to contain text.
  147 |  */
  148 | export async function expectCellErrorContains(
  149 |   page: Page,
  150 |   index: number,
  151 |   text: string | RegExp,
  152 | ) {
  153 |   const errorEl = getCellError(page, index);
  154 |   await errorEl.first().waitFor({ state: "visible" });
  155 |   if (typeof text === "string") {
  156 |     await page.waitForFunction(
  157 |       ({ idx, expected }) => {
  158 |         const cells = document.querySelectorAll('[data-testid="cell"]');
  159 |         const errors = cells[idx]?.querySelectorAll(
  160 |           '[data-testid="cell-error"]',
  161 |         );
  162 |         if (!errors || errors.length === 0) return false;
  163 |         return Array.from(errors).some((e) =>
  164 |           e.textContent?.includes(expected),
  165 |         );
  166 |       },
  167 |       { idx: index, expected: text },
  168 |       { timeout: 10_000 },
  169 |     );
  170 |   }
  171 | }
  172 | 
```