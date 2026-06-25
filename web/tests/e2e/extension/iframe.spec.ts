import { expect, test } from "./fixtures.ts";
import {
	IFRAME_CROSS_ORIGIN_URL,
	IFRAME_OAUTH_MOCK_URL,
	IFRAME_SIMPLE_URL,
} from "./lib/constants.ts";
import { executeCell } from "./lib/harness.ts";

function snap(url: string, extra?: string): string {
	const lines = [
		`let tabs=await chrome.tabs.query({});`,
		`let t=tabs.find(x=>(x.url||'').startsWith(${JSON.stringify(url)}));`,
		`if(!t)throw new Error('no tab for '+${JSON.stringify(url)});`,
		`await chrome.tabs.update(t.id,{active:true});`,
		`await web.sleep(300);`,
		`await page.url();`,
	];
	if (extra) lines.push(extra);
	lines.push(`await page.goto(${JSON.stringify(url)});`);
	lines.push(`let d=await page.snapshot_data();print(d.text);`);
	return lines.join("\n");
}

function snapAgain(url: string): string {
	return [
		`let tabs=await chrome.tabs.query({});`,
		`let t=tabs.find(x=>(x.url||'').startsWith(${JSON.stringify(url)}));`,
		`if(!t)throw new Error('no tab');`,
		`await chrome.tabs.update(t.id,{active:true});`,
		`await web.sleep(300);`,
		`let d=await page.snapshot_data();print(d.text);`,
	].join("\n");
}

function act(url: string, code: string): string {
	return [
		`let tabs=await chrome.tabs.query({});`,
		`let t=tabs.find(x=>(x.url||'').startsWith(${JSON.stringify(url)}));`,
		`if(!t)throw new Error('no tab');`,
		`await chrome.tabs.update(t.id,{active:true});`,
		`await web.sleep(300);`,
		code,
	].join("\n");
}

// ─── same-origin ─────────────────────────────────────────────────

test("iframe-simple: snapshot includes both frames", async ({ harness }) => {
	await harness.fixtureTab.goto(IFRAME_SIMPLE_URL, {
		waitUntil: "domcontentloaded",
	});
	await harness.fixtureTab.bringToFront();
	await harness.fixtureTab.waitForTimeout(2000);
	const e = await executeCell(
		harness.sidepanel,
		snap(IFRAME_SIMPLE_URL),
		20000,
	);
	expect(e.status, e.stderr).toBe("success");
	expect(e.stdout).toContain("Parent Page");
	expect(e.stdout).toContain("Iframe Content");
	expect(e.stdout).toMatch(/Frame \d/);
});

test("iframe-simple: refIds unique", async ({ harness }) => {
	await harness.fixtureTab.goto(IFRAME_SIMPLE_URL, {
		waitUntil: "domcontentloaded",
	});
	await harness.fixtureTab.bringToFront();
	await harness.fixtureTab.waitForTimeout(1500);
	const e = await executeCell(
		harness.sidepanel,
		snap(IFRAME_SIMPLE_URL),
		20000,
	);
	expect(e.status, e.stderr).toBe("success");
	const ids = [...e.stdout.matchAll(/\[(f?\d+_?e\d+)\]/g)].map((m) => m[1]);
	expect(ids.length).toBeGreaterThan(0);
	expect(new Set(ids).size).toBe(ids.length);
	expect(ids.filter((r) => r.startsWith("f")).length).toBeGreaterThan(0);
});

test("iframe-simple: click iframe button", async ({ harness }) => {
	await harness.fixtureTab.goto(IFRAME_SIMPLE_URL, {
		waitUntil: "domcontentloaded",
	});
	await harness.fixtureTab.bringToFront();
	await harness.fixtureTab.waitForTimeout(1500);
	const s = await executeCell(
		harness.sidepanel,
		snap(IFRAME_SIMPLE_URL),
		20000,
	);
	expect(s.status, s.stderr).toBe("success");
	const m = s.stdout.match(/Click in iframe[^\n]*\[(f?\d+_?e\d+)\]/);
	expect(m, `btn:\n${s.stdout.slice(0, 600)}`).toBeTruthy();
	const c = await executeCell(
		harness.sidepanel,
		act(IFRAME_SIMPLE_URL, `await page.click({refId:"${m![1]}"});`),
	);
	expect(c.status, c.stderr).toBe("success");
	const v = await executeCell(harness.sidepanel, snapAgain(IFRAME_SIMPLE_URL));
	expect(v.stdout).toMatch(/clicked|filled/);
});

test("iframe-simple: fill iframe input", async ({ harness }) => {
	await harness.fixtureTab.goto(IFRAME_SIMPLE_URL, {
		waitUntil: "domcontentloaded",
	});
	await harness.fixtureTab.bringToFront();
	await harness.fixtureTab.waitForTimeout(1500);
	const s = await executeCell(
		harness.sidepanel,
		snap(IFRAME_SIMPLE_URL),
		20000,
	);
	expect(s.status, s.stderr).toBe("success");
	const im = s.stdout.match(/textbox\s*\[(f\d+_e\d+)\]/);
	expect(im, `inp:\n${s.stdout.slice(0, 600)}`).toBeTruthy();
	await executeCell(
		harness.sidepanel,
		act(
			IFRAME_SIMPLE_URL,
			`await page.fill({refId:"${im![1]}",value:"hello-iframe"});`,
		),
	);
	const s2 = await executeCell(harness.sidepanel, snapAgain(IFRAME_SIMPLE_URL));
	const bm = s2.stdout.match(/Click in iframe[^\n]*\[(f\d+_e\d+)\]/);
	expect(bm, "btn2").toBeTruthy();
	await executeCell(
		harness.sidepanel,
		act(IFRAME_SIMPLE_URL, `await page.click({refId:"${bm![1]}"});`),
	);
	const v = await executeCell(harness.sidepanel, snapAgain(IFRAME_SIMPLE_URL));
	expect(v.stdout).toContain("filled:hello-iframe");
});

// ─── cross-origin ───────────────────────────────────────────────

test("iframe-cross-origin: appears in snapshot", async ({ harness }) => {
	await harness.fixtureTab.goto(IFRAME_CROSS_ORIGIN_URL, {
		waitUntil: "domcontentloaded",
	});
	await harness.fixtureTab.bringToFront();
	await harness.fixtureTab.waitForTimeout(2000);
	const e = await executeCell(
		harness.sidepanel,
		snap(IFRAME_CROSS_ORIGIN_URL),
		20000,
	);
	expect(e.status, e.stderr).toBe("success");
	expect(e.stdout).toContain("Cross-Origin Parent");
	expect(e.stdout).toContain("Click XO Button");
	expect(e.stdout).toMatch(/Frame \d/);
});

test("iframe-cross-origin: click works", async ({ harness }) => {
	await harness.fixtureTab.goto(IFRAME_CROSS_ORIGIN_URL, {
		waitUntil: "domcontentloaded",
	});
	await harness.fixtureTab.bringToFront();
	await harness.fixtureTab.waitForTimeout(2000);
	const s = await executeCell(
		harness.sidepanel,
		snap(IFRAME_CROSS_ORIGIN_URL),
		20000,
	);
	expect(s.status, s.stderr).toBe("success");
	const m = s.stdout.match(/Click XO Button[^\n]*\[(f\d+_e\d+)\]/);
	expect(m, `btn:\n${s.stdout.slice(0, 600)}`).toBeTruthy();
	const c = await executeCell(
		harness.sidepanel,
		act(IFRAME_CROSS_ORIGIN_URL, `await page.click({refId:"${m![1]}"});`),
	);
	expect(c.status, c.stderr).toBe("success");
	const v = await executeCell(
		harness.sidepanel,
		snapAgain(IFRAME_CROSS_ORIGIN_URL),
	);
	expect(v.stdout).toContain("xo-clicked");
});

// ─── OAuth mock ──────────────────────────────────────────────────

test("iframe-oauth: full flow", async ({ harness }) => {
	await harness.fixtureTab.goto(IFRAME_OAUTH_MOCK_URL, {
		waitUntil: "domcontentloaded",
	});
	await harness.fixtureTab.bringToFront();
	await harness.fixtureTab.waitForTimeout(2000);
	const s1 = await executeCell(
		harness.sidepanel,
		snap(IFRAME_OAUTH_MOCK_URL),
		20000,
	);
	expect(s1.status, s1.stderr).toBe("success");
	const lm = s1.stdout.match(/Login with Google[^\n]*\[(e\d+)\]/);
	expect(lm, `login:\n${s1.stdout.slice(0, 500)}`).toBeTruthy();
	await executeCell(
		harness.sidepanel,
		act(IFRAME_OAUTH_MOCK_URL, `await page.click({refId:"${lm![1]}"});`),
	);

	await harness.fixtureTab.waitForTimeout(500);
	const s2 = await executeCell(
		harness.sidepanel,
		snapAgain(IFRAME_OAUTH_MOCK_URL),
		20000,
	);
	expect(s2.status, s2.stderr).toBe("success");
	expect(s2.stdout).toContain("Sign in with Google");

	const am = s2.stdout.match(/alice@gmail\.com[^\n]*\[(f\d+_e\d+)\]/);
	expect(am, `alice:\n${s2.stdout.slice(0, 800)}`).toBeTruthy();
	await executeCell(
		harness.sidepanel,
		act(IFRAME_OAUTH_MOCK_URL, `await page.click({refId:"${am![1]}"});`),
	);

	const s3 = await executeCell(
		harness.sidepanel,
		snapAgain(IFRAME_OAUTH_MOCK_URL),
	);
	const cm = s3.stdout.match(/\bContinue\b[^\n]*\[(f\d+_e\d+)\]/);
	expect(cm, `cont:\n${s3.stdout.slice(0, 500)}`).toBeTruthy();
	await executeCell(
		harness.sidepanel,
		act(IFRAME_OAUTH_MOCK_URL, `await page.click({refId:"${cm![1]}"});`),
	);

	await harness.fixtureTab.waitForTimeout(500);
	const s4 = await executeCell(
		harness.sidepanel,
		snapAgain(IFRAME_OAUTH_MOCK_URL),
	);
	expect(s4.status, s4.stderr).toBe("success");
	expect(s4.stdout).toMatch(/Signed in as|logged in.*alice/);
});

test("iframe-oauth: parent frame works", async ({ harness }) => {
	await harness.fixtureTab.goto(IFRAME_OAUTH_MOCK_URL, {
		waitUntil: "domcontentloaded",
	});
	await harness.fixtureTab.bringToFront();
	await harness.fixtureTab.waitForTimeout(2000);
	const s = await executeCell(
		harness.sidepanel,
		snap(IFRAME_OAUTH_MOCK_URL),
		20000,
	);
	expect(s.status, s.stderr).toBe("success");
	const lm = s.stdout.match(/Login with Google[^\n]*\[(e\d+)\]/);
	expect(lm, "login").toBeTruthy();
	expect(lm![1]).toMatch(/^e\d+$/);
	await executeCell(
		harness.sidepanel,
		act(IFRAME_OAUTH_MOCK_URL, `await page.click({refId:"${lm![1]}"});`),
	);
	await harness.fixtureTab.waitForTimeout(500);
	const s2 = await executeCell(
		harness.sidepanel,
		snapAgain(IFRAME_OAUTH_MOCK_URL),
	);
	expect(s2.stdout).toContain("Sign in with Google");
	expect(s2.stdout).toContain("App");
});
