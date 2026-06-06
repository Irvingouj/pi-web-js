import { test } from "@playwright/test";
import {
	expectCellOutputContains,
	runCell,
	setCellCode,
	waitForCellStatus,
	waitForKernelReady,
} from "./helpers";

test.describe("await test", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await waitForKernelReady(page);
	});

	test("await 1", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`print("before")
await 1
print("after")`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success", 20_000);
		await expectCellOutputContains(page, 0, "after");
	});
});
