/**
 * Reproduces problems.md acceptance test on a pre-opened (cold) tab.
 */
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtensionSession } from "../src/main/index.js";
import { setRunnerAbortController } from "../src/main/runner/index.js";
import { executeMainThreadCommand } from "../src/main/runner/runtime.js";
import {
	initCapabilities,
	resetCapabilities,
} from "../src/main/runner/tools/chrome/capability.js";
import { setActiveTabId } from "../src/main/tab-context.js";
import "../src/main/runner/index.js";
import { handlers } from "../src/content-script/handlers.js";
import {
	dispatchContentScriptCall,
	registerContentScriptSpec,
} from "../src/content-script/registry.js";
import { buildContentScriptSpecs } from "../src/content-script/schemas.js";
import { inlineSnapshot } from "../src/content-script/snapshot.js";
import {
	grantObservation,
	resetLease,
} from "../src/content-script/observation-lease.js";

function grantFromDom() {
	const els = Array.from(document.querySelectorAll("[data-ref-id]"));
	grantObservation(
		els.map((el) => ({
			refId: el.getAttribute("data-ref-id")!,
			element: el,
		})),
	);
}

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

function buildChromeMock(
	sendMessage: ReturnType<typeof vi.fn>,
	options?: {
		getSnapshotInputValue?: () => string | undefined;
		onTabsUpdate?: (tabId: number, info: Record<string, unknown>) => void;
	},
) {
	const onUpdatedListeners: Array<
		(tabId: number, changeInfo: { status?: string }) => void
	> = [];
	return {
		runtime: { id: "extension-test" },
		tabs: {
			get: vi.fn(() =>
				Promise.resolve({
					id: 1,
					url: GOOGLE_URL,
					title: "Google",
					status: "complete",
				}),
			),
			update: vi.fn(async (tabId: number, info: Record<string, unknown>) => {
				options?.onTabsUpdate?.(tabId, info);
				for (const listener of onUpdatedListeners) {
					listener(tabId, { status: "loading" });
					listener(tabId, { status: "complete" });
				}
				return { id: tabId, url: info.url ?? GOOGLE_URL, status: "complete" };
			}),
			sendMessage,
			query: vi.fn(() => Promise.resolve([{ id: 1, url: GOOGLE_URL }])),
			onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
			onUpdated: {
				addListener: vi.fn(
					(fn: (tabId: number, changeInfo: { status?: string }) => void) => {
						onUpdatedListeners.push(fn);
					},
				),
				removeListener: vi.fn(
					(fn: (tabId: number, changeInfo: { status?: string }) => void) => {
						const idx = onUpdatedListeners.indexOf(fn);
						if (idx !== -1) onUpdatedListeners.splice(idx, 1);
					},
				),
			},
		},
		scripting: {
			executeScript: vi.fn(() => {
				const fillValue = options?.getSnapshotInputValue?.();
				const node: Record<string, unknown> = {
					refId: "e6",
					role: "textbox",
					tag: "input",
					name: "Search",
				};
				if (fillValue !== undefined) {
					node.value = fillValue;
				}
				return Promise.resolve([
					{
						result: {
							text: "URL: https://www.google.com/\nTitle: Google\n\n- textbox [e6]",
							nodes: [node],
							url: GOOGLE_URL,
							title: "Google",
							viewport: { width: 800, height: 600 },
						},
					},
				]);
			}),
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

		vi.stubGlobal("Worker", function () {
			const instance: MockWorker = {
				postMessage: vi.fn((msg: unknown) => {
					postMessages.push(msg);
				}),
				terminate: vi.fn(),
				onmessage: null,
			};
			workerInstances.push(instance);
			return instance;
		} as unknown as typeof Worker);
		vi.stubGlobal("URL", function () {
			return { toString: () => "mock-worker-url" };
		} as unknown as typeof URL);

		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
		resetLease();
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

	it("pre-opened tab: snapshot and fill fail without CS, then succeed after CS connects", async () => {
		let csConnected = false;
		let snapshotInputValue: string | undefined;
		const sendMessage = vi.fn(
			async (_tabId: number, msg: Record<string, unknown>) => {
				if (msg.action === "ping") {
					if (!csConnected) {
						throw new Error("Receiving end does not exist.");
					}
					return { ok: true };
				}
				if (
					msg.type === "registryCall" &&
					msg.action === "page_snapshot_data"
				) {
					if (!csConnected) {
						throw new Error("Receiving end does not exist.");
					}
					const fillValue = snapshotInputValue;
					const node: Record<string, unknown> = {
						refId: "e6",
						role: "textbox",
						tag: "input",
						name: "Search",
					};
					if (fillValue !== undefined) {
						node.value = fillValue;
					}
					return {
						ok: true,
						value: {
							text: "URL: https://www.google.com/\nTitle: Google\n\n- textbox [e6]",
							nodes: [node],
							url: GOOGLE_URL,
							title: "Google",
							viewport: { width: 800, height: 600 },
						},
					};
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
			},
		);

		vi.stubGlobal(
			"chrome",
			buildChromeMock(sendMessage, {
				getSnapshotInputValue: () => snapshotInputValue,
			}),
		);
		await initCapabilities();

		const worker = await initSession();
		await new Promise((resolve) => setTimeout(resolve, 0));

		relayAsync(worker, "cold-snap", "page_snapshot_data", {});
		await new Promise((resolve) => setTimeout(resolve, 700));
		const coldSnap = postMessages.find(
			(m): m is PostMessage =>
				typeof m === "object" &&
				m !== null &&
				(m as PostMessage).type === "asyncRelayResult" &&
				(m as PostMessage).id === "cold-snap",
		);
		expect(coldSnap?.result).toMatchObject({
			ok: false,
			error: expect.objectContaining({ code: "E_CONTENT_SCRIPT" }),
		});

		const urlResult = await executeMainThreadCommand({
			action: "page_url",
			params: {},
			call_id: 2,
		});
		expect(urlResult.ok).toBe(true);
		if (urlResult.ok) {
			expect(urlResult.value).toBe(GOOGLE_URL);
		}

		const titleResult = await executeMainThreadCommand({
			action: "page_title",
			params: {},
			call_id: 3,
		});
		expect(titleResult.ok).toBe(true);
		if (titleResult.ok) {
			expect(titleResult.value).toBe("Google");
		}

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
				hint: expect.stringContaining("Content script is not connected"),
				recovery: expect.arrayContaining([
					expect.stringContaining("page.goto"),
				]),
			}),
		});
		const coldErr = (coldFill?.result as { error?: { message?: string } })
			.error;
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

		snapshotInputValue = "test search";
		relayAsync(worker, "warm-snap", "page_snapshot_data", {});
		await new Promise((resolve) => setTimeout(resolve, 700));
		const snapAfterFill = postMessages.find(
			(m): m is PostMessage =>
				typeof m === "object" &&
				m !== null &&
				(m as PostMessage).type === "asyncRelayResult" &&
				(m as PostMessage).id === "warm-snap",
		);
		expect(snapAfterFill?.result).toMatchObject({ ok: true });
		const snapValue = (
			snapAfterFill?.result as { value?: { nodes?: Array<{ value?: string }> } }
		)?.value;
		const inputNode = snapValue?.nodes?.find((n) => n.value === "test search");
		expect(inputNode?.value).toBe("test search");

		document.body.innerHTML = "";
		const input = document.createElement("input");
		input.type = "text";
		document.body.appendChild(input);
		const snap = inlineSnapshot(500);
		grantFromDom();
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
		const inputNodeAfterFill = data.nodes.find((n) => n.tag === "input");
		expect(inputNodeAfterFill?.value).toBe("test search");
	});

	it("page.goto(currentUrl) reconnects content script so fill succeeds", async () => {
		let csConnected = false;
		const sendMessage = vi.fn(
			async (_tabId: number, msg: Record<string, unknown>) => {
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
			},
		);

		vi.stubGlobal(
			"chrome",
			buildChromeMock(sendMessage, {
				onTabsUpdate: () => {
					csConnected = true;
				},
			}),
		);
		await initCapabilities();

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
			error: expect.objectContaining({ code: "E_CONTENT_SCRIPT" }),
		});

		const gotoResult = await executeMainThreadCommand({
			action: "page_goto",
			params: { url: GOOGLE_URL },
			call_id: 10,
		});
		expect(gotoResult.ok).toBe(true);

		relayAsync(worker, "goto-fill", "page_fill", {
			refId: "e6",
			value: "test search",
		});
		await new Promise((resolve) => setTimeout(resolve, 700));

		const gotoFill = postMessages.find(
			(m): m is PostMessage =>
				typeof m === "object" &&
				m !== null &&
				(m as PostMessage).type === "asyncRelayResult" &&
				(m as PostMessage).id === "goto-fill",
		);
		expect(gotoFill?.result).toMatchObject({
			ok: true,
			value: {
				ok: true,
				action: "fill",
				refId: "e6",
				value: "test search",
			},
		});
	}, 10_000);

	it("page.health() returns accurate state on cold tab and after recovery", async () => {
		let csConnected = false;
		const sendMessage = vi.fn(
			async (_tabId: number, msg: Record<string, unknown>) => {
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
			},
		);

		vi.stubGlobal(
			"chrome",
			buildChromeMock(sendMessage, {
				onTabsUpdate: () => {
					csConnected = true;
				},
			}),
		);
		await initCapabilities();

		const worker = await initSession();
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Cold tab health
		const coldHealth = await executeMainThreadCommand({
			action: "page_health",
			params: {},
			call_id: 20,
		});
		expect(coldHealth.ok).toBe(true);
		if (coldHealth.ok) {
			expect(coldHealth.value).toMatchObject({
				tabId: 1,
				url: GOOGLE_URL,
				title: "Google",
				contentScript: "missing",
				domApis: "ok",
				mutationsReady: false,
				hint: expect.stringContaining("Content script is not connected"),
				recovery: expect.arrayContaining([
					expect.stringContaining("page.goto"),
				]),
			});
		}

		// Mutation without content script → E_CONTENT_SCRIPT
		relayAsync(worker, "cold-fill-health", "page_fill", {
			refId: "e6",
			value: "test search",
		});
		await new Promise((resolve) => setTimeout(resolve, 700));

		const coldFill = postMessages.find(
			(m): m is PostMessage =>
				typeof m === "object" &&
				m !== null &&
				(m as PostMessage).type === "asyncRelayResult" &&
				(m as PostMessage).id === "cold-fill-health",
		);
		expect(coldFill?.result).toMatchObject({
			ok: false,
			error: expect.objectContaining({
				code: "E_CONTENT_SCRIPT",
				hint: expect.stringContaining("Content script is not connected"),
				recovery: expect.arrayContaining([
					expect.stringContaining("page.goto"),
				]),
			}),
		});
		const coldErr = (coldFill?.result as { error?: { message?: string } })
			.error;
		expect(coldErr?.message).not.toContain("Receiving end does not exist");

		// Recovery via page.goto(currentUrl)
		const gotoResult = await executeMainThreadCommand({
			action: "page_goto",
			params: { url: GOOGLE_URL },
			call_id: 21,
		});
		expect(gotoResult.ok).toBe(true);

		// Health after recovery
		const warmHealth = await executeMainThreadCommand({
			action: "page_health",
			params: {},
			call_id: 22,
		});
		expect(warmHealth.ok).toBe(true);
		if (warmHealth.ok) {
			expect(warmHealth.value).toMatchObject({
				tabId: 1,
				url: GOOGLE_URL,
				contentScript: "connected",
				domApis: "ok",
				mutationsReady: true,
			});
			expect(warmHealth.value.hint).toBeUndefined();
			expect(warmHealth.value.recovery).toBeUndefined();
		}

		// Mutation after recovery succeeds with explicit receipt
		relayAsync(worker, "warm-fill-health", "page_fill", {
			refId: "e6",
			value: "test search",
		});
		await new Promise((resolve) => setTimeout(resolve, 700));

		const warmFill = postMessages.find(
			(m): m is PostMessage =>
				typeof m === "object" &&
				m !== null &&
				(m as PostMessage).type === "asyncRelayResult" &&
				(m as PostMessage).id === "warm-fill-health",
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
	}, 10_000);
});
