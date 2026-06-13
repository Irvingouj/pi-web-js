// Dev bridge: launch Chrome with extension-js loaded, expose HTTP /run that
// drives the persistent extension session via page.evaluate(runCellAsync).
//
// Usage:
//   npx tsx web/dev-bridge/server.ts            # default port 7331
//   PORT=8000 npx tsx web/dev-bridge/server.ts
//
// Once "sidepanel ready", curl it:
//   curl -s -X POST localhost:7331/run -H 'Content-Type: application/json' \
//     -d '{"code":"1+1"}' | jq
//
// POST /run { code: string, stdin?: string, timeoutMs?: number }
//   → { ok: true, result: CellResult } | { ok: false, error: string }
// GET /health → { ok: true, extensionId, sidepanelUrl }
// POST /reset → resets the kernel session

import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type BrowserContext, chromium, type Page } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "..");
const EXTENSION_DIST = path.resolve(WEB_ROOT, "dist");
const PORT = Number(process.env.PORT ?? 7331);
const LAUNCH_SW_TIMEOUT_MS = 30_000;
const KERNEL_READY_TIMEOUT_MS = 30_000;

type BridgeState = {
	context: BrowserContext;
	extensionId: string;
	sidepanel: Page;
	userDataDir: string;
};

function readBody(req: http.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => {
			chunks.push(c);
			if (chunks.reduce((a, c) => a + c.length, 0) > 10 * 1024 * 1024) {
				reject(new Error("body too large"));
				req.destroy();
			}
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

function sendJson(
	res: http.ServerResponse,
	status: number,
	body: unknown,
): void {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(payload),
	});
	res.end(payload);
}

async function launchBridge(): Promise<BridgeState> {
	const userDataDir = mkdtempSync(path.join(os.tmpdir(), "ext-bridge-"));
	process.stderr.write(`[bridge] userDataDir=${userDataDir}\n`);

	const context = await chromium.launchPersistentContext(userDataDir, {
		channel: "chromium",
		headless: true,
		args: [
			`--disable-extensions-except=${EXTENSION_DIST}`,
			`--load-extension=${EXTENSION_DIST}`,
			"--no-sandbox",
		],
	});

	context.on("page", (page) => {
		page.on("pageerror", (err) => {
			process.stderr.write(`[bridge][pageerror] ${err.message}\n`);
		});
		page.on("console", (msg) => {
			if (msg.type() === "error") {
				process.stderr.write(`[bridge][console.error] ${msg.text()}\n`);
			}
		});
	});

	let serviceWorker = context.serviceWorkers()[0];
	if (!serviceWorker) {
		serviceWorker = await context.waitForEvent("serviceworker", {
			timeout: LAUNCH_SW_TIMEOUT_MS,
		});
	}
	const extensionId = serviceWorker.url().split("/")[2];
	if (!extensionId) throw new Error("could not resolve extensionId");
	process.stderr.write(`[bridge] extensionId=${extensionId}\n`);

	// Open a regular tab so the active-tab path has something to target.
	// Use a real http URL so page.goto has something to navigate from.
	const seedTab = await context.newPage();
	await seedTab
		.goto("https://example.com", { waitUntil: "domcontentloaded" })
		.catch(() => {});

	// Open sidepanel page (extension's index.html).
	const sidepanel = await context.newPage();
	await sidepanel.goto(`chrome-extension://${extensionId}/index.html`, {
		waitUntil: "domcontentloaded",
	});
	process.stderr.write(`[bridge] sidepanelUrl=${sidepanel.url()}\n`);

	await waitForSessionReady(sidepanel);
	process.stderr.write("[bridge] session ready\n");

	// Make the seed tab active so page.goto targets it, not the sidepanel.
	await context
		.pages()[0]
		?.bringToFront()
		.catch(() => {});
	// Use chrome.tabs.update via sidepanel evaluate to flip activeTab.
	await sidepanel
		.evaluate(async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const chrome = (window as any).chrome;
			if (!chrome?.tabs?.query || !chrome?.tabs?.update) return;
			const tabs = await chrome.tabs.query({ active: false });
			const httpTab = tabs.find((t: { url?: string }) =>
				t.url?.startsWith("http"),
			);
			if (httpTab) await chrome.tabs.update(httpTab.id, { active: true });
		})
		.catch(() => {});
	process.stderr.write("[bridge] seed tab activated\n");

	return { context, extensionId, sidepanel, userDataDir };
}

async function waitForSessionReady(sidepanel: Page): Promise<void> {
	await sidepanel.waitForFunction(
		() => {
			const w = window as Window & {
				__extensionSession?: { runCellAsync?: unknown };
			};
			return !!w.__extensionSession?.runCellAsync;
		},
		{ timeout: KERNEL_READY_TIMEOUT_MS },
	);
}

async function runCell(
	sidepanel: Page,
	code: string,
	stdin: string | undefined,
	timeoutMs: number,
): Promise<unknown> {
	return sidepanel.evaluate(
		async ({ code, stdin, timeoutMs }) => {
			const w = window as Window & {
				__extensionSession?: {
					runCellAsync(c: string, s?: string): Promise<unknown>;
				};
			};
			const session = w.__extensionSession;
			if (!session) throw new Error("session not ready");
			const race = new Promise((_, reject) => {
				setTimeout(
					() => reject(new Error(`cell timeout after ${timeoutMs}ms`)),
					timeoutMs,
				);
			});
			return Promise.race([session.runCellAsync(code, stdin), race]);
		},
		{ code, stdin: stdin ?? "", timeoutMs },
	);
}

async function resetSession(sidepanel: Page): Promise<unknown> {
	return sidepanel.evaluate(() => {
		const w = window as Window & {
			__extensionSession?: { reset?: () => Promise<unknown> };
		};
		const session = w.__extensionSession;
		if (!session?.reset) throw new Error("reset not available");
		return session.reset();
	});
}

async function shutdown(state: BridgeState, code: number): Promise<void> {
	process.stderr.write("[bridge] shutting down\n");
	try {
		await state.context.close();
	} catch {}
	rmSync(state.userDataDir, { recursive: true, force: true });
	process.exit(code);
}

async function main(): Promise<void> {
	if (!EXTENSION_DIST) {
		throw new Error("EXTENSION_DIST not set");
	}
	process.stderr.write(`[bridge] extensionDist=${EXTENSION_DIST}\n`);

	const state = await launchBridge();

	const server = http.createServer(async (req, res) => {
		try {
			const url = new URL(req.url ?? "", `http://localhost:${PORT}`);
			if (req.method === "GET" && url.pathname === "/health") {
				sendJson(res, 200, {
					ok: true,
					extensionId: state.extensionId,
					sidepanelUrl: state.sidepanel.url(),
				});
				return;
			}
			if (req.method === "POST" && url.pathname === "/run") {
				const raw = await readBody(req);
				let parsed: { code?: string; stdin?: string; timeoutMs?: number };
				try {
					parsed = JSON.parse(raw);
				} catch {
					sendJson(res, 400, { ok: false, error: "invalid JSON body" });
					return;
				}
				if (typeof parsed.code !== "string") {
					sendJson(res, 400, { ok: false, error: "missing 'code' string" });
					return;
				}
				const timeoutMs = parsed.timeoutMs ?? 60_000;
				try {
					const result = await runCell(
						state.sidepanel,
						parsed.code,
						parsed.stdin,
						timeoutMs,
					);
					sendJson(res, 200, { ok: true, result });
				} catch (err: unknown) {
					const message = err instanceof Error ? err.message : String(err);
					sendJson(res, 500, { ok: false, error: message });
				}
				return;
			}
			if (req.method === "POST" && url.pathname === "/reset") {
				try {
					const result = await resetSession(state.sidepanel);
					sendJson(res, 200, { ok: true, result });
				} catch (err: unknown) {
					const message = err instanceof Error ? err.message : String(err);
					sendJson(res, 500, { ok: false, error: message });
				}
				return;
			}
			sendJson(res, 404, {
				ok: false,
				error: `unknown route ${req.method} ${url.pathname}`,
			});
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			sendJson(res, 500, { ok: false, error: message });
		}
	});

	server.listen(PORT, "127.0.0.1", () => {
		process.stderr.write(
			`[bridge] listening on http://127.0.0.1:${PORT}\n[bridge] POST /run, GET /health, POST /reset\n`,
		);
	});

	const cleanup = (sig: string) => {
		process.stderr.write(`[bridge] received ${sig}\n`);
		void shutdown(state, 0);
	};
	process.on("SIGINT", () => cleanup("SIGINT"));
	process.on("SIGTERM", () => cleanup("SIGTERM"));
}

main().catch((err: unknown) => {
	const message = err instanceof Error ? err.message : String(err);
	process.stderr.write(
		`[bridge] fatal: ${message}\n${err instanceof Error ? (err.stack ?? "") : ""}\n`,
	);
	process.exit(1);
});
