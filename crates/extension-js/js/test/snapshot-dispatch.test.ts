// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtensionSession } from "../src/main/index.js";
import { setActiveTabId } from "../src/main/tab-context.js";
import { setRunnerAbortController } from "../src/main/runner/index.js";
import {
	initCapabilities,
	resetCapabilities,
} from "../src/main/runner/tools/chrome/capability.js";
import "../src/main/runner/index.js";
import { registerContentScriptSpec } from "../src/content-script/registry.js";
import { buildContentScriptSpecs } from "../src/content-script/schemas.js";

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

describe("snapshot dispatch", () => {
	let executeScriptCalls = 0;
	let registrySnapshotCalls = 0;
	let registrySnapshotTextCalls = 0;
	let workerInstances: MockWorker[] = [];
	let postMessages: unknown[] = [];

	beforeEach(async () => {
		executeScriptCalls = 0;
		registrySnapshotCalls = 0;
		registrySnapshotTextCalls = 0;
		workerInstances = [];
		postMessages = [];
		setRunnerAbortController(null);
		setActiveTabId(1);
		resetCapabilities();

		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}

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

		vi.stubGlobal("chrome", {
			runtime: { id: "extension-test" },
			tabs: {
				get: vi.fn(() =>
					Promise.resolve({
						id: 1,
						url: "https://example.com/",
						title: "Example",
						status: "complete",
					}),
				),
				sendMessage: vi.fn(async (_tabId: number, msg: Record<string, unknown>) => {
					if (msg.action === "ping") {
						return { ok: true };
					}
					if (
						msg.type === "registryCall" &&
						msg.action === "page_snapshot_data"
					) {
						registrySnapshotCalls += 1;
						return {
							ok: true,
							value: {
								text: "snapshot",
								nodes: [],
								url: "https://example.com/",
								title: "Example",
								viewport: { width: 800, height: 600 },
							},
						};
					}
					if (
						msg.type === "registryCall" &&
						msg.action === "page_snapshot"
					) {
						registrySnapshotTextCalls += 1;
						return {
							ok: true,
							value: "URL: https://example.com/\nTitle: Example\n\n- button [e1]",
						};
					}
					return { ok: false, error: "unexpected message" };
				}),
				query: vi.fn(() => Promise.resolve([{ id: 1 }])),
				onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
				onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
			},
			scripting: {
				executeScript: vi.fn(() => {
					executeScriptCalls += 1;
					return Promise.resolve([{ result: null }]);
				}),
			},
			permissions: {
				getAll: vi.fn(() =>
					Promise.resolve({ permissions: ["tabs", "scripting", "storage"] }),
				),
			},
		});

		await initCapabilities();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("page.snapshot_data relay uses registryCall, not chrome.scripting.executeScript", async () => {
		const initPromise = ExtensionSession.init();
		setTimeout(() => {
			const worker = workerInstances[workerInstances.length - 1];
			worker?.onmessage?.({ data: { type: "ready" } } as MessageEvent);
		}, 0);
		const [session] = await initPromise;
		const worker = workerInstances[workerInstances.length - 1];

		worker.onmessage?.({
			data: {
				type: "asyncRelay",
				id: "snap-1",
				owner: "content-script",
				tabPolicy: "active",
				command: { action: "page_snapshot_data", params: {} },
			},
		} as MessageEvent);

		await new Promise((resolve) => setTimeout(resolve, 100));

		const snapResult = postMessages.find(
			(m): m is PostMessage =>
				typeof m === "object" &&
				m !== null &&
				(m as PostMessage).type === "asyncRelayResult" &&
				(m as PostMessage).id === "snap-1",
		);
		expect(snapResult?.result).toMatchObject({ ok: true });
		expect(registrySnapshotCalls).toBeGreaterThanOrEqual(1);
		expect(executeScriptCalls).toBe(0);

		await session.stopWith(Promise.resolve());
	});

	it("page.snapshot relay uses registryCall for text snapshot, not executeScript", async () => {
		const initPromise = ExtensionSession.init();
		setTimeout(() => {
			const worker = workerInstances[workerInstances.length - 1];
			worker?.onmessage?.({ data: { type: "ready" } } as MessageEvent);
		}, 0);
		const [session] = await initPromise;
		const worker = workerInstances[workerInstances.length - 1];

		worker.onmessage?.({
			data: {
				type: "asyncRelay",
				id: "snap-text-1",
				owner: "content-script",
				tabPolicy: "active",
				command: { action: "page_snapshot", params: {} },
			},
		} as MessageEvent);

		await new Promise((resolve) => setTimeout(resolve, 100));

		const snapResult = postMessages.find(
			(m): m is PostMessage =>
				typeof m === "object" &&
				m !== null &&
				(m as PostMessage).type === "asyncRelayResult" &&
				(m as PostMessage).id === "snap-text-1",
		);
		expect(snapResult?.result).toMatchObject({ ok: true });
		expect(registrySnapshotTextCalls).toBeGreaterThanOrEqual(1);
		expect(executeScriptCalls).toBe(0);

		await session.stopWith(Promise.resolve());
	});

	it("content-script relay on chrome:// tab fails preflight with E_PERMISSION before sendMessage", async () => {
		const chromeApi = globalThis.chrome as {
			tabs: {
				get: ReturnType<typeof vi.fn>;
				sendMessage: ReturnType<typeof vi.fn>;
			};
		};
		chromeApi.tabs.get.mockResolvedValue({
			id: 1,
			url: "chrome://extensions/",
			title: "Extensions",
			status: "complete",
		});
		let sendMessageCalls = 0;
		chromeApi.tabs.sendMessage.mockImplementation(async () => {
			sendMessageCalls += 1;
			return { ok: true };
		});

		const initPromise = ExtensionSession.init();
		setTimeout(() => {
			const worker = workerInstances[workerInstances.length - 1];
			worker?.onmessage?.({ data: { type: "ready" } } as MessageEvent);
		}, 0);
		const [session] = await initPromise;
		const worker = workerInstances[workerInstances.length - 1];

		worker.onmessage?.({
			data: {
				type: "asyncRelay",
				id: "preflight-1",
				owner: "content-script",
				tabPolicy: "active",
				command: { action: "page_click", params: { refId: "e1" } },
			},
		} as MessageEvent);

		await new Promise((resolve) => setTimeout(resolve, 100));

		const relayResult = postMessages.find(
			(m): m is PostMessage =>
				typeof m === "object" &&
				m !== null &&
				(m as PostMessage).type === "asyncRelayResult" &&
				(m as PostMessage).id === "preflight-1",
		);
		expect(relayResult?.result).toMatchObject({
			ok: false,
			error: expect.objectContaining({
				code: "E_PERMISSION",
				category: "permission",
			}),
		});
		expect(sendMessageCalls).toBe(0);

		await session.stopWith(Promise.resolve());
	});
});
