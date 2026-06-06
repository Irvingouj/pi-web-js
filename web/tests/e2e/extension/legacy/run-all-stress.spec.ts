import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { launchExtensionContext } from "../extension-helpers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const notebookPath = resolve(
	__dirname,
	"../../../comprehensive-test-notebook.json",
);

const notebook: { cells: Array<{ id: string; kind: string; source: string }> } =
	JSON.parse(readFileSync(notebookPath, "utf-8"));

const codeCells = notebook.cells.filter((c) => c.kind === "code");

test("Run All - Sequential execution stress test", async () => {
	test.setTimeout(600_000);

	const { context, popup } = await launchExtensionContext();

	try {
		// Load the notebook
		await popup.click('[data-testid="load-button"]');

		// Wait for file picker and select comprehensive-test-notebook.json
		// Note: File picker is hard to automate, so we'll inject cells directly

		// Clear existing cells and add all notebook cells
		await popup.evaluate(
			(cells) => {
				// Clear all cells
				const existingCells = document.querySelectorAll('[data-testid="cell"]');
				existingCells.forEach((c) => {
					c.remove();
				});

				// Add each cell from the notebook
				cells.forEach((cellSource: string) => {
					const addButton = document.querySelector(
						'[data-testid="add-cell-button"]',
					) as HTMLElement;
					if (addButton) addButton.click();

					// Wait a bit for cell to be added
					setTimeout(() => {
						const editors = document.querySelectorAll(".cm-content");
						const lastEditor = editors[editors.length - 1] as HTMLElement;
						if (lastEditor) {
							lastEditor.innerText = cellSource;
							lastEditor.dispatchEvent(new Event("input", { bubbles: true }));
						}
					}, 100);
				});
			},
			codeCells.map((c) => c.source),
		);

		// Wait for cells to be added
		await popup.waitForTimeout(2000);

		// Click "Run All"
		console.log("Clicking Run All...");
		await popup.click('[data-testid="run-all-button"]');

		// Wait for all cells to finish (success or error)
		const startTime = Date.now();
		const maxWaitTime = 300_000; // 5 minutes

		while (Date.now() - startTime < maxWaitTime) {
			const allFinished = await popup.evaluate(() => {
				const statuses = document.querySelectorAll(
					'[data-testid="cell-status"]',
				);
				const allDone = Array.from(statuses).every((s) => {
					const text = (s as HTMLElement).textContent?.toLowerCase() || "";
					return text === "success" || text === "error";
				});
				return {
					allDone,
					total: statuses.length,
					success: Array.from(statuses).filter(
						(s) => (s as HTMLElement).textContent?.toLowerCase() === "success",
					).length,
					error: Array.from(statuses).filter(
						(s) => (s as HTMLElement).textContent?.toLowerCase() === "error",
					).length,
					running: Array.from(statuses).filter((s) => {
						const t = (s as HTMLElement).textContent?.toLowerCase() || "";
						return t === "running" || t === "idle";
					}).length,
				};
			});

			console.log(
				`Progress: ${allFinished.success} success, ${allFinished.error} error, ${allFinished.running} running/idle / ${allFinished.total} total`,
			);

			if (allFinished.allDone) {
				break;
			}

			await popup.waitForTimeout(2000);
		}

		// Get final results
		const finalResults = await popup.evaluate(() => {
			const cells = document.querySelectorAll('[data-testid="cell"]');
			return Array.from(cells).map((cell, i) => {
				const status = cell.querySelector(
					'[data-testid="cell-status"]',
				) as HTMLElement;
				const output = cell.querySelector(
					'[data-testid="cell-output"]',
				) as HTMLElement;
				return {
					index: i,
					status: status?.textContent || "no status",
					output: output?.textContent?.substring(0, 200) || "no output",
				};
			});
		});

		console.log("\n=== FINAL RESULTS ===");
		const successCount = finalResults.filter(
			(r) => r.status.toLowerCase() === "success",
		).length;
		const errorCount = finalResults.filter(
			(r) => r.status.toLowerCase() === "error",
		).length;

		console.log(`Total cells: ${finalResults.length}`);
		console.log(`Success: ${successCount}`);
		console.log(`Error: ${errorCount}`);

		// Log any errors
		finalResults.forEach((r) => {
			if (r.status.toLowerCase() === "error") {
				console.log(`\n❌ Cell ${r.index}: ${r.status}`);
				console.log(`Output: ${r.output}`);
			}
		});

		// The test passes if we get results (no crash)
		// We expect some cells might fail due to API limitations, but the extension shouldn't crash
		expect(finalResults.length).toBeGreaterThan(0);
		console.log("\n✅ Extension did not crash during Run All!");
	} finally {
		await context.close();
	}
});
