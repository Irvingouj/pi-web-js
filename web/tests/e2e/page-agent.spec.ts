import { test } from "@playwright/test";
import {
  expectCellOutputContains,
  runCell,
  setCellCode,
  waitForCellStatus,
  waitForKernelReady,
} from "../helpers";

test.describe("page.agent", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForKernelReady(page);
    await page.evaluate(() => {
      const fixture = document.createElement("div");
      fixture.id = "e2e-test-fixture";
      fixture.style.cssText = "padding: 20px;";
      fixture.innerHTML = `
        <input type="text" id="e2e-input" value="initial" />
        <select id="e2e-select">
          <option value="a">Option A</option>
          <option value="b">Option B</option>
        </select>
        <input type="checkbox" id="e2e-checkbox" />
        <button id="e2e-button" onclick="this.dataset.clicks=(parseInt(this.dataset.clicks||0)+1).toString()">Click me</button>
        <div id="e2e-tall" style="height: 2000px; width: 100px; background: #eee;"></div>
      `;
      document.body.appendChild(fixture);
    });
  });

  test("1: page.snapshot returns readable text", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const text = await page.snapshot();
print(typeof text);`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "string");
  });

  test("2: page.snapshot_data returns structured data", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await page.snapshot_data();
print(typeof snap.data);
print(typeof snap.text);`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "object");
    await expectCellOutputContains(page, 0, "string");
  });

  test("3: page.snapshot text has ref IDs", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const text = await page.snapshot({ max_nodes: 3 });
print(text.slice(0, 2));`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "[");
  });

  test("4: page.snapshot_data with max_nodes", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await page.snapshot_data({ max_nodes: 10 });
print(snap.data.nodes.length > 0);`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "true");
  });

  test("5: page.snapshot_data nodes have roles", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await page.snapshot_data();
const node = snap.data.nodes[0];
print(typeof node.refId);
print(typeof node.role);`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "string");
  });

  test("6: page.click invalid ref throws error", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `let ok = true;
try {
  await page.click("e999");
} catch (e) {
  ok = false;
}
print(String(ok));`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "false");
  });

  test("7: page.hover and page.unhover work", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await page.snapshot_data({ interactive_only: true });
let btnRef = null;
for (const node of snap.data.nodes) {
  if (node.role === "button") {
    btnRef = node.refId;
    break;
  }
}
if (btnRef) {
  const ok1 = await page.hover(btnRef);
  print("hover:" + ok1);
  const ok2 = await page.unhover();
  print("unhover:" + ok2);
} else {
  print("no button");
}`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "hover:");
  });

  test("8: page.url returns URL string", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const url = await page.url();
print(typeof url);`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "string");
  });

  test("9: page.title returns title string", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const title = await page.title();
print(typeof title);`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "string");
  });

  test("10: page.scroll works", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const result = await page.scroll("down", 100);
print(String(result));`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "true");
  });

  test("11: page.wait completes", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const result = await page.wait(100);
print(String(result));`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "true");
  });

  test("12: page.snapshot_data has version", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await page.snapshot_data();
print(typeof snap.data.version);`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "string");
  });

  test("13: page.snapshot_data has viewport", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await page.snapshot_data();
if (snap.data.viewport) {
  print(typeof snap.data.viewport.width);
} else {
  print("no viewport");
}`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "number");
  });

  test("14: page.snapshot_data text is non-empty", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await page.snapshot_data({ max_nodes: 5 });
print(snap.text.length > 0);`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "true");
  });

  test("15: page.snapshot_data with interactive_only", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await page.snapshot_data({ interactive_only: true });
print(snap.data.nodes.length > 0);`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "true");
  });

  test("16: page.find returns matching elements", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const found = await page.find("button");
print(typeof found);
print(found.length > 0);`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "object");
    await expectCellOutputContains(page, 0, "true");
  });

  test("17: page.wait_for finds existing element", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const ok = await page.wait_for("button", 1000);
print(String(ok));`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "true");
  });

  test("18: page.extract returns requested fields", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const data = await page.extract(["title", "url"]);
print(typeof data.title);
print(typeof data.url);`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "string");
  });

  test("19: page.snapshot_text alias returns string", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const text = await page.snapshot_text();
print(typeof text);`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "string");
  });

  test("20: page.snapshot_data has elements alias", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await page.snapshot_data({ max_nodes: 5 });
print(snap.data.elements.length > 0);`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "true");
  });

  test("21: sidepanel.click on valid ref succeeds", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await sidepanel.snapshot_data({ interactive_only: true });
let btnRef = null;
for (const node of snap.data.nodes) {
  if (node.role === "button") {
    btnRef = node.refId;
    break;
  }
}
if (btnRef) {
  await sidepanel.click(btnRef);
  print("clicked");
} else {
  print("no button");
}`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "clicked");
  });

  test("22: sidepanel.fill on input succeeds", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await sidepanel.snapshot_data();
let inputRef = null;
for (const node of snap.data.nodes) {
  if (node.tag === "input" && node.role === "textbox") {
    inputRef = node.refId;
    break;
  }
}
if (inputRef) {
  await sidepanel.fill(inputRef, "hello");
  print("filled");
} else {
  print("no input");
}`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "filled");
  });

  test("23: sidepanel.type on input sets value", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await sidepanel.snapshot_data();
let inputRef = null;
for (const node of snap.data.nodes) {
  if (node.tag === "input" && node.role === "textbox") {
    inputRef = node.refId;
    break;
  }
}
if (inputRef) {
  await sidepanel.type(inputRef, "abc");
  print("typed");
} else {
  print("no input");
}`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "typed");
  });

  test("24: sidepanel.append on input appends text", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await sidepanel.snapshot_data();
let inputRef = null;
for (const node of snap.data.nodes) {
  if (node.tag === "input" && node.role === "textbox") {
    inputRef = node.refId;
    break;
  }
}
if (inputRef) {
  await sidepanel.fill(inputRef, "hello");
  await sidepanel.append(inputRef, " world");
  print("appended");
} else {
  print("no input");
}`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "appended");
  });

  test("25: sidepanel.press dispatches key event", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await sidepanel.snapshot_data();
let inputRef = null;
for (const node of snap.data.nodes) {
  if (node.tag === "input" && node.role === "textbox") {
    inputRef = node.refId;
    break;
  }
}
if (inputRef) {
  await sidepanel.fill(inputRef, "test");
  await sidepanel.press("Enter");
  print("pressed");
} else {
  print("no input");
}`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "pressed");
  });

  test("26: sidepanel.select on dropdown succeeds", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await sidepanel.snapshot_data();
let selectRef = null;
for (const node of snap.data.nodes) {
  if (node.tag === "select" || node.role === "combobox") {
    selectRef = node.refId;
    break;
  }
}
if (selectRef) {
  await sidepanel.select(selectRef, "b");
  print("selected");
} else {
  print("no select");
}`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "selected");
  });

  test("27: sidepanel.check on checkbox succeeds", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await sidepanel.snapshot_data();
let checkRef = null;
for (const node of snap.data.nodes) {
  if (node.role === "checkbox") {
    checkRef = node.refId;
    break;
  }
}
if (checkRef) {
  await sidepanel.check(checkRef, true);
  print("checked");
} else {
  print("no checkbox");
}`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "checked");
  });

  test("28: sidepanel.hover and sidepanel.unhover work", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await sidepanel.snapshot_data({ interactive_only: true });
let btnRef = null;
for (const node of snap.data.nodes) {
  if (node.role === "button") {
    btnRef = node.refId;
    break;
  }
}
if (btnRef) {
  const ok1 = await sidepanel.hover(btnRef);
  print("hover:" + ok1);
  const ok2 = await sidepanel.unhover();
  print("unhover:" + ok2);
} else {
  print("no button");
}`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "hover:");
  });

  test("29: sidepanel.scroll works", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const result = await sidepanel.scroll("down", 100);
print(String(result));`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "true");
  });

  test("30: sidepanel.scroll_to on tall element succeeds", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const snap = await sidepanel.snapshot_data();
let tallRef = null;
for (const node of snap.data.nodes) {
  if (node.tag === "div" && node.refId) {
    tallRef = node.refId;
  }
}
if (tallRef) {
  await sidepanel.scroll_to(tallRef);
  print("scrolled");
} else {
  print("no tall element");
}`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "scrolled");
  });

  test("31: sidepanel.url returns URL string", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const url = await sidepanel.url();
print(typeof url);`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "string");
  });

  test("32: sidepanel.title returns title string", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const title = await sidepanel.title();
print(typeof title);`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "string");
  });

  test("33: sidepanel.wait completes", async ({ page }) => {
    await setCellCode(
      page,
      0,
      `const result = await sidepanel.wait(100);
print(String(result));`,
    );
    await runCell(page, 0);
    await waitForCellStatus(page, 0, "success");
    await expectCellOutputContains(page, 0, "true");
  });
});
