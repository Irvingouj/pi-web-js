import { test, expect } from "./fixtures.ts";
import { executeCell } from "./lib/harness.ts";

/** Exact sidepanel snippet reported by user — reproduces tab.query + snapshot flow. */
const USER_TAB_SNIPPET = `
// Test web.tab.query
const tabs = await web.tab.query({});
console.log('Tab count:', tabs.length);
if (tabs.length > 0) {
  console.log('First tab:', tabs[0].title);

  // Test snapshot
  const snapshot = await web.tab.snapshot(tabs[0].id);
  console.log('Snapshot length:', snapshot.length);

  // Test snapshot_data
  const data = await web.tab.snapshot_data(tabs[0].id);
  console.log('Snapshot data URL:', data.url);
}
`;

test.describe.serial("tab query user snippet", () => {
	test("diagnostic: web.tab vs tab namespace", async ({ harness }, testInfo) => {
		const exec = await executeCell(
			harness.sidepanel,
			`
print("typeof web=" + typeof web);
print("typeof web.tab=" + (typeof web !== "undefined" ? typeof web.tab : "no web"));
print("typeof tab=" + typeof tab);
if (typeof web !== "undefined" && web.tab) {
  print("typeof web.tab.query=" + typeof web.tab.query);
}
if (typeof tab !== "undefined") {
  print("typeof tab.query=" + typeof tab.query);
}
`,
			15_000,
		);
		await testInfo.attach("namespace-probe.txt", {
			body: `${exec.status}\n${exec.stdout}\n${exec.stderr}`,
			contentType: "text/plain",
		});
		console.log(exec.stdout, exec.stderr);
		expect(exec.status).toBe("success");
		expect(exec.stdout).toContain("typeof web.tab.query=function");
	});

	test("runs exact web.tab.query + snapshot snippet from sidepanel", async ({
		harness,
	}, testInfo) => {
		// Persistent Chrome profile opens with a stray about:blank tab at index 0.
		// The user's snippet uses tabs[0], so close blank tabs and focus the https fixture.
		for (const page of harness.context.pages()) {
			if (
				page !== harness.fixtureTab &&
				page !== harness.sidepanel &&
				page.url() === "about:blank"
			) {
				await page.close().catch(() => {});
			}
		}
		await harness.fixtureTab.bringToFront();

		const logStart = harness.runtimeLogs.length;

		const exec = await executeCell(harness.sidepanel, USER_TAB_SNIPPET, 30_000);

		const runtimeTail = harness.runtimeLogs.slice(logStart).join("\n");
		const diagnostic = [
			"=== cell status ===",
			exec.status,
			"=== stdout ===",
			exec.stdout || "(empty)",
			"=== stderr (UI) ===",
			exec.stderr || "(empty)",
			"=== runtime logs (tail) ===",
			runtimeTail || "(none — set EXT_E2E_VERBOSE=1 for full capture)",
			"=== browser console errors ===",
			harness.browserConsoleErrors.slice(-20).join("\n") || "(none)",
		].join("\n");

		await testInfo.attach("tab-snippet-diagnostic.txt", {
			body: diagnostic,
			contentType: "text/plain",
		});

		console.log(diagnostic);

		expect(
			exec.status,
			`snippet failed — see attached tab-snippet-diagnostic.txt\n${diagnostic}`,
		).toBe("success");
		expect(exec.stderr, "cell should not show runtime error").toBe("");
		expect(exec.stdout, "should log tab count").toMatch(/Tab count:/);
		expect(exec.stdout, "first tab should be the https fixture").toMatch(
			/First tab: extension-js contract fixture/,
		);
		expect(exec.stdout, "snapshot should succeed on fixture tab").toMatch(
			/Snapshot length:/,
		);
		expect(exec.stdout, "snapshot_data should return fixture url").toMatch(
			/Snapshot data URL: https:\/\/extension-js\.test\/fixture/,
		);
	});
});
