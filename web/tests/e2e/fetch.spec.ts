import { test } from "@playwright/test";
import {
	expectCellOutputContains,
	runCell,
	setCellCode,
	waitForCellStatus,
	waitForKernelReady,
} from "../helpers";

test.describe("fetch", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await waitForKernelReady(page);
	});

	test("1: fetch returns response from mock API", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`try {
  const result = await fetch("https://httpbin.org/json");
  print("Status: " + result.status);
  const data = JSON.parse(result.body);
  print("Has slideshow: " + (data.slideshow !== null));
  print("Has title: " + (data.slideshow.title !== undefined));
} catch (e) {
  print("Fetch error: " + e);
}`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
	});

	test("2: fetch handles HTTP 404", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`try {
  const result = await fetch("https://httpbin.org/status/404");
  print("Status: " + result.status);
} catch (e) {
  print("Error: " + e);
}`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
	});

	test("3: fetch handles network error with try/catch", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`let ok = true;
try {
  await fetch("https://0.0.0.0:1/impossible", { timeout: 1000 });
} catch (e) {
  ok = false;
}
print("try ok: " + ok);`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "try ok:");
	});

	test("4: fetch with POST method", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`try {
  const result = await fetch("https://httpbin.org/post", {
    method: "POST",
    body: '{"hello":"world"}',
    headers: { "Content-Type": "application/json" }
  });
  print("Status: " + result.status);
} catch (e) {
  print("Error: " + e);
}`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
	});

	test("5: multiple fetch calls in one cell", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`const urls = [
  "https://httpbin.org/get",
  "https://httpbin.org/ip"
];
for (let i = 0; i < urls.length; i++) {
  try {
    const result = await fetch(urls[i]);
    print("Fetch " + i + ": " + result.status);
  } catch (e) {
    print("Fetch " + i + " error");
  }
}`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
	});
});
