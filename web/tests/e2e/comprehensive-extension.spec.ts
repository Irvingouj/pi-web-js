import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { launchExtensionContext } from "../extension-helpers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const notebookPath = resolve(__dirname, "../../../comprehensive-test-notebook.json");

const notebook: { cells: Array<{ id: string; kind: string; source: string }> } = JSON.parse(
  readFileSync(notebookPath, "utf-8"),
);

const codeCells = notebook.cells.filter((c) => c.kind === "code");

test("Comprehensive API Test - Extension Context", async () => {
  test.setTimeout(600_000);

  const { context, popup } = await launchExtensionContext();

  try {
    const failures: Array<{ id: string; status: string; output: string }> = [];

    for (const cell of codeCells) {
      // Clear previous cell
      await popup.evaluate(() => {
        const cells = document.querySelectorAll('[data-testid="cell"]');
        cells.forEach((c, i) => {
          if (i > 0) c.remove();
        });
      });

      // Set cell code
      await popup.evaluate((code) => {
        const editor = document.querySelector('.cm-content') as HTMLElement;
        if (editor) {
          editor.innerText = code;
          editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, cell.source);

      // Run cell
      await popup.click('[data-testid="cell-run-button"]');

      // Wait for cell to finish
      await popup.waitForFunction(() => {
        const status = document.querySelector('[data-testid="cell-status"]');
        const text = status?.textContent?.toLowerCase() || '';
        return text === 'success' || text === 'error';
      }, { timeout: 30_000 });

      const status = await popup.evaluate(() => {
        const el = document.querySelector('[data-testid="cell-status"]') as HTMLElement;
        return el?.textContent || 'no status';
      });

      const output = await popup.evaluate(() => {
        const el = document.querySelector('[data-testid="cell-output"]') as HTMLElement;
        return el?.textContent || 'no output';
      });

      if (status.toLowerCase() !== 'success') {
        failures.push({ id: cell.id, status, output: output.substring(0, 500) });
        console.log(`\n❌ FAILED: ${cell.id}`);
        console.log("Status:", status);
        console.log("Output:", output.substring(0, 300));
      } else {
        console.log(`✅ PASSED: ${cell.id}`);
      }
    }

    console.log(`\n=== SUMMARY ===`);
    console.log(`Total: ${codeCells.length}`);
    console.log(`Passed: ${codeCells.length - failures.length}`);
    console.log(`Failed: ${failures.length}`);

    if (failures.length > 0) {
      console.log("\nFailed cells:");
      failures.forEach((f) => console.log(`  - ${f.id}: ${f.status}`));
    }

    expect(failures.length).toBe(0);
  } finally {
    await context.close();
  }
});
