// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ExtensionSession } from "./index.js";

describe("ExtensionSession fs namespace e2e", () => {
	let postMessages: unknown[] = [];
	let workerInstances: any[] = [];
	let sessions: ExtensionSession[] = [];

	beforeEach(() => {
		postMessages = [];
		workerInstances = [];
		sessions = [];

		vi.stubGlobal(
			"Worker",
			vi.fn(() => {
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
			}),
		);
		vi.stubGlobal(
			"URL",
			vi.fn(() => ({ toString: () => "mock-worker-url" })),
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

	async function initSession(): Promise<[ExtensionSession, Promise<void>, any]> {
		const initPromise = ExtensionSession.init();

		queueMicrotask(() => {
			const latestWorker = workerInstances[workerInstances.length - 1];
			if (latestWorker && latestWorker.onmessage) {
				latestWorker.onmessage({
					data: { type: "ready" },
				} as MessageEvent);
			}
		});

		const [session, runner] = await initPromise;
		sessions.push(session);
		const worker = workerInstances[workerInstances.length - 1];
		return [session, runner, worker];
	}

	function sendWorkerResult(worker: any, id: string, data: unknown) {
		if (worker.onmessage) {
			worker.onmessage({
				data: { type: "result", id, data },
			} as MessageEvent);
		}
	}

	function sendWorkerError(worker: any, id: string, error: string) {
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

	it.each(fsTestCases)(
		"$action sends correct fsCall message and resolves",
		async ({ action, params, result }) => {
			const [session, , worker] = await initSession();

			const fsMethod = (session.fs as any)[action];
			const promise = fsMethod(params);

			const fsCallMsg = postMessages.find(
				(m: any) => m.type === "fsCall" && m.action === action,
			);
			expect(fsCallMsg).toBeDefined();
			expect(fsCallMsg).toMatchObject({
				type: "fsCall",
				action,
				params,
			});

			sendWorkerResult(worker, (fsCallMsg as any).id, result);
			const actualResult = await promise;
			expect(actualResult).toEqual(result);
		},
	);

	it("handles unknown fs action error from worker", async () => {
		const [session, , worker] = await initSession();

		const existsPromise = session.fs.exists({ path: "/test" });

		const fsCallMsg = postMessages.find(
			(m: any) => m.type === "fsCall" && m.action === "exists",
		);
		expect(fsCallMsg).toBeDefined();

		sendWorkerError(worker, (fsCallMsg as any).id, "Unknown fs action: exists");

		await expect(existsPromise).rejects.toThrow("Unknown fs action: exists");
	});
});
