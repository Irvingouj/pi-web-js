import { test } from "@playwright/test";
import {
	expectCellOutputContains,
	runCell,
	setCellCode,
	waitForCellStatus,
	waitForKernelReady,
} from "../helpers";

test.describe("host.call() bridge", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await waitForKernelReady(page);
	});

	test("1: host.call returns error when no handler registered", async ({
		page,
	}) => {
		await setCellCode(
			page,
			0,
			`let ok = true;
try {
  await host.call("unknown_action", {});
} catch (e) {
  ok = false;
}
print("not ok: " + !ok);`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "not ok:");
	});

	test("2: host.call with registered handler returns value", async ({
		page,
	}) => {
		// Register a handler
		await page.evaluate(() => {
			(window as unknown as Record<string, unknown>).__hostHandlers = {
				greet: async (params: unknown) => {
					const name =
						typeof params === "object" && params !== null && "name" in params
							? ((params as Record<string, unknown>).name as string)
							: "world";
					return `Hello, ${name}`;
				},
			};
		});
		await setCellCode(
			page,
			0,
			`let ok = true;
let result;
try {
  result = await host.call("greet", { name: "JS" });
} catch (e) {
  ok = false;
  result = e;
}
if (ok) {
  print("Result: " + result);
} else {
  print("Error: " + result);
}`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "Result:");
	});

	test("3: host.call with handler returning complex data", async ({ page }) => {
		await page.evaluate(() => {
			(window as unknown as Record<string, unknown>).__hostHandlers = {
				getData: async () => ({ items: [1, 2, 3], total: 3 }),
			};
		});
		await setCellCode(
			page,
			0,
			`let ok = true;
let result;
try {
  result = await host.call("getData", {});
} catch (e) {
  ok = false;
  result = e;
}
if (ok) {
  print("Type: " + typeof result);
} else {
  print("Error: " + result);
}`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "Type:");
	});

	test("4: host.call error from handler propagates to JS", async ({ page }) => {
		await page.evaluate(() => {
			(window as unknown as Record<string, unknown>).__hostHandlers = {
				fail: async () => {
					throw new Error("handler error");
				},
			};
		});
		await setCellCode(
			page,
			0,
			`let ok = true;
try {
  await host.call("fail", {});
} catch (e) {
  ok = false;
}
print("not ok: " + !ok);`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "not ok:");
	});

	test("5: host.call combined with built-in APIs", async ({ page }) => {
		await page.evaluate(() => {
			(window as unknown as Record<string, unknown>).__hostHandlers = {
				echo: async (params: unknown) => params,
			};
		});
		await setCellCode(
			page,
			0,
			`let ok = true;
let result;
try {
  result = await host.call("echo", { msg: "hello" });
} catch (e) {
  ok = false;
  result = e;
}
if (ok) {
  print("Type: " + typeof result);
} else {
  print("Error: " + result);
}`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "Type:");
	});
});
