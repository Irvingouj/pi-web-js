import { expect, test } from "@playwright/test";
import {
	expectCellOutputContains,
	runCell,
	setCellCode,
	waitForCellStatus,
	waitForKernelReady,
} from "./helpers";

test.describe("web kernel contract", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await waitForKernelReady(page);
		page.on("console", (msg) => {
			console.log(`[BROWSER] ${msg.text()}`);
		});
	});

	test("Promise.all with two sleeps", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`const [a, b] = await Promise.all([web.sleep(1), web.sleep(1)]);
print("both done: " + a + " " + b);`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success", 15_000);
		await expectCellOutputContains(page, 0, "both done:");
	});

	test("Promise.all with two fs operations", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`await fs.writeText("/pa_test1.txt", "a");
await fs.writeText("/pa_test2.txt", "b");
const [r1, r2] = await Promise.all([
  fs.readText("/pa_test1.txt"),
  fs.readText("/pa_test2.txt"),
]);
print("r1: " + r1 + " r2: " + r2);`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success", 15_000);
		await expectCellOutputContains(page, 0, "r1: a");
		await expectCellOutputContains(page, 0, "r2: b");
	});

	test("extension-only API returns typed error", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`let caught = false;
try {
  await chrome.tabs.query({ active: true });
} catch (e) {
  caught = true;
}
print("caught: " + caught);`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success", 15_000);
		await expectCellOutputContains(page, 0, "caught: true");
	});

	test("host.call blocked paths return error", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`let protoBlocked = false;
try { await host.call("__proto__", {}); } catch (e) { protoBlocked = true; }
let unknownBlocked = false;
try { await host.call("nonexistent_action", {}); } catch (e) { unknownBlocked = true; }
print("proto: " + protoBlocked + " unknown: " + unknownBlocked);`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success", 15_000);
		await expectCellOutputContains(page, 0, "proto: true");
		await expectCellOutputContains(page, 0, "unknown: true");
	});

	test("fs camelCase aliases work", async ({ page }) => {
		await setCellCode(
			page,
			0,
			`await fs.writeText("/contract_alias_test.txt", "hello alias");
const txt = await fs.readText("/contract_alias_test.txt");
print("alias: " + txt);`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success", 15_000);
		await expectCellOutputContains(page, 0, "alias: hello alias");
	});

	test("smoke test: representative APIs from each namespace", async ({
		page,
	}) => {
		await setCellCode(
			page,
			0,
			`const results = [];

// web namespace
try { await web.sleep(1); results.push({api: "web.sleep", ok: true}); }
catch (e) { results.push({api: "web.sleep", ok: false}); }

// fs namespace
try { await fs.writeText("/contract_smoke.txt", "test"); const t = await fs.readText("/contract_smoke.txt"); results.push({api: "fs.writeText+readText", ok: t === "test"}); }
catch (e) { results.push({api: "fs.writeText+readText", ok: false}); }

// storage
try { await web.storage.set("_contract_test", "1"); const v = await web.storage.get("_contract_test"); results.push({api: "storage.set+get", ok: v === "1"}); }
catch (e) { results.push({api: "storage.set+get", ok: false}); }

// path
try { const j = path.join("/a", "b"); results.push({api: "path.join", ok: j === "/a/b"}); }
catch (e) { results.push({api: "path.join", ok: false}); }

// Extension-only APIs should fail gracefully in web playground
try { await chrome.tabs.query({}); results.push({api: "chrome.tabs.query", ok: false}); }
catch (e) { results.push({api: "chrome.tabs.query", ok: true}); }

try { await tab.current(); results.push({api: "tab.current", ok: false}); }
catch (e) { results.push({api: "tab.current", ok: true}); }

// host.call blocked paths
try { await host.call("__proto__", {}); results.push({api: "host.call.__proto__", ok: false}); }
catch (e) { results.push({api: "host.call.__proto__", ok: true}); }

try { await host.call("constructor.constructor('return globalThis')()", {}); results.push({api: "host.call.injection", ok: false}); }
catch (e) { results.push({api: "host.call.injection", ok: true}); }

// Promise.all concurrent execution (non-fetch)
try {
  const [r1, r2] = await Promise.all([
    fs.writeText("/pa_smoke1.txt", "a"),
    fs.writeText("/pa_smoke2.txt", "b"),
  ]);
  results.push({api: "Promise.all fs", ok: true});
} catch (e) { results.push({api: "Promise.all fs", ok: false}); }

const pass = results.filter(r => r.ok).length;
const total = results.length;
print("SMOKE_TOTAL: " + total);
print("SMOKE_PASS: " + pass);
for (const r of results.filter(r => !r.ok)) {
  print("SMOKE_FAIL: " + r.api);
}`,
		);
		await runCell(page, 0);
		await waitForCellStatus(page, 0, "success", 60_000);

		await expectCellOutputContains(page, 0, "SMOKE_TOTAL:");
		await expectCellOutputContains(page, 0, "SMOKE_PASS:");

		const output = await page
			.locator('[data-testid="cell-output"]')
			.first()
			.textContent();

		const totalMatch = output?.match(/SMOKE_TOTAL:\s*(\d+)/);
		const passMatch = output?.match(/SMOKE_PASS:\s*(\d+)/);

		expect(totalMatch).toBeTruthy();
		expect(passMatch).toBeTruthy();

		const total = parseInt(totalMatch?.[1], 10);
		const pass = parseInt(passMatch?.[1], 10);

		expect(pass).toBe(total);

		console.log(`Smoke test: ${pass}/${total} passed`);
		console.log(output?.slice(0, 3000));
	});

});
