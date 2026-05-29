# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: fetch.spec.ts >> fetch >> 3: fetch handles network error with try/catch
- Location: tests/e2e/fetch.spec.ts:49:3

# Error details

```
TimeoutError: page.waitForFunction: Timeout 15000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - banner [ref=e3]:
    - generic [ref=e4]:
      - generic [ref=e5]: ⚡
      - heading "JS Notebook" [level=1] [ref=e6]
    - generic [ref=e7]:
      - button "🌓" [ref=e8] [cursor=pointer]
      - generic [ref=e9]: "Kernel: ready"
  - navigation [ref=e10]:
    - generic [ref=e11]:
      - button "▶ Run All" [ref=e12] [cursor=pointer]
      - button "■ Stop" [ref=e13] [cursor=pointer]
      - button "↻ Restart" [ref=e14] [cursor=pointer]
    - generic [ref=e16]:
      - button "+ Code" [ref=e17] [cursor=pointer]
      - button "+ Markdown" [ref=e18] [cursor=pointer]
      - button "Clear Outputs" [ref=e19] [cursor=pointer]
    - generic [ref=e21]:
      - button "✕ New" [ref=e22] [cursor=pointer]
      - button "↓ Save" [ref=e23] [cursor=pointer]
      - button "↑ Load" [ref=e24] [cursor=pointer]
  - main [ref=e25]:
    - generic [ref=e27]:
      - generic [ref=e28]:
        - generic [ref=e29]: In [1]
        - generic [ref=e30]: JS
        - generic [ref=e31]: error
        - generic [ref=e32]:
          - button "▶ Run" [active] [ref=e33] [cursor=pointer]
          - button "MD" [ref=e34] [cursor=pointer]
          - button "+" [ref=e35] [cursor=pointer]
          - button "↑" [disabled] [ref=e36]
          - button "↓" [disabled] [ref=e37]
          - button "✕" [disabled] [ref=e38]
      - generic [ref=e41]:
        - generic [ref=e43]: Selection deleted
        - generic [ref=e44]:
          - generic [ref=e45]:
            - generic [ref=e46]:
              - generic [ref=e47]: "1"
              - generic [ref=e48]: "2"
              - generic [ref=e49]: "3"
              - generic [ref=e50]: "4"
              - generic [ref=e51]: "5"
              - generic [ref=e52]: "6"
              - generic [ref=e53]: "7"
            - generic [ref=e54]:
              - generic [ref=e55]: ⌄
              - generic [ref=e56]: ⌄
          - textbox [ref=e58]:
            - generic [ref=e59]: let ok = true;
            - generic [ref=e60]: "try {"
            - generic [ref=e61]: "await fetch(\"https://0.0.0.0:1/impossible\", { timeout: 1000 });"
            - generic [ref=e62]: "} catch (e) {"
            - generic [ref=e63]: ok = false;
            - generic [ref=e64]: "}"
            - generic [ref=e65]: "print(\"try ok: \" + ok);"
      - generic [ref=e66]:
        - generic [ref=e67]: "[makeAsync] calling __webJsTriggerAsync for action: fetch"
        - generic [ref=e68]: "[makeAsync] __webJsTriggerAsync returned for action: fetch"
        - generic [ref=e69]: "[run_cell] pending_async_command: Some(AsyncCommand { call_id: 1, action: Fetch, params: Object {&quot;headers&quot;: Object {}, &quot;method&quot;: String(&quot;GET&quot;), &quot;timeout&quot;: Number(1000), &quot;url&quot;: String(&quot;https://0.0.0.0:1/impossible&quot;)} })"
        - generic [ref=e70]: "[makeAsync] calling __webJsTriggerAsync for action: fetch"
        - generic [ref=e71]: "[makeAsync] __webJsTriggerAsync returned for action: fetch"
        - generic [ref=e72]: "[run_cell] pending_async_command: Some(AsyncCommand { call_id: 1, action: Fetch, params: Object {&quot;headers&quot;: Object {}, &quot;method&quot;: String(&quot;GET&quot;), &quot;timeout&quot;: Number(1000), &quot;url&quot;: String(&quot;https://0.0.0.0:1/impossible&quot;)} })"
        - generic [ref=e73]: "[resume_cell] pending_async_command: Some(AsyncCommand { call_id: 1, action: Fetch, params: Object {&quot;headers&quot;: Object {}, &quot;method&quot;: String(&quot;GET&quot;), &quot;timeout&quot;: Number(1000), &quot;url&quot;: String(&quot;https://0.0.0.0:1/impossible&quot;)} }), call_id: Some(1)"
        - generic [ref=e74]: "Runtime error: SyntaxError:"
  - contentinfo [ref=e75]:
    - text: Powered by
    - link "boa" [ref=e76] [cursor=pointer]:
      - /url: https://github.com/boa-dev/boa
    - text: ·
    - link "JavaScript" [ref=e77] [cursor=pointer]:
      - /url: https://developer.mozilla.org/en-US/docs/Web/JavaScript
    - text: ·
    - link "📚 Showcase" [ref=e78] [cursor=pointer]:
      - /url: "?showcase=true"
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
      |              ^ TimeoutError: page.waitForFunction: Timeout 15000ms exceeded.
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