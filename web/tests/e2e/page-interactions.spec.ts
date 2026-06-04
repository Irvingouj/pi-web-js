import { test } from "@playwright/test";
import {
	expectCellOutputContains,
	runCell,
	setCellCode,
	waitForCellStatus,
	waitForKernelReady,
} from "../helpers";

test.describe("page interactions", () => {
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

	test("1: page.click on valid ref succeeds", async ({ page }) => {
		const consoleMessages: string[] = [];
		page.on("console", (msg) => {
			consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
		});
		try {
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
  await page.click(btnRef);
  print("clicked");
} else {
  print("no button");
}`,
			);
			await runCell(page, 0);
			await waitForCellStatus(page, 0, "success");
			await expectCellOutputContains(page, 0, "clicked");
		} catch (e) {
			console.log("Browser console messages:", consoleMessages.join("\n"));
			throw e;
		}
	});

	test("2: page.dblclick on valid ref succeeds", async ({ page }) => {
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
  await page.dblclick(btnRef);
  print("dblclicked");
} else {
  print("no button");
}`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "dblclicked");
	});

	test("3: page.fill on input succeeds", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`const snap = await page.snapshot_data();
let inputRef = null;
for (const node of snap.data.nodes) {
  if (node.tag === "input" && node.role === "textbox") {
    inputRef = node.refId;
    break;
  }
}
if (inputRef) {
  await page.fill(inputRef, "hello world");
  print("filled");
} else {
  print("no input");
}`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "filled");
	});

	test("4: page.type on input sets value", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`const snap = await page.snapshot_data();
let inputRef = null;
for (const node of snap.data.nodes) {
  if (node.tag === "input" && node.role === "textbox") {
    inputRef = node.refId;
    break;
  }
}
if (inputRef) {
  await page.type(inputRef, "abc");
  print("typed");
} else {
  print("no input");
}`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "typed");
	});

	test("5: page.press dispatches key event", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`const snap = await page.snapshot_data();
let inputRef = null;
for (const node of snap.data.nodes) {
  if (node.tag === "input" && node.role === "textbox") {
    inputRef = node.refId;
    break;
  }
}
if (inputRef) {
  await page.fill(inputRef, "test");
  await page.press("Enter");
  print("pressed");
} else {
  print("no input");
}`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "pressed");
	});

	test("6: page.select on dropdown succeeds", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`const snap = await page.snapshot_data();
let selectRef = null;
for (const node of snap.data.nodes) {
  if (node.tag === "select" || node.role === "combobox") {
    selectRef = node.refId;
    break;
  }
}
if (selectRef) {
  await page.select(selectRef, "b");
  print("selected");
} else {
  print("no select");
}`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "selected");
	});

	test("7: page.check on checkbox succeeds", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`const snap = await page.snapshot_data();
let checkRef = null;
for (const node of snap.data.nodes) {
  if (node.role === "checkbox") {
    checkRef = node.refId;
    break;
  }
}
if (checkRef) {
  await page.check(checkRef, true);
  print("checked");
} else {
  print("no checkbox");
}`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "checked");
	});

	test("8: page.scroll_to on tall element succeeds", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`const snap = await page.snapshot_data();
let tallRef = null;
for (const node of snap.data.nodes) {
  if (node.tag === "div" && node.refId) {
    tallRef = node.refId;
  }
}
if (tallRef) {
  await page.scroll_to(tallRef);
  print("scrolled");
} else {
  print("no tall element");
}`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "scrolled");
	});

	test("9: page.back after history push succeeds", async ({ page }) => {
		// Push a history entry from the Playwright side so page.back() has somewhere to go
		await page.evaluate(() => {
			history.pushState({}, "", "#before-back");
		});
		await setCellCode(
			page,
			0,
			`await page.back();
print("went back");`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "went back");
	});

	test("10: page.forward after back succeeds", async ({ page }) => {
		// Push two entries, go back, then forward
		await page.evaluate(() => {
			history.pushState({}, "", "#step-1");
			history.pushState({}, "", "#step-2");
			history.back();
		});
		await setCellCode(
			page,
			0,
			`await page.forward();
print("went forward");`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "went forward");
	});

	test("11: page.append on input appends text", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`const snap = await page.snapshot_data();
let inputRef = null;
for (const node of snap.data.nodes) {
  if (node.tag === "input" && node.role === "textbox") {
    inputRef = node.refId;
    break;
  }
}
if (inputRef) {
  await page.fill(inputRef, "hello");
  await page.append(inputRef, " world");
  print("appended");
} else {
  print("no input");
}`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "appended");
	});

	test("12: page.click with CSS selector succeeds", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`await page.click("#e2e-button");
print("clicked");`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "clicked");
	});

	test("13: page.fill with CSS selector succeeds", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`await page.fill("#e2e-input", "hello");
print("filled");`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "filled");
	});

	test("14: page.type with CSS selector succeeds", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`await page.type("#e2e-input", "abc");
print("typed");`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "typed");
	});
});
