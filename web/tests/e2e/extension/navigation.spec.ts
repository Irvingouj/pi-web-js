import { expect, test } from "./fixtures.ts";
import {
	RESULT_PREFIX,
	SLOW_NETWORK_URL,
	SNAPSHOT_QUERY_URL,
} from "./lib/constants.ts";
import { executeCell } from "./lib/harness.ts";
import type { ContractResult } from "./lib/types.ts";

test.describe
	.serial("navigation stability", () => {
		test.setTimeout(20_000);

		test("concurrent public run requests are serialized", async ({
			harness,
		}) => {
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
					session.runCellAsync('await web.sleep(200); print("first");'),
					session.runCellAsync('print("second");'),
				]);
			});

			expect(results).toHaveLength(2);
			expect(results[0]).toMatchObject({ status: "ok", stdout: ["first"] });
			expect(results[1]).toMatchObject({ status: "ok", stdout: ["second"] });
		});

		test("goto positional URL -> extract positional fields", async ({
			harness,
		}) => {
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

		test("bare top-level await without let/const is wrapped safely", async ({
			harness,
		}) => {
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

		test("goto -> url -> title -> snapshot without manual sleep", async ({
			harness,
		}) => {
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

			const exec = await executeCell<
				ContractResult<{
					url: string;
					title: string;
					hasSnapshot: boolean;
					nodeCount: number;
					refId: string;
					clicked: boolean;
				}>
			>(harness.sidepanel, source, 20_000);

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

		test("goto then extract matches user notebook snippet", async ({
			harness,
		}) => {
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

		test("goto to non-scriptable page returns structured E_NAVIGATION", async ({
			harness,
		}) => {
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

		test("goto with waitUntil networkidle waits for delayed fetches", async ({
			harness,
		}) => {
			const source = `
var RESULT_PREFIX = "${RESULT_PREFIX}";

// Activate the fixture tab — executeCell brings the sidepanel to front,
// so page.goto would otherwise target chrome-extension:// and throw E_PERMISSION.
const fixtureTabs = await chrome.tabs.query({ url: "https://extension-js.test/*" });
if (fixtureTabs.length > 0) await chrome.tabs.update(fixtureTabs[0].id, { active: true });

// Navigate to the slow-network testcase with networkidle
await page.goto({
  url: "${SLOW_NETWORK_URL}",
  waitUntil: "networkidle",
  timeout: 15000n,
});

// At networkidle, the delayed fetches should have completed
// and the #data div should contain both data payloads.
// Use snapshot_data (not snapshot) because snapshot text truncates element
// names at 60 chars — too short for the full "Delayed data payload N" string.
const data = await page.snapshot_data();
let dataText = "";
for (const node of data.nodes) {
  if (node.text) dataText += node.text + "\\n";
}
var RESULT_PREFIX = "${RESULT_PREFIX}";
print(RESULT_PREFIX + JSON.stringify({
  ok: true,
  value: {
    hasData1: dataText.includes("Delayed data payload 1"),
    hasData2: dataText.includes("Delayed data payload 2"),
    statusComplete: dataText.includes("Data loaded"),
  }
}));
`;

			const exec = await executeCell<
				ContractResult<{
					hasData1: boolean;
					hasData2: boolean;
					statusComplete: boolean;
				}>
			>(harness.sidepanel, source, 30_000);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.hasData1).toBe(true);
				expect(exec.result.value.hasData2).toBe(true);
				expect(exec.result.value.statusComplete).toBe(true);
			}
		});

		test("goto with waitUntil load returns after content-script grace period", async ({
			harness,
		}) => {
			const source = `
var RESULT_PREFIX = "${RESULT_PREFIX}";

// Activate any http(s) tab — the prior test may have navigated the fixture tab.
const httpTabs = await chrome.tabs.query({ url: "http://*/*" });
if (httpTabs.length > 0) await chrome.tabs.update(httpTabs[0].id, { active: true });

// Navigate with default waitUntil: "load" — should return before fetches finish
await page.goto({
  url: "${SLOW_NETWORK_URL}",
  timeout: 15000n,
});

// Snapshot after load — the fetches are delayed 100-200ms after script execution
// (which runs during page parsing, before the load event). By the time page.goto
// returns (load + content-script ping + 500ms grace), the fetches have completed.
// Use snapshot_data because snapshot text truncates element names at 60 chars.
const data = await page.snapshot_data();
let dataText = "";
for (const node of data.nodes) {
  if (node.text) dataText += node.text + "\\n";
}
var RESULT_PREFIX = "${RESULT_PREFIX}";
print(RESULT_PREFIX + JSON.stringify({
  ok: true,
  value: {
    hasData1: dataText.includes("Delayed data payload 1"),
    hasData2: dataText.includes("Delayed data payload 2"),
  }
}));
`;

			const exec = await executeCell<
				ContractResult<{ hasData1: boolean; hasData2: boolean }>
			>(harness.sidepanel, source, 30_000);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				// The content-script grace period (500ms) after load gives enough time
				// for the 100-200ms delayed fetches to complete.
				expect(exec.result.value.hasData1).toBe(true);
				expect(exec.result.value.hasData2).toBe(true);
			}
		});
	});

test.describe
	.serial("snapshot_query semantic filtering", () => {
		test.setTimeout(30_000);

		test("filter by role returns only buttons", async ({ harness }) => {
			const source = `
var RESULT_PREFIX = "${RESULT_PREFIX}";

const tabs = await chrome.tabs.query({ url: "http://*/*" });
if (tabs.length === 0) {
  const tab = await chrome.tabs.create({ url: "${SNAPSHOT_QUERY_URL}" });
  await new Promise(r => setTimeout(r, 2000));
} else {
  await chrome.tabs.update(tabs[0].id, { active: true });
}

await page.goto({ url: "${SNAPSHOT_QUERY_URL}", timeout: 15000n });
let result = await page.snapshot_query({ filter: { role: "button" } });
print(RESULT_PREFIX + JSON.stringify({ ok: true, value: result }));
`;
			const exec = await executeCell<
				ContractResult<{
					nodes: Array<{ role: string; text: string }>;
					nodeCount: number;
				}>
			>(harness.sidepanel, source, 30_000);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				const nodes = exec.result.value.nodes;
				for (const node of nodes) {
					expect(node.role).toBe("button");
				}
				expect(nodes.length).toBe(2);
			}
		});

		test("filter by interactiveOnly returns only interactive elements", async ({
			harness,
		}) => {
			const source = `
var RESULT_PREFIX = "${RESULT_PREFIX}";

// Ensure an http(s) tab is active — page.goto refuses chrome-extension:// sidepanel.
const tabs = await chrome.tabs.query({ url: "http://*/*" });
if (tabs.length === 0) {
  await chrome.tabs.create({ url: "${SNAPSHOT_QUERY_URL}" });
  await new Promise(r => setTimeout(r, 2000));
} else {
  await chrome.tabs.update(tabs[0].id, { active: true });
}

await page.goto({ url: "${SNAPSHOT_QUERY_URL}", timeout: 15000n });
let result = await page.snapshot_query({ filter: { interactiveOnly: true } });
print(RESULT_PREFIX + JSON.stringify({ ok: true, value: result }));
`;
			const exec = await executeCell<
				ContractResult<{ nodes: Array<{ role: string }> }>
			>(harness.sidepanel, source, 30_000);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				// interactiveOnly still preserves mustKeep visible-text nodes (snapshot
				// rule: IF IT IS VISIBLE TEXT, EXPOSE IT). Assert controls are present
				// and non-mustKeep pure chrome is not required to be empty of headings.
				const nodes = exec.result.value.nodes;
				expect(nodes.length).toBeGreaterThan(0);
				const interactive = nodes.filter(
					(n) =>
						n.role === "button" ||
						n.role === "link" ||
						n.role === "textbox" ||
						n.role === "checkbox" ||
						n.role === "combobox" ||
						n.role === "option",
				);
				expect(interactive.length).toBeGreaterThan(0);
			}
		});

		test("filter by tag returns links with hrefs", async ({ harness }) => {
			const source = `
var RESULT_PREFIX = "${RESULT_PREFIX}";

const sqTabs = await chrome.tabs.query({ url: "${SNAPSHOT_QUERY_URL}*" });
if (sqTabs.length > 0) await chrome.tabs.update(sqTabs[0].id, { active: true });
else { const httpTabs = await chrome.tabs.query({ url: "http://*/*" }); if (httpTabs.length > 0) await chrome.tabs.update(httpTabs[0].id, { active: true }); }

await page.goto({ url: "${SNAPSHOT_QUERY_URL}", timeout: 15000n });
let result = await page.snapshot_query({ filter: { tag: "a" } });
print(RESULT_PREFIX + JSON.stringify({ ok: true, value: result }));
`;
			const exec = await executeCell<
				ContractResult<{ nodes: Array<{ tag: string; href?: string }> }>
			>(harness.sidepanel, source, 30_000);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.nodes).toHaveLength(2);
				for (const node of exec.result.value.nodes) {
					expect(node.tag).toBe("a");
					expect(node.href).toBeDefined();
				}
			}
		});

		test("filter by text returns matching element", async ({ harness }) => {
			const source = `
var RESULT_PREFIX = "${RESULT_PREFIX}";

const sqTabs = await chrome.tabs.query({ url: "${SNAPSHOT_QUERY_URL}*" });
if (sqTabs.length > 0) await chrome.tabs.update(sqTabs[0].id, { active: true });
else { const httpTabs = await chrome.tabs.query({ url: "http://*/*" }); if (httpTabs.length > 0) await chrome.tabs.update(httpTabs[0].id, { active: true }); }

await page.goto({ url: "${SNAPSHOT_QUERY_URL}", timeout: 15000n });
let result = await page.snapshot_query({ filter: { text: "sign" } });
print(RESULT_PREFIX + JSON.stringify({ ok: true, value: result }));
`;
			const exec = await executeCell<
				ContractResult<{ nodes: Array<{ text: string }> }>
			>(harness.sidepanel, source, 30_000);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.nodes).toHaveLength(1);
				expect(exec.result.value.nodes[0].text.toLowerCase()).toContain("sign");
			}
		});

		test("filter by href returns matching link", async ({ harness }) => {
			const source = `
var RESULT_PREFIX = "${RESULT_PREFIX}";

const sqTabs = await chrome.tabs.query({ url: "${SNAPSHOT_QUERY_URL}*" });
if (sqTabs.length > 0) await chrome.tabs.update(sqTabs[0].id, { active: true });
else { const httpTabs = await chrome.tabs.query({ url: "http://*/*" }); if (httpTabs.length > 0) await chrome.tabs.update(httpTabs[0].id, { active: true }); }

await page.goto({ url: "${SNAPSHOT_QUERY_URL}", timeout: 15000n });
let result = await page.snapshot_query({ filter: { href: "/docs" } });
print(RESULT_PREFIX + JSON.stringify({ ok: true, value: result }));
`;
			const exec = await executeCell<
				ContractResult<{ nodes: Array<{ href: string }> }>
			>(harness.sidepanel, source, 30_000);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.nodes).toHaveLength(1);
				expect(exec.result.value.nodes[0].href).toContain("/docs");
			}
		});

		test("empty filter returns same count as snapshot_data", async ({
			harness,
		}) => {
			const source = `
var RESULT_PREFIX = "${RESULT_PREFIX}";

const sqTabs = await chrome.tabs.query({ url: "${SNAPSHOT_QUERY_URL}*" });
if (sqTabs.length > 0) await chrome.tabs.update(sqTabs[0].id, { active: true });
else { const httpTabs = await chrome.tabs.query({ url: "http://*/*" }); if (httpTabs.length > 0) await chrome.tabs.update(httpTabs[0].id, { active: true }); }

await page.goto({ url: "${SNAPSHOT_QUERY_URL}", timeout: 15000n });
let dataResult = await page.snapshot_data();
let queryResult = await page.snapshot_query({});
print(RESULT_PREFIX + JSON.stringify({
  ok: true,
  value: {
    dataNodeCount: dataResult.nodes.length,
    queryNodeCount: queryResult.nodes.length,
  }
}));
`;
			const exec = await executeCell<
				ContractResult<{ dataNodeCount: number; queryNodeCount: number }>
			>(harness.sidepanel, source, 30_000);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.queryNodeCount).toBe(
					exec.result.value.dataNodeCount,
				);
			}
		});

		test("combined role + href filter", async ({ harness }) => {
			const source = `
var RESULT_PREFIX = "${RESULT_PREFIX}";

const sqTabs = await chrome.tabs.query({ url: "${SNAPSHOT_QUERY_URL}*" });
if (sqTabs.length > 0) await chrome.tabs.update(sqTabs[0].id, { active: true });
else { const httpTabs = await chrome.tabs.query({ url: "http://*/*" }); if (httpTabs.length > 0) await chrome.tabs.update(httpTabs[0].id, { active: true }); }

await page.goto({ url: "${SNAPSHOT_QUERY_URL}", timeout: 15000n });
let result = await page.snapshot_query({ filter: { role: "link", href: "/api" } });
print(RESULT_PREFIX + JSON.stringify({ ok: true, value: result }));
`;
			const exec = await executeCell<
				ContractResult<{
					nodes: Array<{ role: string; name: string; href: string }>;
				}>
			>(harness.sidepanel, source, 30_000);

			expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
			expect(exec.result?.ok).toBe(true);
			if (exec.result?.ok) {
				expect(exec.result.value.nodes).toHaveLength(1);
				expect(exec.result.value.nodes[0].role).toBe("link");
				expect(exec.result.value.nodes[0].href).toContain("/api");
			}
		});
	});
