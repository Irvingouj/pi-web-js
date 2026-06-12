import { test, expect } from "./fixtures.ts";
import { executeCell } from "./lib/harness.ts";
import { RESULT_PREFIX, SLOW_NETWORK_URL } from "./lib/constants.ts";
import type { ContractResult } from "./lib/types.ts";

test.describe.serial("navigation stability", () => {
	test.setTimeout(20_000);

	test("concurrent public run requests are serialized", async ({ harness }) => {
		const results = await harness.sidepanel.evaluate(async () => {
			const session = (
				window as Window & {
					__extensionSession?: {
						runCellAsync(code: string, stdin?: string): Promise<unknown>;
					};
				}
			).__extensionSession;
			if (!session) throw new Error("Extension session not exposed");

			return Promise.all([
				session.runCellAsync(
					'await web.sleep(200); print("first");',
				),
				session.runCellAsync('print("second");'),
			]);
		});

		expect(results).toHaveLength(2);
		expect(results[0]).toMatchObject({ status: "ok", stdout: ["first"] });
		expect(results[1]).toMatchObject({ status: "ok", stdout: ["second"] });
	});

	test("goto positional URL -> extract positional fields", async ({ harness }) => {
		const source = `
var RESULT_PREFIX = "${RESULT_PREFIX}";

const tabs = await chrome.tabs.query({ url: "https://extension-js.test/fixture" });
if (tabs.length === 0) {
  throw new Error("Fixture tab not found");
}
await chrome.tabs.update(tabs[0].id, { active: true });

await page.goto("https://extension-js.test/next");
let result = await page.extract(["title", "url"]);
print(RESULT_PREFIX + JSON.stringify({ ok: true, value: result }));
`;

		const exec = await executeCell<
			ContractResult<{ title: string; url: string }>
		>(harness.sidepanel, source, 20_000);

		expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
		expect(exec.result).toEqual({
			ok: true,
			value: {
				title: "Next page",
				url: "https://extension-js.test/next",
			},
		});
	});

	test("bare top-level await without let/const is wrapped safely", async ({ harness }) => {
		const source = `
var RESULT_PREFIX = "${RESULT_PREFIX}";

const tabs = await chrome.tabs.query({ url: "https://extension-js.test/*" });
if (tabs.length === 0) {
  throw new Error("Test tab not found");
}
await chrome.tabs.update(tabs[0].id, { active: true });

await page.goto("https://extension-js.test/next");
print(RESULT_PREFIX + JSON.stringify({ ok: true, value: "bare-await" }));
`;

		const exec = await executeCell<ContractResult<string>>(
			harness.sidepanel,
			source,
			20_000,
		);

		expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
		expect(exec.result).toEqual({ ok: true, value: "bare-await" });
	});

	test("goto -> url -> title -> snapshot without manual sleep", async ({ harness }) => {
		const source = `
var RESULT_PREFIX = "${RESULT_PREFIX}";

// Find any extension test tab (prior cells may have navigated away from /fixture)
const tabs = await chrome.tabs.query({ url: "https://extension-js.test/*" });
if (tabs.length === 0) {
  throw new Error("Test tab not found");
}
const fixtureTabId = tabs[0].id;
await chrome.tabs.update(fixtureTabId, { active: true });

		// Navigate to /next and immediately run subsequent commands
await page.goto({ url: "https://extension-js.test/next" });

const url = await page.url();
const title = await page.title();
const snapshot = await page.snapshot_data();
const refId = snapshot.nodes[0].refId;
await page.click({ refId: refId });

print(RESULT_PREFIX + JSON.stringify({
  ok: true,
  value: {
    url: url,
    title: title,
    hasSnapshot: !!snapshot && Array.isArray(snapshot.nodes),
    nodeCount: snapshot.nodes.length,
    refId: refId,
    clicked: true,
  }
}));
`;

		const exec = await executeCell<ContractResult<{
			url: string;
			title: string;
			hasSnapshot: boolean;
			nodeCount: number;
			refId: string;
			clicked: boolean;
		}>>(harness.sidepanel, source, 20_000);

		expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
		expect(exec.result?.ok).toBe(true);
		if (exec.result?.ok) {
			expect(exec.result.value.url).toContain("/next");
			expect(exec.result.value.title).toBe("Next page");
			expect(exec.result.value.hasSnapshot).toBe(true);
			expect(exec.result.value.nodeCount).toBeGreaterThan(0);
			expect(exec.result.value.refId).toMatch(/^e\d+$/);
			expect(exec.result.value.clicked).toBe(true);
		}
	});

	test("goto then extract matches user notebook snippet", async ({ harness }) => {
		const source = `
var RESULT_PREFIX = "${RESULT_PREFIX}";

const tabs = await chrome.tabs.query({ url: "https://extension-js.test/*" });
if (tabs.length === 0) {
  throw new Error("Test tab not found");
}
await chrome.tabs.update(tabs[0].id, { active: true });

await page.goto("https://extension-js.test/next");
let result = await page.extract(["title", "url"]);
print(RESULT_PREFIX + JSON.stringify({ ok: true, value: result }));
`;

		const exec = await executeCell<
			ContractResult<{ title: string; url: string }>
		>(harness.sidepanel, source, 20_000);

		expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
		expect(exec.result?.ok).toBe(true);
		if (exec.result?.ok) {
			expect(exec.result.value.title).toBe("Next page");
			expect(exec.result.value.url).toContain("/next");
		}
	});

	test("goto to non-scriptable page returns structured E_NAVIGATION", async ({ harness }) => {
		const source = `
var RESULT_PREFIX = "${RESULT_PREFIX}";
var result = { ok: true, value: null };
try {
  await page.goto({ url: "chrome://settings" });
} catch (err) {
  result = {
    ok: false,
    error: {
      code: err && err.code ? err.code : "E_NAVIGATION",
      message: err && err.message ? err.message : String(err),
    },
  };
}
print(RESULT_PREFIX + JSON.stringify(result));
`;

		const exec = await executeCell<ContractResult<null>>(
			harness.sidepanel,
			source,
			15_000,
		);

		expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
		expect(exec.result?.ok).toBe(false);
		if (!exec.result?.ok) {
			expect(exec.result.error.code).toBe("E_NAVIGATION");
			expect(exec.result.error.message).toContain("Navigation blocked");
		}
	});

	test("goto with waitUntil networkidle waits for delayed fetches", async ({ harness }) => {
		const source = `
var RESULT_PREFIX = "${RESULT_PREFIX}";

// Navigate to the slow-network testcase with networkidle
await page.goto({
  url: "${SLOW_NETWORK_URL}",
  waitUntil: "networkidle",
  timeout: 15000n,
});

// At networkidle, the delayed fetches should have completed
// and the #data div should contain both data payloads
const snapshot = await page.snapshot();
var RESULT_PREFIX = "${RESULT_PREFIX}";
print(RESULT_PREFIX + JSON.stringify({
  ok: true,
  value: {
    hasData1: snapshot.includes("Delayed data payload 1"),
    hasData2: snapshot.includes("Delayed data payload 2"),
    statusComplete: snapshot.includes("Data loaded"),
  }
}));
`;

		const exec = await executeCell<
			ContractResult<{ hasData1: boolean; hasData2: boolean; statusComplete: boolean }>
		>(harness.sidepanel, source, 30_000);

		expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
		expect(exec.result?.ok).toBe(true);
		if (exec.result?.ok) {
			expect(exec.result.value.hasData1).toBe(true);
			expect(exec.result.value.hasData2).toBe(true);
			expect(exec.result.value.statusComplete).toBe(true);
		}
	});

	test("goto with waitUntil load returns before delayed fetches complete", async ({ harness }) => {
		const source = `
var RESULT_PREFIX = "${RESULT_PREFIX}";

// Navigate with default waitUntil: "load" — should return before fetches finish
await page.goto({
  url: "${SLOW_NETWORK_URL}",
  timeout: 15000n,
});

// Immediately snapshot — fetches are delayed 100-200ms after load,
// so with load-only wait, the data div should still be empty
const snapshot = await page.snapshot();
var RESULT_PREFIX = "${RESULT_PREFIX}";
print(RESULT_PREFIX + JSON.stringify({
  ok: true,
  value: {
    hasData1: snapshot.includes("Delayed data payload 1"),
    hasData2: snapshot.includes("Delayed data payload 2"),
  }
}));
`;

		const exec = await executeCell<
			ContractResult<{ hasData1: boolean; hasData2: boolean }>
		>(harness.sidepanel, source, 30_000);

		expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
		expect(exec.result?.ok).toBe(true);
		if (exec.result?.ok) {
			// With waitUntil: "load", delayed fetches have NOT completed yet
			expect(exec.result.value.hasData1).toBe(false);
			expect(exec.result.value.hasData2).toBe(false);
		}
	});
});
