import { test } from "@playwright/test";
import {
	expectCellOutputContains,
	runCell,
	setCellCode,
	waitForCellStatus,
	waitForKernelReady,
} from "./helpers";

// Disabled: URL, URLSearchParams and setTimeout are not injected into the QuickJS runtime.
// These are web platform API tests; prioritizing extension API tests.
test.describe
	.skip("URL / console.log / setTimeout", () => {
		test.beforeEach(async ({ page }) => {
			await page.goto("/");
			await waitForKernelReady(page);
		});

		test("1: URL constructor extracts URL components", async ({ page }) => {
			await setCellCode(
				page,
				0,
				`const u = new URL("https://example.com:8080/path?q=1#section");
print("protocol: " + u.protocol);
print("host: " + u.host);`,
			);
			await runCell(page, 0);
			await waitForCellStatus(page, 0, "success");
			await expectCellOutputContains(page, 0, "protocol: https:");
			await expectCellOutputContains(page, 0, "host: example.com:8080");
		});

		test("2: URLSearchParams encodes object to query string", async ({
			page,
		}) => {
			await setCellCode(
				page,
				0,
				`const qs = new URLSearchParams({ a: "1", b: "hello world" }).toString();
print("qs: " + qs);`,
			);
			await runCell(page, 0);
			await waitForCellStatus(page, 0, "success");
			await expectCellOutputContains(page, 0, "qs:");
		});

		test("3: setTimeout pauses execution", async ({ page }) => {
			await setCellCode(
				page,
				0,
				`print("before sleep");
await new Promise(resolve => setTimeout(resolve, 100));
print("slept");`,
			);
			await runCell(page, 0);
			await waitForCellStatus(page, 0, "success", 20_000);
			await expectCellOutputContains(page, 0, "slept");
		});

		test("4: console.log does not crash", async ({ page }) => {
			await setCellCode(
				page,
				0,
				`console.log("test message");
print("logged");`,
			);
			await runCell(page, 0);
			await waitForCellStatus(page, 0, "success");
			await expectCellOutputContains(page, 0, "logged");
		});
	});
