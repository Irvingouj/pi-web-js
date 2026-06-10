import { test, expect } from "./fixtures.ts";
import { executeCell } from "./lib/harness.ts";
import { RESULT_PREFIX, SIMPLE_FORM_1_URL } from "./lib/constants.ts";
import { parseAllSentinels } from "./lib/sentinels.ts";
import type { ContractResult } from "./lib/types.ts";

async function readRuntimeApiDocs(
	sidepanel: Parameters<typeof executeCell>[0],
): Promise<Array<{
	action: string;
	public_name: string;
	params: Array<{ name: string; type?: string; required: boolean; description: string }>;
	returns: { type?: string; description: string };
	example?: string;
}>> {
	const exec = await executeCell<ContractResult<{ count: number; docs: unknown[] }>>(
		sidepanel,
		`
var RESULT_PREFIX = "${RESULT_PREFIX}";
if (typeof runtime.apiDocs !== "function") {
  print(RESULT_PREFIX + JSON.stringify({ ok: false, error: { message: "runtime.apiDocs is not defined", code: "E_MISSING_API" } }));
} else {
  const docs = runtime.apiDocs("json");
  print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { count: docs.length, docs } }));
}
`,
		20_000,
	);

	expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
	const parsed = parseAllSentinels(exec.stdout)[0];
	expect(parsed?.ok, exec.stdout).toBe(true);
	if (!parsed?.ok) {
		throw new Error("runtime.apiDocs sentinel missing");
	}
	const payload = parsed.value as { count: number; docs: unknown[] };
	expect(Array.isArray(payload.docs)).toBe(true);
	return payload.docs as Array<{
		action: string;
		public_name: string;
		params: Array<{ name: string; type?: string; required: boolean; description: string }>;
		returns: { type?: string; description: string };
		example?: string;
	}>;
}

const BANNED_TYPES = new Set(["unknown", "undefined", "any", "object", "lazy", "void", "record"]);

const AC_USED_APIS = [
	{ action: "page_find", publicName: "page.find", example: 'page.find("h1")' },
	{ action: "page_snapshot", publicName: "page.snapshot", example: "page.snapshot()" },
	{ action: "page_snapshot_data", publicName: "page.snapshot_data", example: "page.snapshot_data()" },
	{ action: "page_fetch", publicName: "page.fetch", example: 'page.fetch({ url: "https://api.example.com/data" })' },
	{ action: "fs_write_base64", publicName: "fs.writeBase64", example: 'fs.writeBase64({ path: "/tmp/contract-test.txt", data: "SGVsbG8gV29ybGQh" })' },
	{ action: "fs_stat", publicName: "fs.stat", example: 'fs.stat({ path: "/tmp/contract-test.txt" })' },
	{ action: "fs_hash", publicName: "fs.hash", example: 'fs.hash({ path: "/tmp/contract-test.txt", algo: "sha256" })' },
	{ action: "page_health", publicName: "page.health", example: "page.health()" },
	{ action: "page_goto", publicName: "page.goto", example: 'page.goto("https://example.com")' },
	{ action: "page_click", publicName: "page.click", example: 'page.click({ refId: "e2" })' },
	{ action: "page_fill", publicName: "page.fill", example: 'page.fill({ refId: "e2", value: "hello" })' },
];

test.describe.serial("T-020: AC-6 documentation contract", () => {
	test.setTimeout(60_000);

	test("docs for AC-used APIs have no banned types", async ({ harness }) => {
		const docs = await readRuntimeApiDocs(harness.sidepanel);
		const violations: string[] = [];

		for (const api of AC_USED_APIS) {
			const doc = docs.find((d) => d.action === api.action);
			if (!doc) {
				violations.push(`${api.publicName}: missing from docs`);
				continue;
			}

			const returnsType = doc.returns.type ?? "";
			if (BANNED_TYPES.has(returnsType)) {
				violations.push(`${api.publicName} returnsDoc.type="${returnsType}"`);
			}

			for (const param of doc.params) {
				const paramType = param.type ?? "";
				if (BANNED_TYPES.has(paramType)) {
					violations.push(`${api.publicName} paramsDoc[${param.name}].type="${paramType}"`);
				}
			}
		}

		expect(violations, `Banned-type violations:\n${violations.join("\n")}`).toEqual([]);
	});

	test("page.health example runs unchanged", async ({ harness }) => {
		const exec = await executeCell<ContractResult<unknown>>(
			harness.sidepanel,
			`
var RESULT_PREFIX = "${RESULT_PREFIX}";
try {
  const result = await page.health();
  print(RESULT_PREFIX + JSON.stringify({ ok: true, value: result }));
} catch (e) {
  print(RESULT_PREFIX + JSON.stringify({ ok: false, error: { message: e.message, code: "E_HEALTH" } }));
}
`,
			15_000,
		);
		expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
		const parsed = parseAllSentinels(exec.stdout)[0];
		expect(parsed?.ok).toBe(true);
	});

	test("page.goto example runs unchanged", async ({ harness }) => {
		await harness.fixtureTab.goto(SIMPLE_FORM_1_URL, { waitUntil: "domcontentloaded" });
		await harness.fixtureTab.bringToFront();

		const tabPattern = `${SIMPLE_FORM_1_URL}*`;
		const exec = await executeCell<ContractResult<unknown>>(
			harness.sidepanel,
			`
var RESULT_PREFIX = "${RESULT_PREFIX}";
const tabPattern = ${JSON.stringify(tabPattern)};
(async () => {
  try {
    let formTabs = await chrome.tabs.query({ url: tabPattern });
    if (formTabs.length === 0) {
      throw new Error("simple-form tab not found");
    }
    await chrome.tabs.update(formTabs[0].id, { active: true });
    const result = await page.goto("${SIMPLE_FORM_1_URL}");
    print(RESULT_PREFIX + JSON.stringify({ ok: true, value: result }));
  } catch (e) {
    print(RESULT_PREFIX + JSON.stringify({ ok: false, error: { message: e.message, code: "E_GOTO" } }));
  }
})();
`,
			20_000,
		);
		expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
		const parsed = parseAllSentinels(exec.stdout)[0];
		expect(parsed?.ok).toBe(true);
	});

	test("page.find / snapshot / snapshot_data examples run unchanged", async ({ harness }) => {
		await harness.fixtureTab.goto(SIMPLE_FORM_1_URL, { waitUntil: "domcontentloaded" });
		await harness.fixtureTab.bringToFront();

		const tabPattern = `${SIMPLE_FORM_1_URL}*`;
		const exec = await executeCell<ContractResult<{ find: unknown; snapshot: unknown; snapshotData: unknown }>>(
			harness.sidepanel,
			`
var RESULT_PREFIX = "${RESULT_PREFIX}";
const tabPattern = ${JSON.stringify(tabPattern)};
(async () => {
  try {
    let formTabs = await chrome.tabs.query({ url: tabPattern });
    if (formTabs.length === 0) {
      throw new Error("simple-form tab not found");
    }
    await chrome.tabs.update(formTabs[0].id, { active: true });
    const find = await page.find("h1");
    const snapshot = await page.snapshot();
    const snapshotData = await page.snapshot_data();
    print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { find, snapshot, snapshotData } }));
  } catch (e) {
    print(RESULT_PREFIX + JSON.stringify({ ok: false, error: { message: e.message, code: "E_SNAPSHOT" } }));
  }
})();
`,
			15_000,
		);
		expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
		const parsed = parseAllSentinels(exec.stdout)[0];
		expect(parsed, `No sentinel in stdout: ${exec.stdout}`).toBeDefined();
		expect(parsed?.ok, `Cell returned error: ${JSON.stringify(parsed)}`).toBe(true);
		if (!parsed?.ok) return;
		const value = parsed.value as { find: unknown; snapshot: unknown; snapshotData: unknown };
		expect(Array.isArray(value.find)).toBe(true);
		expect(typeof value.snapshot).toBe("string");
		expect(value.snapshotData).toHaveProperty("nodes");
		expect(value.snapshotData).toHaveProperty("text");
	});

	test("page.fetch example runs unchanged", async ({ harness }) => {
		await harness.fixtureTab.goto(SIMPLE_FORM_1_URL, { waitUntil: "domcontentloaded" });
		await harness.fixtureTab.bringToFront();

		const tabPattern = `${SIMPLE_FORM_1_URL}*`;
		const exec = await executeCell<ContractResult<unknown>>(
			harness.sidepanel,
			`
var RESULT_PREFIX = "${RESULT_PREFIX}";
const tabPattern = ${JSON.stringify(tabPattern)};
(async () => {
  try {
    let formTabs = await chrome.tabs.query({ url: tabPattern });
    if (formTabs.length === 0) {
      throw new Error("simple-form tab not found");
    }
    await chrome.tabs.update(formTabs[0].id, { active: true });
    const result = await page.fetch({ url: "${SIMPLE_FORM_1_URL}" });
    print(RESULT_PREFIX + JSON.stringify({ ok: true, value: result }));
  } catch (e) {
    print(RESULT_PREFIX + JSON.stringify({ ok: false, error: { message: e.message, code: "E_FETCH" } }));
  }
})();
`,
			15_000,
		);
		expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
		const parsed = parseAllSentinels(exec.stdout)[0];
		expect(parsed?.ok).toBe(true);
		if (!parsed?.ok) return;
		const value = parsed.value as Record<string, unknown>;
		expect(value).toHaveProperty("status");
		expect(value).toHaveProperty("ok");
		expect(value).toHaveProperty("body");
		expect(value).toHaveProperty("bodyEncoding");
	});

	test("page.click / page.fill examples run unchanged", async ({ harness }) => {
		await harness.fixtureTab.goto(SIMPLE_FORM_1_URL, { waitUntil: "domcontentloaded" });
		await harness.fixtureTab.bringToFront();

		const tabPattern = `${SIMPLE_FORM_1_URL}*`;
		const exec = await executeCell<ContractResult<{ fill: unknown; click: unknown }>>(
			harness.sidepanel,
			`
var RESULT_PREFIX = "${RESULT_PREFIX}";
const tabPattern = ${JSON.stringify(tabPattern)};
(async () => {
  try {
    let formTabs = await chrome.tabs.query({ url: tabPattern });
    if (formTabs.length === 0) {
      throw new Error("simple-form tab not found");
    }
    await chrome.tabs.update(formTabs[0].id, { active: true });
    const data = await page.snapshot_data();
    let inputRefId = null;
    let buttonRefId = null;
    for (let i = 0; i < data.nodes.length; i++) {
      if (data.nodes[i].tag === "input") inputRefId = data.nodes[i].refId;
      if (data.nodes[i].tag === "button") buttonRefId = data.nodes[i].refId;
    }
    if (!inputRefId || !buttonRefId) {
      throw new Error("Missing refIds: input=" + inputRefId + " button=" + buttonRefId);
    }
    const fill = await page.fill({ refId: inputRefId, value: "Alice" });
    const click = await page.click({ refId: buttonRefId });
    print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { fill, click } }));
  } catch (e) {
    print(RESULT_PREFIX + JSON.stringify({ ok: false, error: { message: e.message, code: "E_MUTATION" } }));
  }
})();
`,
			15_000,
		);
		expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
		const parsed = parseAllSentinels(exec.stdout)[0];
		expect(parsed?.ok).toBe(true);
		if (!parsed?.ok) return;
		const value = parsed.value as { fill: unknown; click: unknown };
		expect(value.fill).toHaveProperty("ok");
		expect(value.click).toHaveProperty("ok");
	});

	test("fs.writeBase64 / fs.stat / fs.hash examples run unchanged", async ({ harness }) => {
		const exec = await executeCell<ContractResult<{ write: unknown; stat: unknown; hash: unknown }>>(
			harness.sidepanel,
			`
var RESULT_PREFIX = "${RESULT_PREFIX}";
const testPath = "/tmp/contract-test.txt";
const testData = "SGVsbG8gV29ybGQh";

try {
  const write = await fs.writeBase64({ path: testPath, data: testData });
  const stat = await fs.stat({ path: testPath });
  const hash = await fs.hash({ path: testPath, algo: "sha256" });
  await fs.delete(testPath);
  print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { write, stat, hash } }));
} catch (e) {
  print(RESULT_PREFIX + JSON.stringify({ ok: false, error: { message: e.message, code: "E_FS" } }));
}
`,
			15_000,
		);
		expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
		const parsed = parseAllSentinels(exec.stdout)[0];
		expect(parsed?.ok).toBe(true);
		if (!parsed?.ok) return;
		const value = parsed.value as { write: unknown; stat: unknown; hash: unknown };

		expect(value.write).toHaveProperty("path");
		expect(value.write).toHaveProperty("bytes_written");

		expect(value.stat).toHaveProperty("path");
		expect(value.stat).toHaveProperty("name");
		expect(value.stat).toHaveProperty("kind");
		expect(value.stat).toHaveProperty("size");

		expect(typeof value.hash).toBe("string");
		expect((value.hash as string).length).toBeGreaterThan(0);
	});
});
