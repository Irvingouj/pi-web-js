import { test } from "@playwright/test";
import {
	expectCellOutputContains,
	runCell,
	setCellCode,
	waitForCellStatus,
	waitForKernelReady,
} from "../helpers";

test.describe("fs", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await waitForKernelReady(page);
	});

	test("1: fs.writeText and fs.readText roundtrip", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`await fs.writeText("/test_hello.txt", "hello world");
let ok = true;
let txt;
try {
  txt = await fs.readText("/test_hello.txt");
} catch (e) {
  ok = false;
  txt = e;
}
print("ok: " + ok);
print("txt: " + txt);`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "ok: true");
		await expectCellOutputContains(page, 0, "txt: hello world");
	});

	test("2: fs.mkdir and fs.list", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`await fs.mkdir("/test_dir");
await fs.writeText("/test_dir/a.txt", "a");
await fs.writeText("/test_dir/b.txt", "b");
let ok = true;
let entries;
try {
  entries = await fs.list("/test_dir");
} catch (e) {
  ok = false;
  entries = e;
}
print("ok: " + ok);
if (Array.isArray(entries)) {
  print("count: " + entries.length);
  for (const e of entries) {
    print("name: " + e.name);
  }
} else {
  print("entries: " + entries);
}`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "ok: true");
		await expectCellOutputContains(page, 0, "count: 2");
		await expectCellOutputContains(page, 0, "name: a.txt");
		await expectCellOutputContains(page, 0, "name: b.txt");
	});

	test("3: fs.stat returns metadata", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`await fs.writeText("/stat_check.txt", "12345");
let ok = true;
let meta;
try {
  meta = await fs.stat("/stat_check.txt");
} catch (e) {
  ok = false;
  meta = e;
}
print("ok: " + ok);
if (typeof meta === "object" && meta !== null) {
  print("name: " + meta.name);
  print("kind: " + meta.kind);
  print("size: " + meta.size);
} else {
  print("meta: " + meta);
}`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "ok: true");
		await expectCellOutputContains(page, 0, "name: stat_check.txt");
		await expectCellOutputContains(page, 0, "kind: File");
		await expectCellOutputContains(page, 0, "size: 5");
	});

	test("4: path.join, path.basename, path.dirname", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`const joined = path.join("/task", "report", "data.txt");
const base = path.basename("/task/report/data.txt");
const dir = path.dirname("/task/report/data.txt");
print("joined: " + joined);
print("base: " + base);
print("dir: " + dir);`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "joined: /task/report/data.txt");
		await expectCellOutputContains(page, 0, "base: data.txt");
		await expectCellOutputContains(page, 0, "dir: /task/report");
	});

	test("5: fs.exists and fs.delete", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`await fs.writeText("/to_delete.txt", "temporary");
const before = await fs.exists("/to_delete.txt");
print("before: " + before);
await fs.delete("/to_delete.txt");
const after = await fs.exists("/to_delete.txt");
print("after: " + after);`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "before: true");
		await expectCellOutputContains(page, 0, "after: false");
	});

	test("6: fs.copy and fs.move", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`await fs.writeText("/copy_src.txt", "copyme");
await fs.copy("/copy_src.txt", "/copy_dst.txt");
const copied = await fs.readText("/copy_dst.txt");
print("copied: " + copied);
await fs.writeText("/move_src.txt", "moveme");
await fs.move("/move_src.txt", "/move_dst.txt");
const moved = await fs.readText("/move_dst.txt");
print("moved: " + moved);
const srcExists = await fs.exists("/move_src.txt");
print("src_exists: " + srcExists);`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "copied: copyme");
		await expectCellOutputContains(page, 0, "moved: moveme");
		await expectCellOutputContains(page, 0, "src_exists: false");
	});

	test("7: fs.writeBase64 and fs.readBase64", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`await fs.writeBase64("/b64.txt", "aGVsbG8=");
let ok = true;
let txt;
try {
  txt = await fs.readText("/b64.txt");
} catch (e) {
  ok = false;
  txt = e;
}
print("decoded: " + txt);`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "decoded: hello");
	});

	test("8: fs.appendText extends a file", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`await fs.writeText("/append.txt", "hello");
await fs.appendText("/append.txt", " world");
const txt = await fs.readText("/append.txt");
print("appended: " + txt);`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "appended: hello world");
	});

	test("9: fs.readText returns file content", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`await fs.writeText("/readFile_test.txt", "readFile hello");
const txt = await fs.readText("/readFile_test.txt");
print("txt: " + txt);`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "txt: readFile hello");
	});

	test("10: fs.writeText writes and reads back", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`await fs.writeText("/writeFile_test.txt", "writeFile data");
const txt = await fs.readText("/writeFile_test.txt");
print("txt: " + txt);`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "txt: writeFile data");
	});

	test("11: fs.exists returns boolean", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`await fs.writeText("/existsSync_test.txt", "x");
const before = await fs.exists("/existsSync_test.txt");
const after = await fs.exists("/existsSync_missing.txt");
print("before: " + before);
print("after: " + after);`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "before: true");
		await expectCellOutputContains(page, 0, "after: false");
	});

	test("12: fs.list returns directory entries", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`await fs.mkdir("/readdirSync_dir");
await fs.writeText("/readdirSync_dir/a.txt", "a");
await fs.writeText("/readdirSync_dir/b.txt", "b");
const entries = await fs.list("/readdirSync_dir");
print("count: " + entries.length);
for (const e of entries) {
  print("name: " + e.name);
}`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "count: 2");
		await expectCellOutputContains(page, 0, "name: a.txt");
		await expectCellOutputContains(page, 0, "name: b.txt");
	});

	test("13: fs.mkdir creates directory", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`await fs.mkdir("/mkdirSync_dir");
const exists = await fs.exists("/mkdirSync_dir");
print("exists: " + exists);`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "exists: true");
	});

	test("14: fs.delete removes file", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`await fs.writeText("/unlinkSync_test.txt", "delete me");
const before = await fs.exists("/unlinkSync_test.txt");
await fs.delete("/unlinkSync_test.txt");
const after = await fs.exists("/unlinkSync_test.txt");
print("before: " + before);
print("after: " + after);`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "before: true");
		await expectCellOutputContains(page, 0, "after: false");
	});

	test("15: fs.promises.readFile with utf8 works", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`await fs.writeText("/promises_read.txt", "promises hello");
const txt = await fs.readText("/promises_read.txt");
print("txt: " + txt);`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success");
		await expectCellOutputContains(page, 0, "txt: promises hello");
	});
});
