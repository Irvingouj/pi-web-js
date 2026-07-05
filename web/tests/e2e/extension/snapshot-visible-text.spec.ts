import { expect, test } from "./fixtures.ts";
import { RESULT_PREFIX, SNAPSHOT_VISIBLE_TEXT_URL } from "./lib/constants.ts";
import { executeCell } from "./lib/harness.ts";
import type { ContractResult } from "./lib/types.ts";

function cellSource(...lines: string[]): string {
	return lines.join("\n");
}

function resultPrefixLine(): string {
	return `var RESULT_PREFIX = "${RESULT_PREFIX}";`;
}

function activateTabSource(): string {
	const tabPattern = `${SNAPSHOT_VISIBLE_TEXT_URL}*`;
	return cellSource(
		`let tabs = await chrome.tabs.query({ url: ${JSON.stringify(tabPattern)} });`,
		"if (tabs.length === 0) {",
		'  throw new Error("snapshot-visible-text tab not found");',
		"}",
		"await chrome.tabs.update(tabs[0].id, { active: true });",
		`await page.goto(${JSON.stringify(SNAPSHOT_VISIBLE_TEXT_URL)});`,
	);
}

type VisibleTextResult = {
	ok: boolean;
	missing: string[];
	hiddenLeaks: string[];
	mustKeepMissing: string[];
	queryHasOttawa: boolean;
	queryHasNested: boolean;
	domHasAllVisible: boolean;
	domHasMustKeep: boolean;
	findHasOttawa: boolean;
	tabSnapshotHasOttawa: boolean;
};

test.describe.serial("snapshot visible text invariant", () => {
	test.beforeEach(async ({ harness }) => {
		await harness.fixtureTab.goto(SNAPSHOT_VISIBLE_TEXT_URL, {
			waitUntil: "domcontentloaded",
		});
		await harness.fixtureTab.bringToFront();
	});

	test("visible text is mustKeep across page and tab snapshot/dom surfaces", async ({
		harness,
	}) => {
		const exec = await executeCell<ContractResult<VisibleTextResult>>(
			harness.sidepanel,
			cellSource(
				resultPrefixLine(),
				activateTabSource(),
				"const visible = [",
				'  "E2E_VISIBLE_OTTAWA_SELECTED_TEXT",',
				'  "E2E_VISIBLE_NESTED_STRUCTURAL_TEXT",',
				'  "E2E_VISIBLE_MAIN_SECTION_TEXT",',
				'  "E2E_VISIBLE_LABEL_TEXT",',
				'  "E2E_VISIBLE_LIST_ITEM_TEXT",',
				'  "E2E_VISIBLE_TABLE_CELL_TEXT",',
				'  "E2E_VISIBLE_PRESENTATION_TEXT",',
				'  "E2E_VISIBLE_NONE_ROLE_TEXT",',
				'  "E2E_VISIBLE_STATUS_TEXT",',
				'  "E2E_VISIBLE_ALERT_TEXT",',
				'  "E2E_VISIBLE_SUMMARY_TEXT",',
				'  "E2E_VISIBLE_DETAILS_TEXT",',
				'  "E2E_VISIBLE_SVG_TEXT",',
				"];",
				"const hidden = [",
				'  "E2E_HIDDEN_DISPLAY_NONE_TEXT",',
				'  "E2E_HIDDEN_ARIA_TEXT",',
				'  "E2E_HIDDEN_ATTR_TEXT",',
				'  "E2E_HIDDEN_VISIBILITY_TEXT",',
				"];",
				"const text = await page.snapshot({ max_nodes: 1 });",
				"const data = await page.snapshot_data({ max_nodes: 1 });",
				"const query = await page.snapshot_query({ filter: { interactiveOnly: true, limit: 1 }, max_nodes: 1 });",
				"const dom = await page.dom({ selector: '#snapshot-visible-root', depth: 8, includeHidden: false });",
				"const found = await page.find({ selector: '.react-select__single-value' });",
				"const tabs2 = await chrome.tabs.query({ url: " +
					JSON.stringify(`${SNAPSHOT_VISIBLE_TEXT_URL}*`) +
					" });",
				"const tabData = await web.tab.snapshot_data({ tabId: tabs2[0].id, max_nodes: 1 });",
				"const combinedText = [text, data.text, tabData.text].join('\\n');",
				"const serializedDom = JSON.stringify(dom);",
				"const missing = visible.filter(s => !combinedText.includes(s));",
				"const hiddenLeaks = hidden.filter(s => combinedText.includes(s) || serializedDom.includes(s));",
				"const mustKeepMissing = visible.filter(s => !data.nodes.some(n => n.mustKeep === true && String(n.text || '').includes(s)));",
				"const queryHasOttawa = query.nodes.some(n => n.mustKeep === true && String(n.text || '').includes('E2E_VISIBLE_OTTAWA_SELECTED_TEXT'));",
				"const queryHasNested = query.nodes.some(n => n.mustKeep === true && String(n.text || '').includes('E2E_VISIBLE_NESTED_STRUCTURAL_TEXT'));",
				"const domHasAllVisible = visible.every(s => serializedDom.includes(s));",
				"const domHasMustKeep = serializedDom.includes('\"mustKeep\":true');",
				"const findHasOttawa = found.length > 0 && String(found[0].text || '').includes('E2E_VISIBLE_OTTAWA_SELECTED_TEXT');",
				"const tabSnapshotHasOttawa = tabData.nodes.some(n => n.mustKeep === true && String(n.text || '').includes('E2E_VISIBLE_OTTAWA_SELECTED_TEXT'));",
				"const ok = missing.length === 0 && hiddenLeaks.length === 0 && mustKeepMissing.length === 0 && queryHasOttawa && queryHasNested && domHasAllVisible && domHasMustKeep && findHasOttawa && tabSnapshotHasOttawa;",
				"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { ok, missing, hiddenLeaks, mustKeepMissing, queryHasOttawa, queryHasNested, domHasAllVisible, domHasMustKeep, findHasOttawa, tabSnapshotHasOttawa } }));",
			),
			30_000,
		);

		expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
		expect(exec.result?.ok).toBe(true);
		if (exec.result?.ok) {
			expect(exec.result.value).toMatchObject({
				ok: true,
				missing: [],
				hiddenLeaks: [],
				mustKeepMissing: [],
				queryHasOttawa: true,
				queryHasNested: true,
				domHasAllVisible: true,
				domHasMustKeep: true,
				findHasOttawa: true,
				tabSnapshotHasOttawa: true,
			});
		}
	});
});
