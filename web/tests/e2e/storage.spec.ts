import { test } from "@playwright/test";
import {
  expectCellOutputContains,
  runCell,
  setCellCode,
  waitForCellStatus,
  waitForKernelReady,
} from "../helpers";

// Disabled: localStorage is not injected into the QuickJS runtime.
// These are web platform API tests; prioritizing extension API tests.
test.describe.skip("localStorage", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForKernelReady(page);
  });

  test("1: localStorage.setItem and getItem", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `localStorage.setItem("test_key", "test_value");
const val = localStorage.getItem("test_key");
print("Value: " + val);`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "Value: test_value");
  });

  test("2: localStorage.getItem returns null for missing key", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const val = localStorage.getItem("nonexistent_key_xyz");
print("Value: " + val);`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "Value: null");
  });

  test("3: localStorage.removeItem removes a key", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `localStorage.setItem("to_delete", "hello");
localStorage.removeItem("to_delete");
const val = localStorage.getItem("to_delete");
print("After delete: " + val);`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "After delete: null");
  });

  test("4: Object.keys(localStorage) returns keys", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `localStorage.setItem("list_a", "1");
localStorage.setItem("list_b", "2");
const keys = Object.keys(localStorage);
let hasListA = false;
for (const k of keys) {
  if (k === "list_a") hasListA = true;
}
print("Has list_a: " + hasListA);`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "Has list_a: true");
  });
});
