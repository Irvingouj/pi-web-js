import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	type BrowserContext,
	chromium,
	expect,
	type Page,
	type TestInfo,
} from "@playwright/test";
import {
	CELL_TIMEOUT_MS,
	EXTENSION_DIST,
	FIXTURE_HTML,
	FIXTURE_ORIGIN,
	LAUNCH_EDITOR_TIMEOUT_MS,
	LAUNCH_KERNEL_TIMEOUT_MS,
	LAUNCH_SW_TIMEOUT_MS,
	RESULT_PREFIX,
} from "./constants.ts";
import {
	decodeRenderedOutput,
	parseAllSentinels,
	parseSentinelLine,
} from "./sentinels.ts";
import type {
	CellExecution,
	ContractResult,
	ExtensionFixture,
	ExtensionHarness,
} from "./types.ts";

export async function installFixtureRoutes(context: BrowserContext): Promise<void> {
	await context.route(`${FIXTURE_ORIGIN}/**`, async (route) => {
		const url = new URL(route.request().url());
		if (url.pathname === "/fixture" || url.pathname === "/fixture/") {
			return route.fulfill({
				status: 200,
				contentType: "text/html; charset=utf-8",
				body: FIXTURE_HTML,
			});
		}
		if (url.pathname === "/next") {
			return route.fulfill({
				status: 200,
				contentType: "text/html; charset=utf-8",
				body: "<html><body><div id='next'>Next page</div></body></html>",
			});
		}
		if (url.pathname === "/api/json") {
			return route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ ok: true, source: "fixture" }),
			});
		}
		if (url.pathname === "/api/text") {
			return route.fulfill({
				status: 200,
				contentType: "text/plain",
				body: "fixture-text",
			});
		}
		if (url.pathname === "/api/redirect") {
			return route.redirect(`${FIXTURE_ORIGIN}/fixture`);
		}
		if (url.pathname === "/api/status/404") {
			return route.fulfill({ status: 404, body: "not found" });
		}
		if (url.pathname === "/api/delay") {
			await new Promise((r) => setTimeout(r, 300));
			return route.fulfill({ status: 200, body: "delayed" });
		}
		if (url.pathname === "/api/set-cookie") {
			return route.fulfill({
				status: 200,
				headers: {
					"content-type": "text/plain",
					"set-cookie": "contract_cookie=1; Path=/",
				},
				body: "cookie-set",
			});
		}
		return route.fulfill({ status: 404, body: "not routed" });
	});
}

async function attachLaunchFailureDiagnostics(
	testInfo: TestInfo | undefined,
	details: {
		userDataDir: string;
		extensionId?: string;
		sidepanel?: Page;
		serviceWorkerErrors: string[];
		browserConsoleErrors: string[];
		error: unknown;
	},
): Promise<void> {
	if (!testInfo) return;
	const kernelStatus = details.sidepanel
		? await details.sidepanel
				.locator('[data-testid="kernel-status"]')
				.textContent()
				.catch(() => "")
		: "";
	const body = [
		`userDataDir: ${details.userDataDir}`,
		`extensionId: ${details.extensionId ?? "unknown"}`,
		`sidepanelUrl: ${details.sidepanel?.url() ?? "unknown"}`,
		`kernelStatus: ${kernelStatus ?? ""}`,
		`error: ${details.error instanceof Error ? details.error.message : String(details.error)}`,
		`serviceWorkerErrors:\n${details.serviceWorkerErrors.join("\n") || "(none)"}`,
		`browserConsoleErrors:\n${details.browserConsoleErrors.join("\n") || "(none)"}`,
	].join("\n\n");
	await testInfo.attach("launch-failure", {
		body,
		contentType: "text/plain",
	});
}

export async function launchExtension(
	testInfo?: TestInfo,
): Promise<ExtensionHarness> {
	const serviceWorkerErrors: string[] = [];
	const browserConsoleErrors: string[] = [];
	const userDataDir = mkdtempSync(path.join(os.tmpdir(), "ext-contract-"));

	let context: BrowserContext | undefined;
	let extensionId: string | undefined;
	let sidepanel: Page | undefined;

	try {
		context = await chromium.launchPersistentContext(userDataDir, {
			channel: "chromium",
			headless: true,
			args: [
				`--disable-extensions-except=${EXTENSION_DIST}`,
				`--load-extension=${EXTENSION_DIST}`,
			],
		});

		context.on("page", (page) => {
			page.on("pageerror", (err) => {
				browserConsoleErrors.push(`pageerror: ${err.message}`);
			});
			page.on("console", (msg) => {
				if (msg.type() === "error") {
					browserConsoleErrors.push(`console: ${msg.text()}`);
				}
			});
		});

		for (const sw of context.serviceWorkers()) {
			sw.on("console", (msg) => {
				if (msg.type() === "error") {
					serviceWorkerErrors.push(msg.text());
				}
			});
		}
		context.on("serviceworker", (sw) => {
			sw.on("console", (msg) => {
				if (msg.type() === "error") {
					serviceWorkerErrors.push(msg.text());
				}
			});
		});

		await installFixtureRoutes(context);

		let serviceWorker = context.serviceWorkers()[0];
		if (!serviceWorker) {
			serviceWorker = await context.waitForEvent("serviceworker", {
				timeout: LAUNCH_SW_TIMEOUT_MS,
			});
		}
		extensionId = serviceWorker.url().split("/")[2];
		expect(extensionId).toBeTruthy();

		const fixtureTab = await context.newPage();
		await fixtureTab.goto(`${FIXTURE_ORIGIN}/fixture`, {
			waitUntil: "domcontentloaded",
		});

		sidepanel = await context.newPage();
		await sidepanel.goto(`chrome-extension://${extensionId}/index.html`, {
			waitUntil: "domcontentloaded",
		});

		expect(sidepanel.url().startsWith("chrome-extension://")).toBe(true);

		await waitForKernelReady(sidepanel, LAUNCH_KERNEL_TIMEOUT_MS);
		await sidepanel
			.locator('[data-testid="cell-editor"] .cm-content')
			.first()
			.waitFor({
				state: "visible",
				timeout: LAUNCH_EDITOR_TIMEOUT_MS,
			});

		return {
			context,
			extensionId,
			sidepanel,
			fixtureTab,
			userDataDir,
			serviceWorkerErrors,
			browserConsoleErrors,
		};
	} catch (error) {
		await attachLaunchFailureDiagnostics(testInfo, {
			userDataDir,
			extensionId,
			sidepanel,
			serviceWorkerErrors,
			browserConsoleErrors,
			error,
		});
		if (context) {
			await context.close().catch(() => {});
		}
		rmSync(userDataDir, { recursive: true, force: true });
		throw error;
	}
}

export async function teardownExtension(harness: ExtensionHarness): Promise<void> {
	const userDataDir = harness.userDataDir;
	try {
		await cleanupFixture(harness);
		if (harness.context) {
			await harness.context.close();
		}
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
	}
}

export async function waitForKernelReady(
	page: Page,
	timeout = 60_000,
): Promise<void> {
	const el = page.locator('[data-testid="kernel-status"]');
	await el.waitFor({ state: "visible", timeout });
	await page.waitForFunction(
		() => {
			const status = document.querySelector(
				'[data-testid="kernel-status"]',
			) as HTMLElement | null;
			return status?.textContent?.toLowerCase().includes("ready") ?? false;
		},
		{ timeout },
	);
}

async function setEditorSource(page: Page, source: string): Promise<void> {
	await page.bringToFront();
	const editor = page.locator('[data-testid="cell-editor"] .cm-content').first();
	await editor.click();
	const selectAll = process.platform === "darwin" ? "Meta+a" : "Control+a";
	await page.keyboard.press(selectAll);
	await page.keyboard.press("Delete");
	await page.keyboard.insertText(source);
}

export async function executeCell<T>(
	sidepanel: Page,
	source: string,
	timeoutMs = CELL_TIMEOUT_MS,
): Promise<CellExecution<T>> {
	await waitForKernelReady(sidepanel, LAUNCH_KERNEL_TIMEOUT_MS);
	await setEditorSource(sidepanel, source);

	const execLabelBefore =
		(await sidepanel
			.locator('[data-testid="cell-execution-count"]')
			.first()
			.textContent()) ?? "";

	await sidepanel.waitForTimeout(550);

	await sidepanel.locator('[data-testid="cell-run-button"]').first().click();

	await sidepanel.waitForFunction(
		(before) => {
			const label =
				document.querySelector('[data-testid="cell-execution-count"]')
					?.textContent ?? "";
			const status = document.querySelector(
				'[data-testid="cell-status"]',
			) as HTMLElement | null;
			const text = status?.textContent?.toLowerCase() ?? "";
			if (label === before) return false;
			return text === "success" || text === "error";
		},
		execLabelBefore,
		{ timeout: timeoutMs },
	);

	const statusText =
		(await sidepanel.locator('[data-testid="cell-status"]').first().textContent()) ??
		"";
	const status: CellExecution<T>["status"] = statusText
		.toLowerCase()
		.includes("error")
		? "error"
		: "success";

	const stdout = decodeRenderedOutput(
		(await sidepanel.locator('[data-testid="cell-output"]').first().textContent()) ??
			"",
	);
	const stderr = (
		await sidepanel.locator('[data-testid="cell-error"]').allTextContents()
	).join("\n");

	let result: T | null = null;
	const sentinels = parseAllSentinels(stdout);
	if (sentinels.length === 1) {
		result = sentinels[0] as T;
	} else if (sentinels.length > 1) {
		result = sentinels as unknown as T;
	} else {
		const lastLine = stdout
			.split("\n")
			.reverse()
			.find((l) => l.includes(RESULT_PREFIX));
		if (lastLine) {
			result = parseSentinelLine(lastLine) as T;
		}
	}

	return { status, result, stdout, stderr };
}

export async function createFixture(
	harness: ExtensionHarness,
): Promise<ExtensionFixture> {
	return {
		extensionId: harness.extensionId,
		fixtureUrl: `${FIXTURE_ORIGIN}/fixture`,
		fixtureTabId: 0,
		originalTabIds: [],
		originalWindowIds: [],
		runId: `w${Date.now()}`,
	};
}

export async function cleanupFixture(harness: ExtensionHarness): Promise<void> {
	await executeCell(
		harness.sidepanel,
		`var RESULT_PREFIX = "${RESULT_PREFIX}"; try { await fs.delete("/__contract_persist.txt"); } catch {} print(RESULT_PREFIX + JSON.stringify({ ok: true, value: "cleaned" }));`,
	);
}

export async function inspectPublicApis(
	sidepanel: Page,
): Promise<ReadonlySet<string>> {
	const exec = await executeCell<ContractResult<string[]>>(
		sidepanel,
		`
var RESULT_PREFIX = "${RESULT_PREFIX}";
const globals = await runtime.inspect();
const apis = [];
for (const g of globals) {
  if (g.name.startsWith("__")) continue;
  if (g.type === "function") apis.push(g.name);
  if (g.type === "object" && Array.isArray(g.keys)) {
    for (const k of g.keys) {
      if (k === "__proto__" || k === "constructor") continue;
      apis.push(g.name + "." + k);
    }
  }
}
print(RESULT_PREFIX + JSON.stringify({ ok: true, value: apis.sort() }));
`,
	);
	expect(exec.status).toBe("success");
	expect(exec.result && "ok" in exec.result && exec.result.ok).toBe(true);
	if (exec.result && "ok" in exec.result && exec.result.ok) {
		return new Set(exec.result.value);
	}
	return new Set();
}

export function assertNoHarnessErrors(
	harness: Pick<ExtensionHarness, "serviceWorkerErrors" | "browserConsoleErrors">,
	testInfo?: TestInfo,
): void {
	if (harness.serviceWorkerErrors.length > 0) {
		const msg = harness.serviceWorkerErrors.join("\n");
		if (testInfo) {
			testInfo.attach("service-worker-errors", { body: msg, contentType: "text/plain" });
		}
		throw new Error(`Service worker errors:\n${msg}`);
	}
	const fatalConsole = harness.browserConsoleErrors.filter(
		(e) => !e.includes("Extension context invalidated"),
	);
	if (fatalConsole.length > 0) {
		const msg = fatalConsole.join("\n");
		if (testInfo) {
			testInfo.attach("browser-console-errors", { body: msg, contentType: "text/plain" });
		}
		throw new Error(`Browser console errors:\n${msg}`);
	}
}

export async function restartKernel(sidepanel: Page): Promise<void> {
	await sidepanel.locator('[data-testid="restart-kernel-button"]').click();
	await waitForKernelReady(sidepanel, LAUNCH_KERNEL_TIMEOUT_MS);
}
