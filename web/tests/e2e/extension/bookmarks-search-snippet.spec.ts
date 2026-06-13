import { expect, test } from "./fixtures.ts";
import { executeCell } from "./lib/harness.ts";

/** Exact sidepanel snippet reported by user — no-arg chrome.bookmarks.search(). */
const USER_BOOKMARKS_SNIPPET = `
// Test chrome.bookmarks
const bookmarks = await chrome.bookmarks.search()
console.log('Bookmarks:', bookmarks.length);
`;

test.describe
	.serial("chrome bookmarks search user snippet", () => {
		test("diagnostic: chrome.bookmarks.search is a function", async ({
			harness,
		}, testInfo) => {
			const exec = await executeCell(
				harness.sidepanel,
				`
print("typeof chrome=" + typeof chrome);
print("typeof chrome.bookmarks=" + (typeof chrome !== "undefined" ? typeof chrome.bookmarks : "no chrome"));
if (typeof chrome !== "undefined" && chrome.bookmarks) {
  print("typeof chrome.bookmarks.search=" + typeof chrome.bookmarks.search);
}
`,
				15_000,
			);
			await testInfo.attach("bookmarks-namespace-probe.txt", {
				body: `${exec.status}\n${exec.stdout}\n${exec.stderr}`,
				contentType: "text/plain",
			});
			expect(exec.status).toBe("success");
			expect(exec.stdout).toContain("typeof chrome.bookmarks.search=function");
		});

		test("runs exact no-arg chrome.bookmarks.search snippet from sidepanel", async ({
			harness,
		}, testInfo) => {
			const exec = await executeCell(
				harness.sidepanel,
				USER_BOOKMARKS_SNIPPET,
				30_000,
			);

			const diagnostic = [
				"=== status ===",
				exec.status,
				"=== stdout ===",
				exec.stdout || "(empty)",
				"=== stderr ===",
				exec.stderr || "(empty)",
			].join("\n");

			await testInfo.attach("bookmarks-snippet-diagnostic.txt", {
				body: diagnostic,
				contentType: "text/plain",
			});
			console.log(diagnostic);

			expect(
				exec.status,
				`snippet failed — see attached bookmarks-snippet-diagnostic.txt\n${diagnostic}`,
			).toBe("success");
			expect(exec.stderr, "cell should not show runtime error").toBe("");
			expect(exec.stdout, "should log bookmark count").toMatch(
				/Bookmarks:\s*\d+/,
			);
		});
	});
