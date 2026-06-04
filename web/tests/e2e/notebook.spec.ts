import { expect, test } from "@playwright/test";
import {
	addCell,
	expectCellErrorContains,
	expectCellOutputContains,
	getCell,
	getCellOutput,
	restartKernel,
	runCell,
	setCellCode,
	waitForCellStatus,
	waitForKernelReady,
} from "../helpers";

test.describe("JS Notebook", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
	});

	test("1: app loads and kernel becomes ready", async ({ page }) => {
		await expect(page.locator('[data-testid="app-root"]')).toBeVisible();
		await waitForKernelReady(page);
		await expect(page.locator('[data-testid="kernel-status"]')).toContainText(
			"ready",
		);
	});

	test("2: basic print", async ({ page }) => {
		await waitForKernelReady(page);
		await setCellCode(page, 0, 'print("hello from playwright")');
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "hello from playwright");
	});

	test("3: persistent globals across cells", async ({ page }) => {
		await waitForKernelReady(page);

		// Cell 0: x = 10
		await setCellCode(page, 0, "x = 10");
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");

		// Add cell 1
		await addCell(page);
		await page.waitForTimeout(100);

		// Cell 1: print(x + 1)
		await setCellCode(page, 1, "print(x + 1)");
		await runCell(page, 1);
		await waitForCellStatus(page, 1, "success");

		await expectCellOutputContains(page, 1, "11");
	});

	test("4: function and recursion", async ({ page }) => {
		await waitForKernelReady(page);
		const code = `function fact(n) {
  if (n <= 1) return 1;
  return n * fact(n - 1);
}
print(fact(5))`;
		await setCellCode(page, 0, code);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "120");
	});

	test("5: while loop", async ({ page }) => {
		await waitForKernelReady(page);
		const code = `i = 0;
while (i < 3) {
  print(i);
  i++;
}`;
		await setCellCode(page, 0, code);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		const _output = getCellOutput(page, 0);
		await page.waitForFunction(
			(idx) => {
				const el = document.querySelectorAll('[data-testid="cell-output"]')[
					idx
				] as HTMLElement;
				return (
					el?.textContent?.includes("0") &&
					el?.textContent?.includes("1") &&
					el?.textContent?.includes("2")
				);
			},
			0,
			{ timeout: 10_000 },
		);
	});

	test("6: infinite loop is bounded", async ({ page }) => {
		await waitForKernelReady(page);
		await setCellCode(page, 0, "while (true) {}");
		await runCell(page, 0);

		// Cell should become stopped or error (fuel exhausted)
		await waitForCellStatus(page, 0, /stopped|error/, 15_000);

		// Should have fuel/exhausted/stopped error
		await expectCellErrorContains(page, 0, /fuel|exhausted|stopped/i);

		// Session remains valid: run another cell
		await addCell(page);
		await page.waitForTimeout(100);
		await setCellCode(page, 1, 'print("after loop")');
		await runCell(page, 1);
		await waitForCellStatus(page, 1, "success");
		await expectCellOutputContains(page, 1, "after loop");
	});

	test("7: restart kernel clears state", async ({ page }) => {
		await waitForKernelReady(page);

		page.on("console", (msg) => {
			console.log(`[BROWSER] ${msg.text()}`);
		});

		// Set x = 10
		await setCellCode(page, 0, "x = 10");
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");

		// Restart kernel
		await restartKernel(page);

		// x is undeclared after restart, should error
		await setCellCode(page, 0, "print(x)");
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "error");

		// Check error content
		await expectCellErrorContains(page, 0, /ReferenceError|not defined|error/i);
	});

	test("8: clear outputs", async ({ page }) => {
		await waitForKernelReady(page);

		await setCellCode(page, 0, 'print("clear me")');
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "clear me");

		// Clear outputs
		await page.locator('[data-testid="clear-outputs-button"]').click();
		await page.waitForTimeout(200);

		// Output should be gone
		const output = getCellOutput(page, 0);
		await expect(output).not.toContainText("clear me");
	});

	test("9: add/delete/move cells", async ({ page }) => {
		await waitForKernelReady(page);

		// Start with 1 cell, add 2 more
		await addCell(page);
		await page.waitForTimeout(100);
		await addCell(page);
		await page.waitForTimeout(100);

		// Should have 3 cells
		await expect(page.locator('[data-testid="cell"]')).toHaveCount(3);

		// Fill them
		await setCellCode(page, 0, 'print("A")');
		await setCellCode(page, 1, 'print("B")');
		await setCellCode(page, 2, 'print("C")');

		// Move C (index 2) up once → order becomes A, C, B
		const moveUpBtn = getCell(page, 2).locator(
			'[data-testid="cell-move-up-button"]',
		);
		await moveUpBtn.click();
		await page.waitForTimeout(100);

		// Run all
		await page.locator('[data-testid="run-all-button"]').click();

		// Wait for all cells to finish
		await waitForCellStatus(page, 0, "success");
		await waitForCellStatus(page, 1, "success");
		await waitForCellStatus(page, 2, "success");

		// Check outputs match moved order
		await expectCellOutputContains(page, 0, "A");
		await expectCellOutputContains(page, 1, "C");
		await expectCellOutputContains(page, 2, "B");

		// Delete one cell
		await getCell(page, 1)
			.locator('[data-testid="cell-delete-button"]')
			.click();
		await page.waitForTimeout(100);

		// Should have 2 cells now
		await expect(page.locator('[data-testid="cell"]')).toHaveCount(2);
	});

	test("10: markdown cell add and render", async ({ page }) => {
		await waitForKernelReady(page);

		// Add a markdown cell
		await page.locator('[data-testid="add-md-button"]').click();
		await page.waitForTimeout(100);

		// Should have 2 cells now (code + markdown)
		await expect(page.locator('[data-testid="cell"]')).toHaveCount(2);

		// Cell 1 should be markdown with a preview area
		const mdCell = getCell(page, 1);
		const mdPreview = mdCell.locator('[data-testid="md-preview"]');
		await expect(mdPreview).toBeVisible();
		await expect(mdPreview).toHaveText("");
	});

	test("11: markdown edit via button and double-click", async ({ page }) => {
		await waitForKernelReady(page);

		// Add a markdown cell
		await page.locator('[data-testid="add-md-button"]').click();
		await page.waitForTimeout(100);

		const mdCell = getCell(page, 1);

		// Click Edit button to enter edit mode
		await mdCell.locator('button[data-action="toggleEdit"]').click();
		await page.waitForTimeout(200);

		// Write some markdown
		const editor = mdCell.locator(".cm-content");
		await editor.click();
		await page.keyboard.insertText("# Hello World\n\nThis is **bold** text.");

		// Click Done button to render
		await mdCell.locator('button[data-action="toggleEdit"]').click();
		await page.waitForTimeout(200);

		// Should show rendered markdown
		const preview = mdCell.locator('[data-testid="md-preview"]');
		await expect(preview).toBeVisible();
		await expect(preview.locator("h1")).toHaveText("Hello World");
		await expect(preview.locator("strong")).toHaveText("bold");

		// Double-click to re-edit
		await preview.dblclick();
		await page.waitForTimeout(200);

		// Should be back in editor mode
		const editor2 = mdCell.locator(".cm-content");
		await expect(editor2).toBeVisible();
	});

	test("12: markdown Ctrl+Enter renders, Escape exits editing", async ({
		page,
	}) => {
		await waitForKernelReady(page);

		// Add a markdown cell and enter edit mode
		await page.locator('[data-testid="add-md-button"]').click();
		await page.waitForTimeout(100);

		const mdCell = getCell(page, 1);
		await mdCell.locator('button[data-action="toggleEdit"]').click();
		await page.waitForTimeout(200);

		const editor = mdCell.locator(".cm-content");
		await editor.click();
		await page.keyboard.insertText("## Heading Two");

		// Ctrl+Enter to render
		await page.keyboard.press("Control+Enter");
		await page.waitForTimeout(200);

		// Should show rendered h2
		const preview = mdCell.locator('[data-testid="md-preview"]');
		await expect(preview).toBeVisible();
		await expect(preview.locator("h2")).toHaveText("Heading Two");

		// Double-click to re-edit
		await preview.dblclick();
		await page.waitForTimeout(200);

		const editor2 = mdCell.locator(".cm-content");
		await expect(editor2).toBeVisible();

		// Press Escape to exit editing
		await page.keyboard.press("Escape");
		await page.waitForTimeout(200);

		// Back to preview
		const preview2 = mdCell.locator('[data-testid="md-preview"]');
		await expect(preview2).toBeVisible();
	});

	test("13: toggle cell kind between code and markdown", async ({ page }) => {
		await waitForKernelReady(page);

		// Cell 0 starts as code
		const codeCell = getCell(page, 0);
		await expect(codeCell.locator(".cell-kind-badge")).toHaveText("JS");

		// Click MD button to convert to markdown
		await codeCell.locator('button[data-action="toggleKind"]').click();
		await page.waitForTimeout(100);

		// Should now be markdown
		await expect(codeCell.locator(".cell-kind-badge")).toHaveText("MD");
		const preview = codeCell.locator('[data-testid="md-preview"]');
		await expect(preview).toBeVisible();

		// Click JS button to convert back to code
		await codeCell.locator('button[data-action="toggleKind"]').click();
		await page.waitForTimeout(100);

		// Should be code again
		await expect(codeCell.locator(".cell-kind-badge")).toHaveText("JS");
		const editor = codeCell.locator(".cm-content");
		await expect(editor).toBeVisible();
	});

	test("14: markdown lists, code blocks, and links render", async ({
		page,
	}) => {
		await waitForKernelReady(page);

		await page.locator('[data-testid="add-md-button"]').click();
		await page.waitForTimeout(100);

		const mdCell = getCell(page, 1);
		await mdCell.locator('button[data-action="toggleEdit"]').click();
		await page.waitForTimeout(200);

		const editor = mdCell.locator(".cm-content");
		await editor.click();
		await page.keyboard.insertText(
			"- item one\n- item two\n\n`inline code`\n\n```\ncode block\n```\n\n[piccolo](https://github.com/kyren/piccolo)",
		);

		// Render
		await mdCell.locator('button[data-action="toggleEdit"]').click();
		await page.waitForTimeout(200);

		const preview = mdCell.locator('[data-testid="md-preview"]');
		await expect(preview).toBeVisible();

		// Check list items
		await expect(preview.locator("li")).toHaveCount(2);
		await expect(preview.locator("li").first()).toHaveText("item one");

		// Check link
		const link = preview.locator("a");
		await expect(link).toHaveAttribute(
			"href",
			"https://github.com/kyren/piccolo",
		);
		await expect(link).toHaveText("piccolo");
	});

	test("15: save/load notebook — skipped: uses native file picker", async () => {
		test.skip();
	});
});
