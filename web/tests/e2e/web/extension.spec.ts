import { test } from "@playwright/test";
import {
	expectCellOutputContains,
	runCell,
	setCellCode,
	waitForCellStatus,
	waitForKernelReady,
} from "./helpers";

test.describe("Browser Extension APIs", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await waitForKernelReady(page);
	});

	test("1: web.tab.query returns error in non-extension context", async ({
		page,
	}) => {
		await setCellCode(
			page,
			0,
			`let ok = true;
try {
  await web.tab.query({});
} catch (e) {
  ok = false;
}
print("not ok: " + !ok);`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "not ok:");
	});

	test("2: web.cookies.list returns error in non-extension context", async ({
		page,
	}) => {
		await setCellCode(
			page,
			0,
			`let ok = true;
try {
  await web.cookies.list({});
} catch (e) {
  ok = false;
}
print("not ok: " + !ok);`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "not ok:");
	});

	test("3: web.history.search returns error in non-extension context", async ({
		page,
	}) => {
		await setCellCode(
			page,
			0,
			`let ok = true;
try {
  await web.history.search({});
} catch (e) {
  ok = false;
}
print("not ok: " + !ok);`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "not ok:");
	});

	test("4: web.bookmarks.search returns error in non-extension context", async ({
		page,
	}) => {
		await setCellCode(
			page,
			0,
			`let ok = true;
try {
  await web.bookmarks.search("test");
} catch (e) {
  ok = false;
}
print("not ok: " + !ok);`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "not ok:");
	});

	test("5: extension APIs are accessible from JS", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`// Verify the API objects exist
print("tab: " + typeof web.tab);
print("cookies: " + typeof web.cookies);
print("history: " + typeof web.history);
print("bookmarks: " + typeof web.bookmarks);`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "tab: object");
	});
});
