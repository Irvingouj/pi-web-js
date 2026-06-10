import { test, expect } from "./fixtures.ts";
import { executeCell } from "./lib/harness.ts";
import { RESULT_PREFIX, DYNAMIC_FEED_URL } from "./lib/constants.ts";
import type { ContractResult } from "./lib/types.ts";

function cellSource(...lines: string[]): string {
	return lines.join("\n");
}

function resultPrefixLine(): string {
	return `var RESULT_PREFIX = "${RESULT_PREFIX}";`;
}

function activateFeedTabSource(): string {
	const tabPattern = `${DYNAMIC_FEED_URL}*`;
	return cellSource(
		`let feedTabs = await chrome.tabs.query({ url: ${JSON.stringify(tabPattern)} });`,
		"if (feedTabs.length === 0) {",
		'  throw new Error("dynamic-feed tab not found");',
		"}",
		"await chrome.tabs.update(feedTabs[0].id, { active: true });",
		`await page.goto(${JSON.stringify(DYNAMIC_FEED_URL)});`,
	);
}

test.describe.serial("dynamic-feed observation (AC-1)", () => {
	test.beforeEach(async ({ harness }) => {
		await harness.fixtureTab.goto(DYNAMIC_FEED_URL, {
			waitUntil: "domcontentloaded",
		});
		await harness.fixtureTab.bringToFront();
	});

	test("T-004: find articles and verify structure", async ({ harness }) => {
		const exec = await executeCell<
			ContractResult<{
				articleCount: number;
				allHaveRefId: boolean;
				allHavePermalink: boolean;
				imageCount: number;
				allImagesHaveSrc: boolean;
				allImagesHaveAlt: boolean;
				allImagesHaveParentRefId: boolean;
				firstImageParentMatchesArticle: boolean;
			}>
		>(
			harness.sidepanel,
			cellSource(
				resultPrefixLine(),
				activateFeedTabSource(),
			"const articles = await page.find('article');",
			"const articleLinks = await page.find('article h2 a');",
			"const images = await page.find('img');",
			"let allHaveRefId = true;",
			"let allHavePermalink = true;",
			"for (const article of articles) {",
			"  if (!article.refId) allHaveRefId = false;",
			"}",
			"for (const link of articleLinks) {",
			"  if (!link.href) allHavePermalink = false;",
			"}",
				"let allImagesHaveSrc = true;",
				"let allImagesHaveAlt = true;",
				"let allImagesHaveParentRefId = true;",
				"for (const img of images) {",
				"  if (!img.src) allImagesHaveSrc = false;",
				"  if (!img.alt) allImagesHaveAlt = false;",
				"  if (!img.parentRefId) allImagesHaveParentRefId = false;",
				"}",
				"const firstArticleRefId = articles[0]?.refId;",
				"const firstImageParentMatchesArticle = images.length > 0 && images[0].parentRefId === firstArticleRefId;",
				"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: {",
				"  articleCount: articles.length,",
				"  allHaveRefId: allHaveRefId,",
				"  allHavePermalink: allHavePermalink,",
				"  imageCount: images.length,",
				"  allImagesHaveSrc: allImagesHaveSrc,",
				"  allImagesHaveAlt: allImagesHaveAlt,",
				"  allImagesHaveParentRefId: allImagesHaveParentRefId,",
				"  firstImageParentMatchesArticle: firstImageParentMatchesArticle",
				"} }));",
			),
			20_000,
		);

		expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
		expect(exec.result?.ok).toBe(true);
		if (exec.result?.ok) {
			expect(exec.result.value.articleCount).toBeGreaterThanOrEqual(10);
			expect(exec.result.value.allHaveRefId).toBe(true);
			expect(exec.result.value.allHavePermalink).toBe(true);
			expect(exec.result.value.imageCount).toBeGreaterThanOrEqual(10);
			expect(exec.result.value.allImagesHaveSrc).toBe(true);
			expect(exec.result.value.allImagesHaveAlt).toBe(true);
			expect(exec.result.value.allImagesHaveParentRefId).toBe(true);
			expect(exec.result.value.firstImageParentMatchesArticle).toBe(true);
		}
	});

	test("T-004: snapshot_data includes articles with images", async ({ harness }) => {
		const exec = await executeCell<
			ContractResult<{
				articleCount: number;
				imageCount: number;
				allImagesAbsoluteSrc: boolean;
				allImagesHaveParentRefId: boolean;
				canClickArticle: boolean;
			}>
		>(
			harness.sidepanel,
			cellSource(
				resultPrefixLine(),
				activateFeedTabSource(),
				"const data = await page.snapshot_data();",
				"const articles = [];",
				"const images = [];",
				"for (const node of data.nodes) {",
				"  if (node.tag === 'article') articles.push(node);",
				"  if (node.tag === 'img') images.push(node);",
				"}",
				"let allImagesAbsoluteSrc = true;",
				"let allImagesHaveParentRefId = true;",
				"for (const img of images) {",
				"  if (!img.src || !img.src.startsWith('http')) allImagesAbsoluteSrc = false;",
				"  if (!img.parentRefId) allImagesHaveParentRefId = false;",
				"}",
				"let canClickArticle = false;",
				"if (articles.length > 0 && articles[0].refId) {",
				"  try {",
				"    await page.click({ refId: articles[0].refId });",
				"    canClickArticle = true;",
				"  } catch (e) {",
				"    canClickArticle = false;",
				"  }",
				"}",
				"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: {",
				"  articleCount: articles.length,",
				"  imageCount: images.length,",
				"  allImagesAbsoluteSrc: allImagesAbsoluteSrc,",
				"  allImagesHaveParentRefId: allImagesHaveParentRefId,",
				"  canClickArticle: canClickArticle",
				"} }));",
			),
			20_000,
		);

		expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
		expect(exec.result?.ok).toBe(true);
		if (exec.result?.ok) {
			expect(exec.result.value.articleCount).toBeGreaterThanOrEqual(10);
			expect(exec.result.value.imageCount).toBeGreaterThanOrEqual(10);
			expect(exec.result.value.allImagesAbsoluteSrc).toBe(true);
			expect(exec.result.value.allImagesHaveParentRefId).toBe(true);
			expect(exec.result.value.canClickArticle).toBe(true);
		}
	});

	test("T-004: image src is absolute and alt is present", async ({ harness }) => {
		const exec = await executeCell<
			ContractResult<{
				firstImgSrc: string;
				firstImgAlt: string;
				firstImgParentRefId: string;
				firstArticleHref: string;
			}>
		>(
			harness.sidepanel,
			cellSource(
				resultPrefixLine(),
				activateFeedTabSource(),
			"const images = await page.find('img');",
			"const articleLinks = await page.find('article h2 a');",
			"const firstImg = images[0];",
			"const firstArticleLink = articleLinks[0];",
			"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: {",
			"  firstImgSrc: firstImg ? firstImg.src : '',",
			"  firstImgAlt: firstImg ? firstImg.alt : '',",
			"  firstImgParentRefId: firstImg ? firstImg.parentRefId : '',",
			"  firstArticleHref: firstArticleLink ? firstArticleLink.href : ''",
			"} }));",
			),
			20_000,
		);

		expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
		expect(exec.result?.ok).toBe(true);
		if (exec.result?.ok) {
			expect(exec.result.value.firstImgSrc).toMatch(/^http/);
			expect(exec.result.value.firstImgAlt).not.toBe("");
			expect(exec.result.value.firstImgParentRefId).toMatch(/^e\d+$/);
			expect(exec.result.value.firstArticleHref).toMatch(/^http/);
		}
	});

	test("T-021: continuity after scroll and rerender", async ({ harness }) => {
		const exec1 = await executeCell<
			ContractResult<{
				postIds: string[];
				permalinks: string[];
				imageUrls: string[][];
			}>
		>(
			harness.sidepanel,
			cellSource(
				resultPrefixLine(),
				activateFeedTabSource(),
				"const data = await page.snapshot_data();",
				"const articles = data.nodes.filter(n => n.tag === 'article');",
				"const postIds = articles.map(a => a.postId).filter(Boolean);",
				"const permalinks = articles.map(a => a.permalink).filter(Boolean);",
				"const imageUrls = articles.map(a => a.imageUrls).filter(Boolean);",
				"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { postIds, permalinks, imageUrls } }));"
			),
			20_000,
		);

		expect(exec1.status, `${exec1.stderr}\n${exec1.stdout}`).toBe("success");
		expect(exec1.result?.ok).toBe(true);
		if (!exec1.result?.ok) return;

		const beforePostIds = exec1.result.value.postIds;
		const beforePermalinks = exec1.result.value.permalinks;
		const beforeImageUrls = exec1.result.value.imageUrls;

		expect(beforePostIds.length).toBeGreaterThanOrEqual(10);
		expect(beforePermalinks.length).toBeGreaterThanOrEqual(10);
		expect(beforeImageUrls.length).toBeGreaterThanOrEqual(10);

		// Trigger rerender in fixture tab
		await harness.fixtureTab.locator("#rerender-btn").click();
		await harness.fixtureTab.waitForSelector("[data-rerender-complete='true']");

		const exec2 = await executeCell<
			ContractResult<{
				postIds: string[];
				permalinks: string[];
				imageUrls: string[][];
			}>
		>(
			harness.sidepanel,
			cellSource(
				resultPrefixLine(),
				activateFeedTabSource(),
				"const data = await page.snapshot_data();",
				"const articles = data.nodes.filter(n => n.tag === 'article');",
				"const postIds = articles.map(a => a.postId).filter(Boolean);",
				"const permalinks = articles.map(a => a.permalink).filter(Boolean);",
				"const imageUrls = articles.map(a => a.imageUrls).filter(Boolean);",
				"print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { postIds, permalinks, imageUrls } }));"
			),
			20_000,
		);

		expect(exec2.status, `${exec2.stderr}\n${exec2.stdout}`).toBe("success");
		expect(exec2.result?.ok).toBe(true);
		if (!exec2.result?.ok) return;

		const afterPostIds = exec2.result.value.postIds;
		const afterPermalinks = exec2.result.value.permalinks;
		const afterImageUrls = exec2.result.value.imageUrls;

		expect(afterPostIds.sort()).toEqual(beforePostIds.sort());
		expect(afterPermalinks.sort()).toEqual(beforePermalinks.sort());
		expect(afterImageUrls.length).toBeGreaterThanOrEqual(10);
	});
});
