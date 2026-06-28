import { expect, test } from "./fixtures.ts";
import { FIXTURE_ORIGIN, RESULT_PREFIX } from "./lib/constants.ts";
import { executeCell } from "./lib/harness.ts";
import type { ContractResult } from "./lib/types.ts";

test.describe.serial("inactive web.tab snapshot", () => {
	test.setTimeout(30_000);

	test("created inactive tab can be loaded then snapshotted by tabId", async ({
		harness,
	}) => {
		const source = `
var RESULT_PREFIX = "${RESULT_PREFIX}";
let created = null;
try {
  created = await web.tab.create({ url: "${FIXTURE_ORIGIN}/next", active: false });
  const tabId = created.tabId || created.id;
  if (typeof tabId !== "number") {
    throw new Error("created tab id missing");
  }
  const text = await web.tab.snapshot({ tabId: tabId });
  const stillInactive = created.active === false;
  print(RESULT_PREFIX + JSON.stringify({
    ok: true,
    value: {
      tabId: tabId,
      stillInactive: stillInactive,
      hasTitle: text.indexOf("Next page") >= 0,
      hasButton: text.indexOf("Click me") >= 0,
      length: text.length,
    },
  }));
} finally {
  if (created) {
    const tabId = created.tabId || created.id;
    if (typeof tabId === "number") {
      try { await web.tab.close(tabId); } catch {}
    }
  }
}
`;

		const exec = await executeCell<
			ContractResult<{
				tabId: number;
				stillInactive: boolean;
				hasTitle: boolean;
				hasButton: boolean;
				length: number;
			}>
		>(harness.sidepanel, source, 25_000);

		expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
		expect(exec.result?.ok).toBe(true);
		if (exec.result?.ok) {
			expect(exec.result.value.tabId).toBeGreaterThan(0);
			expect(exec.result.value.stillInactive).toBe(true);
			expect(exec.result.value.hasTitle).toBe(true);
			expect(exec.result.value.hasButton).toBe(true);
			expect(exec.result.value.length).toBeGreaterThan(20);
		}
	});

	test("inactive tab can opt out of create readiness and navigate explicitly", async ({
		harness,
	}) => {
		const source = `
var RESULT_PREFIX = "${RESULT_PREFIX}";
let created = null;
try {
  created = await web.tab.create({ url: "about:blank", active: false, waitForReady: false });
  const tabId = created.tabId || created.id;
  if (typeof tabId !== "number") {
    throw new Error("created tab id missing");
  }
  await web.tab.goto({ tabId: tabId, url: "${FIXTURE_ORIGIN}/next", timeout: 15000 });
  const text = await web.tab.snapshot({ tabId: tabId });
  print(RESULT_PREFIX + JSON.stringify({
    ok: true,
    value: {
      tabId: tabId,
      hasTitle: text.indexOf("Next page") >= 0,
      hasButton: text.indexOf("Click me") >= 0,
    },
  }));
} finally {
  if (created) {
    const tabId = created.tabId || created.id;
    if (typeof tabId === "number") {
      try { await web.tab.close(tabId); } catch {}
    }
  }
}
`;

		const exec = await executeCell<
			ContractResult<{
				tabId: number;
				hasTitle: boolean;
				hasButton: boolean;
			}>
		>(harness.sidepanel, source, 25_000);

		expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
		expect(exec.result?.ok).toBe(true);
		if (exec.result?.ok) {
			expect(exec.result.value.tabId).toBeGreaterThan(0);
			expect(exec.result.value.hasTitle).toBe(true);
			expect(exec.result.value.hasButton).toBe(true);
		}
	});
});
