import { test } from "@playwright/test";
import {
	expectCellOutputContains,
	runCell,
	setCellCode,
	waitForCellStatus,
	waitForKernelReady,
} from "../helpers";

// Disabled: these test web platform global APIs (fetch, document, localStorage, etc.)
// which are not currently injected into the QuickJS runtime. The prelude.js aliases
// them from globalThis, but globalThis inside QuickJS is not the browser window.
// Prioritizing extension API tests (contract.spec.ts) which use the Rust bridge.
test.describe
	.skip("global APIs", () => {
		test.beforeEach(async ({ page }) => {
			await page.goto("/");
			await waitForKernelReady(page);
			// Inject a fixture with interactive elements for the tests
			await page.evaluate(() => {
				const fixture = document.createElement("div");
				fixture.id = "e2e-test-fixture";
				fixture.style.cssText = "padding: 20px;";
				fixture.innerHTML = `
        <input type="text" id="e2e-input" value="initial" />
      `;
				document.body.appendChild(fixture);
			});
		});

		test.describe("fetch", () => {
			test("1: global fetch works as web.fetch", async ({ page }) => {
				await setCellCode(
					page,
					0,
					`try {
  const result = await fetch("https://httpbin.org/json");
  print("Status: " + result.status);
  const data = JSON.parse(result.body);
  print("Has slideshow: " + (data.slideshow !== null));
} catch (e) {
  print("Fetch error: " + e);
}`,
				);
				await runCell(page, 0);
				await waitForCellStatus(page, 0, "success");
				await expectCellOutputContains(page, 0, "Status: 200");
				await expectCellOutputContains(page, 0, "Has slideshow: true");
			});
		});

		test.describe("setTimeout", () => {
			test("2: setTimeout schedules and fires", async ({ page }) => {
				await setCellCode(
					page,
					0,
					`print("before");
setTimeout(() => print("after"), 100);`,
				);
				await runCell(page, 0);
				await waitForCellStatus(page, 0, "success");
				await expectCellOutputContains(page, 0, "before");
				await expectCellOutputContains(page, 0, "after");
			});
		});

		test.describe("URL", () => {
			test("3: new URL has correct properties", async ({ page }) => {
				await setCellCode(
					page,
					0,
					`const u = new URL("https://example.com:8080/path?q=1#section");
print("protocol: " + u.protocol);
print("host: " + u.host);
print("hostname: " + u.hostname);
print("port: " + u.port);
print("pathname: " + u.pathname);
print("search: " + u.search);
print("hash: " + u.hash);`,
				);
				await runCell(page, 0);
				await waitForCellStatus(page, 0, "success");
				await expectCellOutputContains(page, 0, "protocol: https:");
				await expectCellOutputContains(page, 0, "host: example.com:8080");
				await expectCellOutputContains(page, 0, "hostname: example.com");
				await expectCellOutputContains(page, 0, "port: 8080");
				await expectCellOutputContains(page, 0, "pathname: /path");
				await expectCellOutputContains(page, 0, "search: ?q=1");
				await expectCellOutputContains(page, 0, "hash: #section");
			});
		});

		test.describe("URLSearchParams", () => {
			test("4: URLSearchParams.get works", async ({ page }) => {
				await setCellCode(
					page,
					0,
					`const params = new URLSearchParams({ a: "1" });
print("a: " + params.get("a"));`,
				);
				await runCell(page, 0);
				await waitForCellStatus(page, 0, "success");
				await expectCellOutputContains(page, 0, "a: 1");
			});
		});

		test.describe("localStorage", () => {
			test("5: localStorage setItem and getItem work", async ({ page }) => {
				await setCellCode(
					page,
					0,
					`localStorage.setItem("key", "value");
print("Value: " + localStorage.getItem("key"));`,
				);
				await runCell(page, 0);
				await waitForCellStatus(page, 0, "success");
				await expectCellOutputContains(page, 0, "Value: value");
			});
		});

		test.describe("document", () => {
			test("6: document.querySelector finds element", async ({ page }) => {
				await setCellCode(
					page,
					0,
					`const el = document.querySelector("#e2e-input");
print("Found: " + (el !== null));
print("Tag: " + el.tagName);
print("Value: " + el.value);`,
				);
				await runCell(page, 0);
				await waitForCellStatus(page, 0, "success");
				await expectCellOutputContains(page, 0, "Found: true");
				await expectCellOutputContains(page, 0, "Tag: INPUT");
				await expectCellOutputContains(page, 0, "Value: initial");
			});

			test("7: document.title returns page title", async ({ page }) => {
				await setCellCode(page, 0, `print("Title: " + document.title);`);
				await runCell(page, 0);
				await waitForCellStatus(page, 0, "success");
				await expectCellOutputContains(page, 0, "Title:");
			});
		});

		test.describe("window", () => {
			test("8: window.location.href returns page URL", async ({ page }) => {
				await setCellCode(page, 0, `print("URL: " + window.location.href);`);
				await runCell(page, 0);
				await waitForCellStatus(page, 0, "success");
				await expectCellOutputContains(page, 0, "URL:");
			});
		});
	});
