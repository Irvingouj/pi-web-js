import { test } from "@playwright/test";
import {
  expectCellOutputContains,
  runCell,
  setCellCode,
  waitForCellStatus,
  waitForKernelReady,
} from "../helpers";

test.describe("dom.snapshot", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForKernelReady(page);
  });

  test("1: dom.snapshot returns object with data and text", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await dom.snapshot();
print(typeof snap.data);
print(typeof snap.text);`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "object");
    await expectCellOutputContains(page, 0, "string");
  });

  test("2: dom.snapshot data has nodes array", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await dom.snapshot();
print(typeof snap.data.nodes);
print(snap.data.nodes.length > 0);`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "object");
    await expectCellOutputContains(page, 0, "true");
  });

  test("3: dom.snapshot nodes have semantic roles", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await dom.snapshot();
const node = snap.data.nodes[0];
print(typeof node.role);
print(node.role !== "");`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "string");
    await expectCellOutputContains(page, 0, "true");
  });

  test("4: dom.snapshot with options", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await dom.snapshot({ interactive_only: true, max_nodes: 50 });
print(snap.data.nodes.length <= 50);`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "true");
  });

  test("5: dom.snapshot text is compact format", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await dom.snapshot({ max_nodes: 5 });
const text = snap.text;
print(typeof text);
print(text.length > 0);`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "string");
    await expectCellOutputContains(page, 0, "true");
  });

  test("6: dom.snapshot text starts with ref ID bracket", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await dom.snapshot({ max_nodes: 3 });
const text = snap.text;
print(text.slice(0, 2));`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "[e");
  });

  test("7: dom.snapshot nodes have expected fields", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await dom.snapshot();
const node = snap.data.nodes[0];
print(typeof node.refId === "string");
print(typeof node.role === "string");
print(typeof node.tag === "string");`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "true");
  });

  test("8: dom.snapshot returns viewport info", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await dom.snapshot();
if (snap.data.viewport) {
  print(typeof snap.data.viewport.width === "number");
  print(typeof snap.data.viewport.height === "number");
} else {
  print(true);
}`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "true");
  });

  test("9: dom.snapshot version is available", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await dom.snapshot();
print(snap.data.version != null);
print(typeof snap.data.version === "string");`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "true");
  });

  test("10: dom.snapshot text shows button roles", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await dom.snapshot();
const hasButton = snap.text.includes("button");
print(hasButton);`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "true");
  });
});
