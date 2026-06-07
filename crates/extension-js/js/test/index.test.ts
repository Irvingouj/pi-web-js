// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtensionSession } from "../src/main/index.js";
import { setActiveTabId } from "../src/main/tab-context.js";
import { setRunnerAbortController } from "../src/main/runner/index.js";

interface MockWorker {
	postMessage: ReturnType<typeof vi.fn>;
	terminate: ReturnType<typeof vi.fn>;
	onmessage: ((e: MessageEvent) => void) | null;
	onerror: ((e: ErrorEvent) => void) | null;
	onmessageerror: ((e: MessageEvent) => void) | null;
}

interface PostMessage {
	type: string;
	id?: string;
	action?: string;
}

declare global {
	var chrome: {
		runtime: { id: string };
		tabs: {
			sendMessage: ReturnType<typeof vi.fn>;
			onActivated: { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> };
			onUpdated: { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> };
			query: ReturnType<typeof vi.fn>;
		};
		scripting: { executeScript: ReturnType<typeof vi.fn> };
	};
}

describe("ExtensionSession fs namespace e2e", () => {
	let postMessages: unknown[] = [];
	let workerInstances: MockWorker[] = [];
	let sessions: ExtensionSession[] = [];

	beforeEach(() => {
		postMessages = [];
		workerInstances = [];
		sessions = [];
		setRunnerAbortController(null);

		vi.stubGlobal(
			"Worker",
			function () {
				const instance = {
					postMessage: vi.fn((msg: unknown) => {
						postMessages.push(msg);
					}),
					terminate: vi.fn(),
					onmessage: null as ((e: MessageEvent) => void) | null,
					onerror: null as ((e: ErrorEvent) => void) | null,
					onmessageerror: null as ((e: MessageEvent) => void) | null,
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
		postMessages = [];
		workerInstances = [];
		sessions = [];
	});

	function sendWorkerAsyncRelay(
		worker: MockWorker,
		id: string,
		action: string,
		owner: string,
		options?: {
			params?: Record<string, unknown>;
			tabPolicy?: "active" | "required";
		},
	) {
		if (worker.onmessage) {
			worker.onmessage({
				data: {
					type: "asyncRelay",
					id,
					owner,
					tabPolicy: options?.tabPolicy,
					command: {
						action,
						params: options?.params ?? { refId: "e1" },
					},
				},
			} as MessageEvent);
		}
	}

	async function initSession(): Promise<
		[ExtensionSession, Promise<void>, MockWorker]
	> {
		const initPromise = ExtensionSession.init();

		// Use setTimeout so the ready message is sent after all async imports
		// in init() complete and the worker is created.
		setTimeout(() => {
			const latestWorker = workerInstances[workerInstances.length - 1];
			if (latestWorker?.onmessage) {
				latestWorker.onmessage({
					data: { type: "ready" },
				} as MessageEvent);
			}
		}, 0);

		const [session, runner] = await initPromise;
		sessions.push(session);
		const worker = workerInstances[workerInstances.length - 1];
		return [session, runner, worker];
	}

	function sendWorkerResult(worker: MockWorker, id: string, data: unknown) {
		if (worker.onmessage) {
			worker.onmessage({
				data: { type: "result", id, data },
			} as MessageEvent);
		}
	}

	function sendWorkerError(worker: MockWorker, id: string, error: string) {
		if (worker.onmessage) {
			worker.onmessage({
				data: { type: "error", id, error },
			} as MessageEvent);
		}
	}

	const fsTestCases = [
		{ action: "exists", params: { path: "/test" }, result: { exists: true } },
		{ action: "read", params: { path: "/test" }, result: { data: "base64" } },
		{
			action: "readText",
			params: { path: "/test" },
			result: { data: "hello" },
		},
		{
			action: "readBase64",
			params: { path: "/test" },
			result: { data: "aGVsbG8=" },
		},
		{ action: "list", params: { path: "/test" }, result: { entries: [] } },
		{ action: "mkdir", params: { path: "/test" }, result: { ok: true } },
		{ action: "delete", params: { path: "/test" }, result: { ok: true } },
		{
			action: "copy",
			params: { from: "/test/a", to: "/test/b" },
			result: { ok: true },
		},
		{
			action: "move",
			params: { from: "/test/a", to: "/test/b" },
			result: { ok: true },
		},
		{
			action: "write",
			params: { path: "/test", data: "base64" },
			result: { ok: true },
		},
		{
			action: "writeText",
			params: { path: "/test", data: "hello" },
			result: { ok: true },
		},
		{
			action: "writeBase64",
			params: { path: "/test", data: "aGVsbG8=" },
			result: { ok: true },
		},
		{
			action: "append",
			params: { path: "/test", data: "base64" },
			result: { ok: true },
		},
		{
			action: "appendText",
			params: { path: "/test", data: "hello" },
			result: { ok: true },
		},
		{
			action: "appendBase64",
			params: { path: "/test", data: "aGVsbG8=" },
			result: { ok: true },
		},
		{
			action: "readRange",
			params: { path: "/test", offset: 0, len: 100 },
			result: { data: "chunk" },
		},
		{
			action: "update",
			params: { path: "/test", offset: 0, data: "base64" },
			result: { ok: true },
		},
		{
			action: "hash",
			params: { path: "/test", algo: "sha256" },
			result: { hash: "abc" },
		},
		{
			action: "stat",
			params: { path: "/test" },
			result: {
				path: "/test",
				name: "test",
				kind: "file",
				size: 0,
				mime: null,
				created_at: null,
				modified_at: null,
			},
		},
	];

	it.each(
		fsTestCases,
	)("$action sends correct fsCall message and resolves", async ({
		action,
		params,
		result,
	}) => {
		const [session, , worker] = await initSession();

		const fsMethod = (session.fs as Record<string, (params: unknown) => Promise<unknown>>)[action];
		const promise = fsMethod(params);

		const fsCallMsg = postMessages.find(
			(m): m is PostMessage => typeof m === "object" && m !== null && (m as PostMessage).type === "fsCall" && (m as PostMessage).action === action,
		);
		expect(fsCallMsg).toBeDefined();
		expect(fsCallMsg).toMatchObject({
			type: "fsCall",
			action,
			params,
		});

		sendWorkerResult(worker, fsCallMsg?.id ?? "", result);
		const actualResult = await promise;
		expect(actualResult).toEqual(result);
	});

	it("handles unknown fs action error from worker", async () => {
		const [session, , worker] = await initSession();

		const existsPromise = session.fs.exists({ path: "/test" });

		const fsCallMsg = postMessages.find(
			(m): m is PostMessage => typeof m === "object" && m !== null && (m as PostMessage).type === "fsCall" && (m as PostMessage).action === "exists",
		);
		expect(fsCallMsg).toBeDefined();

		sendWorkerError(worker, fsCallMsg?.id ?? "", "Unknown fs action: exists");

		await expect(existsPromise).rejects.toThrow("Unknown fs action: exists");
	});

	it("apiDocs('json') sends apiDocs message and returns parsed catalog", async () => {
		const [session, , worker] = await initSession();

		const promise = session.apiDocs("json");

		const apiDocsMsg = postMessages.find(
			(m): m is PostMessage => typeof m === "object" && m !== null && (m as PostMessage).type === "apiDocs",
		);
		expect(apiDocsMsg).toBeDefined();
		expect(apiDocsMsg).toMatchObject({
			type: "apiDocs",
			format: "json",
		});

		sendWorkerResult(worker, apiDocsMsg?.id ?? "", JSON.stringify([
			{ public_name: "fs.exists", namespace: "fs", name: "exists", action: "fs_exists" },
			{ public_name: "page.goto", namespace: "page", name: "goto", action: "page_goto" },
		]));
		const result = await promise;
		expect(Array.isArray(result)).toBe(true);
		expect(result).toHaveLength(2);
		expect((result as unknown[])[0]).toMatchObject({ public_name: "fs.exists" });
		expect((result as unknown[])[1]).toMatchObject({ public_name: "page.goto" });
	});

	it("apiDocs('markdown') sends apiDocs message and returns markdown string", async () => {
		const [session, , worker] = await initSession();

		const promise = session.apiDocs("markdown");

		const apiDocsMsg = postMessages.find(
			(m): m is PostMessage => typeof m === "object" && m !== null && (m as PostMessage).type === "apiDocs",
		);
		expect(apiDocsMsg).toBeDefined();
		expect(apiDocsMsg).toMatchObject({
			type: "apiDocs",
			format: "markdown",
		});

		sendWorkerResult(worker, apiDocsMsg?.id ?? "", "## `page` module\n\npage.goto\n");
		const result = await promise;
		expect(typeof result).toBe("string");
		expect(result).toContain("## `page` module");
	});

	it("apiDocs defaults to json format", async () => {
		const [session, , worker] = await initSession();

		const promise = session.apiDocs();

		const apiDocsMsg = postMessages.find(
			(m): m is PostMessage => typeof m === "object" && m !== null && (m as PostMessage).type === "apiDocs",
		);
		expect(apiDocsMsg).toBeDefined();
		expect(apiDocsMsg).toMatchObject({
			type: "apiDocs",
			format: "json",
		});

		sendWorkerResult(worker, apiDocsMsg?.id ?? "", "[]");
		const result = await promise;
		expect(Array.isArray(result)).toBe(true);
	});

	it("preserves structured content-script error codes in asyncRelayResult", async () => {
		globalThis.chrome = {
			runtime: { id: "extension-test" },
			tabs: {
				sendMessage: vi.fn(() =>
					Promise.resolve({
						ok: false,
						error: {
							message: "Invalid parameters for page_click: missing refId",
							code: "E_INVALID_PARAMS",
							category: "validation",
						},
					}),
				),
				onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
				onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
				query: vi.fn(() => Promise.resolve([{ id: 1 }])),
			},
			scripting: { executeScript: vi.fn() },
		};
		const [, , worker] = await initSession();
		setActiveTabId(1);

		sendWorkerAsyncRelay(worker, "relay-err", "page_click", "content-script", {
			params: { refId: "e1" },
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		const relayResult = postMessages.find(
			(m): m is PostMessage & { result?: unknown } =>
				typeof m === "object" &&
				m !== null &&
				(m as PostMessage).type === "asyncRelayResult" &&
				(m as PostMessage).id === "relay-err",
		);
		expect(relayResult?.result).toEqual({
			ok: false,
			error: {
				message: "Invalid parameters for page_click: missing refId",
				code: "E_INVALID_PARAMS",
				category: "validation",
			},
		});
	});

	it("maps legacy string content-script errors to E_CONTENT_SCRIPT", async () => {
		globalThis.chrome = {
			runtime: { id: "extension-test" },
			tabs: {
				sendMessage: vi.fn(() =>
					Promise.resolve({
						ok: false,
						error: "Unknown content script action: foo",
					}),
				),
				onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
				onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
				query: vi.fn(() => Promise.resolve([{ id: 1 }])),
			},
			scripting: { executeScript: vi.fn() },
		};
		const [, , worker] = await initSession();
		setActiveTabId(1);

		sendWorkerAsyncRelay(worker, "relay-legacy", "page_click", "content-script");
		await new Promise((resolve) => setTimeout(resolve, 0));

		const relayResult = postMessages.find(
			(m): m is PostMessage & { result?: unknown } =>
				typeof m === "object" &&
				m !== null &&
				(m as PostMessage).type === "asyncRelayResult" &&
				(m as PostMessage).id === "relay-legacy",
		);
		expect(relayResult?.result).toEqual({
			ok: false,
			error: {
				message: "Unknown content script action: foo",
				code: "E_CONTENT_SCRIPT",
				category: "resource",
			},
		});
	});

	it("routes tab_click with bigint tabId through registryCall", async () => {
		globalThis.chrome = {
			runtime: { id: "extension-test" },
			tabs: {
				sendMessage: vi.fn(() => Promise.resolve({ ok: true, value: null })),
				onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
				onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
				query: vi.fn(() => Promise.resolve([{ id: 1 }])),
			},
			scripting: { executeScript: vi.fn() },
		};
		const [, , worker] = await initSession();

		sendWorkerAsyncRelay(worker, "relay-tab", "tab_click", "content-script", {
			tabPolicy: "required",
				params: { tabId: 1n, refId: "e1" },
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(globalThis.chrome.tabs.sendMessage).toHaveBeenCalledWith(
			1,
			expect.objectContaining({
				type: "registryCall",
				action: "tab_click",
			params: { tabId: 1n, refId: "e1" },
			}),
		);
	});

	it("routes a content-script-owned page handler through registryCall", async () => {
		globalThis.chrome = {
			runtime: { id: "extension-test" },
			tabs: {
				sendMessage: vi.fn(() => Promise.resolve({ ok: true, value: null })),
				onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
				onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
				query: vi.fn(() => Promise.resolve([{ id: 1 }])),
			},
			scripting: { executeScript: vi.fn() },
		};
		const [, , worker] = await initSession();
		setActiveTabId(1);
		await new Promise((resolve) => setTimeout(resolve, 0));

		sendWorkerAsyncRelay(worker, "relay-1", "page_click", "content-script");
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(globalThis.chrome.tabs.sendMessage).toHaveBeenCalledWith(
			1,
			expect.objectContaining({
				type: "registryCall",
				action: "page_click",
			}),
		);

		const relayResult = postMessages.find(
			(m): m is PostMessage => typeof m === "object" && m !== null && (m as PostMessage).type === "asyncRelayResult" && (m as PostMessage).id === "relay-1",
		);
		expect(relayResult).toMatchObject({
			type: "asyncRelayResult",
			id: "relay-1",
			result: { ok: true, value: null },
		});
	});

	it("posts registryCallCancel when worker relay is cancelled", async () => {
		globalThis.chrome = {
			runtime: { id: "extension-test" },
			tabs: {
				sendMessage: vi.fn(() => new Promise(() => {})),
				onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
				onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
				query: vi.fn(() => Promise.resolve([{ id: 1 }])),
			},
			scripting: { executeScript: vi.fn() },
		};
		const [, , worker] = await initSession();
		setActiveTabId(1);
		await new Promise((resolve) => setTimeout(resolve, 0));

		sendWorkerAsyncRelay(worker, "relay-cancel-1", "page_click", "content-script");
		await new Promise((resolve) => setTimeout(resolve, 0));

		if (worker.onmessage) {
			worker.onmessage({
				data: { type: "relayCancel", id: "relay-cancel-1" },
			} as MessageEvent);
		}
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(globalThis.chrome.tabs.sendMessage).toHaveBeenCalledWith(
			1,
			expect.objectContaining({ type: "registryCallCancel", id: "relay-cancel-1" }),
		);
	});

	it("init posts manifest entries with documentation metadata", async () => {
		await initSession();

		const initMsg = postMessages.find(
			(m): m is { type: string; manifest?: unknown[] } =>
				typeof m === "object" &&
				m !== null &&
				(m as { type?: string }).type === "init" &&
				Array.isArray((m as { manifest?: unknown[] }).manifest),
		);
		expect(initMsg?.manifest?.length).toBeGreaterThanOrEqual(130);

		for (const entry of initMsg?.manifest ?? []) {
			expect(entry).toMatchObject({
				action: expect.any(String),
				namespace: expect.any(String),
				name: expect.any(String),
				publicName: expect.any(String),
				description: expect.any(String),
				errorCode: expect.any(String),
				owner: expect.any(String),
				paramsDoc: expect.any(Array),
				returnsDoc: {
					type: expect.any(String),
					description: expect.any(String),
				},
				example: expect.any(String),
			});
			expect(
				entry.permission === undefined || typeof entry.permission === "string",
			).toBe(true);
		}
	});

	it("routes a main-thread sidepanel handler through dispatchTool", async () => {
		globalThis.chrome = {
			runtime: { id: "extension-test" },
			tabs: {
				onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
				onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
				query: vi.fn(() => Promise.resolve([{ id: 1 }])),
			},
		};
		const [, , worker] = await initSession();
		sendWorkerAsyncRelay(worker, "relay-2", "sidepanel_url", "main-thread");
		await new Promise((resolve) => setTimeout(resolve, 0));

		const relayResult = postMessages.find(
			(m): m is PostMessage =>
				typeof m === "object" &&
				m !== null &&
				(m as PostMessage).type === "asyncRelayResult" &&
				(m as PostMessage).id === "relay-2",
		);
		expect(relayResult?.result).toMatchObject({ ok: true });
		if (
			relayResult &&
			typeof relayResult.result === "object" &&
			relayResult.result !== null &&
			"value" in relayResult.result
		) {
			expect(typeof (relayResult.result as { value: unknown }).value).toBe("string");
		}
	});
});
