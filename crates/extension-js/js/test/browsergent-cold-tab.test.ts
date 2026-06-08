/**
 * Reproduces problems.md acceptance test on a pre-opened (cold) tab.
 */
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtensionSession } from "../src/main/index.js";
import { setActiveTabId } from "../src/main/tab-context.js";
import { setRunnerAbortController } from "../src/main/runner/index.js";
import { executeMainThreadCommand } from "../src/main/runner/runtime.js";
import {
	initCapabilities,
	resetCapabilities,
} from "../src/main/runner/tools/chrome/capability.js";
import "../src/main/runner/index.js";
import {
	dispatchContentScriptCall,
	registerContentScriptSpec,
} from "../src/content-script/registry.js";
import { buildContentScriptSpecs } from "../src/content-script/schemas.js";
import { handlers } from "../src/content-script/handlers.js";
import { inlineSnapshot } from "../src/content-script/snapshot.js";

interface MockWorker {
	postMessage: ReturnType<typeof vi.fn>;
	terminate: ReturnType<typeof vi.fn>;
	onmessage: ((e: MessageEvent) => void) | null;
}

interface PostMessage {
	type: string;
	id?: string;
	result?: unknown;
}

const GOOGLE_URL = "https://www.google.com/";

if (typeof globalThis.CSS === "undefined" || !globalThis.CSS.escape) {
	(globalThis as unknown as Record<string, unknown>).CSS = {
		escape: (s: string) => s.replace(/([.*+?^${}()|[\]\\])/g, "\\$1"),
	};
}

const ALL_MANIFEST_PERMISSIONS = ["tabs", "scripting", "storage"] as const;

function buildChromeMock(sendMessage: ReturnType<typeof vi.fn>) {
	return {
		runtime: { id: "extension-test" },
		tabs: {
			get: vi.fn(() =>
				Promise.resolve({ id: 1, url: GOOGLE_URL, title: "Google" }),
			),
			sendMessage,
			query: vi.fn(() => Promise.resolve([{ id: 1, url: GOOGLE_URL }])),
			onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
			onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
		},
		scripting: {
			executeScript: vi.fn(() =>
				Promise.resolve([
					{
						result: {
							text: "URL: https://www.google.com/\nTitle: Google\n\n- textbox [e6]",
							nodes: [
								{
									refId: "e6",
									role: "textbox",
									tag: "input",
									name: "Search",
								},
							],
							url: GOOGLE_URL,
							title: "Google",
							viewport: { width: 800, height: 600 },
						},
					},
				]),
			),
		},
		permissions: {
			getAll: vi.fn(() =>
				Promise.resolve({ permissions: [...ALL_MANIFEST_PERMISSIONS] }),
			),
		},
	};
}

describe("browsergent cold tab acceptance", () => {
	let postMessages: unknown[] = [];
	let workerInstances: MockWorker[] = [];
	let sessions: ExtensionSession[] = [];

	beforeEach(async () => {
		postMessages = [];
		workerInstances = [];
		sessions = [];
		setRunnerAbortController(null);
		setActiveTabId(1);
		resetCapabilities();

		vi.stubGlobal(
			"Worker",
			function () {
				const instance: MockWorker = {
					postMessage: vi.fn((msg: unknown) => {
						postMessages.push(msg);
					}),
					terminate: vi.fn(),
					onmessage: null,
				};
				workerInstances.push(instance);
				return instance;
			} as unknown as typeof Worker,
		);
		vi.stubGlobal(
			"URL",
			function () {
				return { toString: () => "mock-worker-url" };
			} as unknown as typeof URL,
		);

		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
	});

	afterEach(async () => {
		for (const session of sessions) {
			try {
				await session.stopWith(Promise.resolve());
			} catch {
				// ignore
			}
		}
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	async function initSession(): Promise<MockWorker> {
		const initPromise = ExtensionSession.init();
		setTimeout(() => {
			const worker = workerInstances[workerInstances.length - 1];
			worker?.onmessage?.({ data: { type: "ready" } } as MessageEvent);
		}, 0);
		const [session] = await initPromise;
		sessions.push(session);
		return workerInstances[workerInstances.length - 1];
	}

	function relayAsync(
		worker: MockWorker,
		id: string,
		action: string,
		params: Record<string, unknown>,
	) {
		worker.onmessage?.({
			data: {
				type: "asyncRelay",
				id,
				owner: "content-script",
				tabPolicy: "active",
				command: { action, params },
			},
		} as MessageEvent);
	}

	it("pre-opened tab: snapshot ok, fill fails with E_CONTENT_SCRIPT, then fill succeeds after CS connects", async () => {
		let csConnected = false;
		const sendMessage = vi.fn(async (_tabId: number, msg: Record<string, unknown>) => {
			if (msg.action === "ping") {
				if (!csConnected) {
					throw new Error("Receiving end does not exist.");
				}
				return { ok: true };
			}
			if (msg.type === "registryCall" && msg.action === "page_fill") {
				return {
					ok: true,
					value: {
						ok: true,
						action: "fill",
						refId: "e6",
						value: "test search",
					},
				};
			}
			throw new Error("Receiving end does not exist.");
		});

		vi.stubGlobal("chrome", buildChromeMock(sendMessage));
		await initCapabilities();

		const snapResult = await executeMainThreadCommand({
			action: "page_snapshot_data",
			params: {},
			call_id: 1,
		});
		expect(snapResult.ok).toBe(true);

		const urlResult = await executeMainThreadCommand({
			action: "page_url",
			params: {},
			call_id: 2,
		});
		expect(urlResult.ok).toBe(true);
		if (urlResult.ok) {
			expect(urlResult.value).toBe(GOOGLE_URL);
		}

		const worker = await initSession();
		await new Promise((resolve) => setTimeout(resolve, 0));

		relayAsync(worker, "cold-fill", "page_fill", {
			refId: "e6",
			value: "test search",
		});
		await new Promise((resolve) => setTimeout(resolve, 700));

		const coldFill = postMessages.find(
			(m): m is PostMessage =>
				typeof m === "object" &&
				m !== null &&
				(m as PostMessage).type === "asyncRelayResult" &&
				(m as PostMessage).id === "cold-fill",
		);
		expect(coldFill?.result).toMatchObject({
			ok: false,
			error: expect.objectContaining({
				code: "E_CONTENT_SCRIPT",
				hint: expect.stringContaining("page.snapshot()"),
				recovery: expect.arrayContaining([
					expect.stringContaining("page.goto"),
				]),
			}),
		});
		const coldErr = (coldFill?.result as { error?: { message?: string } }).error;
		expect(coldErr?.message).not.toContain("Receiving end does not exist");

		csConnected = true;
		relayAsync(worker, "warm-fill", "page_fill", {
			refId: "e6",
			value: "test search",
		});
		await new Promise((resolve) => setTimeout(resolve, 700));

		const warmFill = postMessages.find(
			(m): m is PostMessage =>
				typeof m === "object" &&
				m !== null &&
				(m as PostMessage).type === "asyncRelayResult" &&
				(m as PostMessage).id === "warm-fill",
		);
		expect(warmFill?.result).toMatchObject({
			ok: true,
			value: {
				ok: true,
				action: "fill",
				refId: "e6",
				value: "test search",
			},
		});

		document.body.innerHTML = "";
		const input = document.createElement("input");
		input.type = "text";
		document.body.appendChild(input);
		const snap = inlineSnapshot(500);
		const refId = snap.nodes.find((n) => n.tag === "input")!.refId;
		const fillResult = await dispatchContentScriptCall(
			"page_fill",
			"fill",
			handlers.fill,
			{ refId, value: "test search" },
		);
		if (!fillResult.ok) {
			throw new Error(`fill failed: ${JSON.stringify(fillResult)}`);
		}
		expect((input as HTMLInputElement).value).toBe("test search");
		const data = inlineSnapshot(500);
		const inputNode = data.nodes.find((n) => n.tag === "input");
		expect(inputNode?.value).toBe("test search");
	});
});
