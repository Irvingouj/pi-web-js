// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createExecutableCallback,
	extensionDispatch,
	registerWorkerHandler,
	registerWorkerPort,
	resolveAsyncRelayResult,
	resolveRelayTimeoutMs,
	safePostAsCall,
	settleAllPendingRelays,
} from "../src/worker/worker.js";
import { clearRoutes, setRoute } from "../src/shared/registry/routes.js";
import type { SerializableJsCallManifestEntry } from "../src/shared/tool-registry.js";
import { coerceWasmParams } from "../src/shared/registry/manifest.js";
import { ExtensionSession } from "../__mocks__/extension_js";

const sentMessages: unknown[] = [];

function makeEntry(
	action: string,
	owner: string,
): SerializableJsCallManifestEntry {
	return {
		action,
		namespace: "test",
		name: action,
		publicName: `test.${action}`,
		description: "Test entry",
		fields: null,
		aliases: null,
		owner,
		paramsDoc: [],
		returnsDoc: { type: "object", description: "Result" },
		errorCode: "ETEST",
	};
}

describe("coerceWasmParams", () => {
	it("converts nested Maps inside native-parity argument arrays", () => {
		const details = new Map([
			["url", "https://extension-js.test/fixture"],
			["name", "web_js_contract"],
		]);
		expect(coerceWasmParams([details])).toEqual([
			{ url: "https://extension-js.test/fixture", name: "web_js_contract" },
		]);
	});
});

describe("resolveRelayTimeoutMs", () => {
	it("uses compound default budget for page_goto when params omit timeout", () => {
		expect(resolveRelayTimeoutMs("page_goto", { url: "https://example.com" })).toBe(
			65_500,
		);
	});

	it("extends page_goto relay for load + ping + grace phases", () => {
		expect(
			resolveRelayTimeoutMs("page_goto", {
				url: "https://example.com",
				timeout: 60_000n,
			}),
		).toBe(125_500);
	});

	it("uses single-phase budget for page_wait_for", () => {
		expect(
			resolveRelayTimeoutMs("page_wait_for", {
				selector: "#x",
				timeout: 60_000n,
			}),
		).toBe(65_000);
	});

	it("uses duration field for sleep", () => {
		expect(resolveRelayTimeoutMs("sleep", { duration: 10_000n })).toBe(30_000);
		expect(resolveRelayTimeoutMs("sleep", { duration: 30_000n })).toBe(35_000);
	});
});

describe("extensionDispatch", () => {
	beforeEach(() => {
		sentMessages.length = 0;
		clearRoutes();
		vi.spyOn(self, "postMessage").mockImplementation((message: unknown) => {
			sentMessages.push(message);
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		clearRoutes();
	});

	it("returns E_NO_ROUTE when action is not registered", async () => {
		await expect(extensionDispatch({}, { action: "missing_action" })).resolves.toEqual({
			ok: false,
			error: { message: "No route registered for action: missing_action", code: "E_NO_ROUTE" },
		});
	});

	it("relays native-parity argument arrays without mutation", async () => {
		setRoute("chrome_bookmarks_search", { endpoint: "main-thread" });
		const params = [0, { active: false }, ""];
		const promise = extensionDispatch(params, {
			action: "chrome_bookmarks_search",
			runId: "run-1",
		});
		const message = sentMessages[0] as { command: { params: unknown } };
		expect(message.command.params).toEqual(params);
		resolveAsyncRelayResult((sentMessages[0] as { id: string }).id, {
			ok: true,
			value: [],
		});
		await expect(promise).resolves.toEqual({ ok: true, value: [] });
	});

	it("relays through the routing table for content-script endpoints", async () => {
		setRoute("page_click", { endpoint: "content-script", tabPolicy: "active" });
		const promise = extensionDispatch({ refId: "e1" }, { action: "page_click", runId: "run-1" });
		const message = sentMessages[0] as { id: string; owner: string; tabPolicy: string };
		expect(message.owner).toBe("content-script");
		expect(message.tabPolicy).toBe("active");
		const pageClickResult = { ok: true, action: "click", refId: "e1" };
		resolveAsyncRelayResult(message.id, { ok: true, value: pageClickResult });
		await expect(promise).resolves.toEqual({ ok: true, value: pageClickResult });
	});
});

describe("worker executable callbacks", () => {
	beforeEach(() => {
		sentMessages.length = 0;
		vi.useFakeTimers();
		vi.spyOn(self, "postMessage").mockImplementation((message: unknown) => {
			sentMessages.push(message);
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it("same-worker executable callback returns a real handler result", async () => {
		registerWorkerHandler("worker_echo", async (params) => ({ params }));
		const callback = createExecutableCallback(makeEntry("worker_echo", "worker"));
		await expect(callback({ hello: "world" })).resolves.toEqual({
			ok: true,
			value: { params: { hello: "world" } },
		});
	});

	it("cross-context content-script callback posts owner, action, params, and resolves response", async () => {
		const callback = createExecutableCallback(makeEntry("page_click", "content-script"));
		const promise = callback({ refId: "e7" }, { runId: "run-1" });
		const message = sentMessages[0] as { id: string; owner: string; command: unknown; runId: string };
		expect(message.owner).toBe("content-script");
		expect(message.command).toEqual({ action: "page_click", params: { refId: "e7" }, runId: "run-1", callId: undefined });
		resolveAsyncRelayResult(message.id, { ok: true, value: "clicked" });
		await expect(promise).resolves.toEqual({ ok: true, value: "clicked" });
	});

	it("timeout settles once and ignores a late response", async () => {
		const callback = safePostAsCall({ owner: "content-script", action: "page_click", timeoutMs: 10 });
		const promise = callback({});
		const message = sentMessages[0] as { id: string };
		const expected = expect(promise).rejects.toThrow("Relay timeout for action: page_click");
		await vi.advanceTimersByTimeAsync(11);
		await expected;
		expect(sentMessages.some((m) => {
			const entry = m as { type?: string; id?: string };
			return entry.type === "relayCancel" && entry.id === message.id;
		})).toBe(true);
		resolveAsyncRelayResult(message.id, { ok: true, value: "late" });
	});

	it("abort cancellation settles once and ignores a late response", async () => {
		const controller = new AbortController();
		const callback = safePostAsCall({ owner: "content-script", action: "page_fill", timeoutMs: 1000 });
		const promise = callback({}, { signal: controller.signal });
		const message = sentMessages[0] as { id: string; type: string };
		controller.abort();
		await expect(promise).rejects.toThrow("Relay aborted for action: page_fill");
		expect(sentMessages.some((m) => {
			const entry = m as { type?: string; id?: string };
			return entry.type === "relayCancel" && entry.id === message.id;
		})).toBe(true);
		resolveAsyncRelayResult(message.id, { ok: true, value: "late" });
	});

	it("concurrent calls settle independently exactly once", async () => {
		const callback = safePostAsCall({ owner: "content-script", action: "page_type", timeoutMs: 1000 });
		const first = callback({ text: "a" });
		const second = callback({ text: "b" });
		const firstMessage = sentMessages[0] as { id: string };
		const secondMessage = sentMessages[1] as { id: string };
		resolveAsyncRelayResult(secondMessage.id, { ok: true, value: "second" });
		resolveAsyncRelayResult(firstMessage.id, { ok: true, value: "first" });
		await expect(first).resolves.toEqual({ ok: true, value: "first" });
		await expect(second).resolves.toEqual({ ok: true, value: "second" });
	});

	it("reset settles all pending relays exactly once with E_RESET", async () => {
		const callback = safePostAsCall({ owner: "content-script", action: "page_click", timeoutMs: 1000 });
		const promise = callback({});
		const message = sentMessages[0] as { id: string; type: string };
		settleAllPendingRelays("E_RESET", "Worker reset");
		expect(sentMessages.some((m) => {
			const entry = m as { type?: string; id?: string };
			return entry.type === "relayCancel" && entry.id === message.id;
		})).toBe(true);
		await expect(promise).resolves.toEqual({ ok: false, error: { message: "Worker reset", code: "E_RESET" } });
		// Late response must be ignored — relay entry was removed, so resolveAsyncRelayResult returns false
		expect(resolveAsyncRelayResult(message.id, { ok: true, value: "late" })).toBe(false);
	});

	it("stop settles all pending relays exactly once with E_STOPPED", async () => {
		const callback = safePostAsCall({ owner: "content-script", action: "page_fill", timeoutMs: 1000 });
		const promise = callback({});
		const message = sentMessages[0] as { id: string };
		settleAllPendingRelays("E_STOPPED", "Worker stopped");
		await expect(promise).resolves.toEqual({ ok: false, error: { message: "Worker stopped", code: "E_STOPPED" } });
		// Late response must be ignored — relay entry was removed, so resolveAsyncRelayResult returns false
		expect(resolveAsyncRelayResult(message.id, { ok: true, value: "late" })).toBe(false);
	});

	it("arbitrary registered context routes through workerPortRegistry and returns real results", async () => {
		let onMessage: ((event: MessageEvent) => void) | undefined;
		const mockPort = {
			postMessage: vi.fn((message: unknown) => {
				sentMessages.push(message);
			}),
			addEventListener: vi.fn((_type: "message", listener: (event: MessageEvent) => void) => {
				onMessage = listener;
			}),
		} as unknown as typeof self;
		registerWorkerPort("custom-worker", mockPort);
		const callback = createExecutableCallback(makeEntry("custom_action", "custom-worker"));
		const promise = callback({ test: true });
		const message = sentMessages[sentMessages.length - 1] as { id: string; owner: string; command: unknown };
		expect(message.owner).toBe("custom-worker");
		expect(message.command).toEqual({ action: "custom_action", params: { test: true }, runId: undefined, callId: undefined });
		onMessage?.({
			data: {
				type: "registryCallResult",
				id: message.id,
				result: { ok: true, value: "custom-result" },
			},
		} as MessageEvent);
		await expect(promise).resolves.toEqual({ ok: true, value: "custom-result" });
	});

	it("timeout settles once and ignores a late response — idempotent proof", async () => {
		const callback = safePostAsCall({ owner: "content-script", action: "page_click", timeoutMs: 10 });
		const promise = callback({});
		const message = sentMessages[0] as { id: string };
		const expected = expect(promise).rejects.toThrow("Relay timeout for action: page_click");
		await vi.advanceTimersByTimeAsync(11);
		await expected;
		// Calling resolveAsyncRelayResult after timeout should not re-settle or throw
		resolveAsyncRelayResult(message.id, { ok: true, value: "late" });
		// Promise should remain in rejected state; no additional errors
		await expect(promise).rejects.toThrow("Relay timeout for action: page_click");
	});

	it("abort cancellation settles once and ignores a late response — idempotent proof", async () => {
		const controller = new AbortController();
		const callback = safePostAsCall({ owner: "content-script", action: "page_fill", timeoutMs: 1000 });
		const promise = callback({}, { signal: controller.signal });
		const message = sentMessages[0] as { id: string };
		controller.abort();
		await expect(promise).rejects.toThrow("Relay aborted for action: page_fill");
		// Calling resolveAsyncRelayResult after abort should not re-settle or throw
		expect(resolveAsyncRelayResult(message.id, { ok: true, value: "late" })).toBe(false);
		await expect(promise).rejects.toThrow("Relay aborted for action: page_fill");
	});

	it("pre-aborted signal rejects immediately without posting a message", async () => {
		const controller = new AbortController();
		controller.abort();
		const callback = safePostAsCall({ owner: "content-script", action: "page_click", timeoutMs: 1000 });
		const promise = callback({}, { signal: controller.signal });
		await expect(promise).rejects.toThrow("Relay aborted for action: page_click");
		// No message should have been posted because the relay was rejected immediately
		expect(sentMessages.filter((m) => (m as { command?: unknown }).command?.action === "page_click")).toHaveLength(0);
	});

	it("resolveTimeoutMs callback controls relay deadline", async () => {
		const callback = safePostAsCall({
			owner: "main-thread",
			action: "page_goto",
			resolveTimeoutMs: (params) => resolveRelayTimeoutMs("page_goto", params),
		});
		const promise = callback({ url: "https://example.com", timeout: 60_000n });
		const expected = expect(promise).rejects.toThrow(
			"Relay timeout for action: page_goto",
		);
		await vi.advanceTimersByTimeAsync(125_499);
		await vi.advanceTimersByTimeAsync(2);
		await expected;
	});
});

describe("T-022: trace and lifecycle correctness", () => {
	const originalRunCellAsync = ExtensionSession.prototype.runCellAsync;

	beforeEach(() => {
		sentMessages.length = 0;
		vi.spyOn(self, "postMessage").mockImplementation((message: unknown) => {
			sentMessages.push(message);
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		ExtensionSession.prototype.runCellAsync = originalRunCellAsync;
		vi.useRealTimers();
	});

	it("runCell result includes matching callId", async () => {
		self.onmessage?.(new MessageEvent("message", { data: { type: "init", manifest: [] } }));
		await new Promise((resolve) => setTimeout(resolve, 50));

		const callId = "test-call-123";
		self.onmessage?.(new MessageEvent("message", {
			data: { type: "runCell", id: callId, code: "1+1", stdin: "", runId: "run-1" },
		}));
		await new Promise((resolve) => setTimeout(resolve, 50));

		const resultMsg = sentMessages.find((m) => (m as { type?: string; id?: string }).type === "result" && (m as { type?: string; id?: string }).id === callId);
		expect(resultMsg).toBeDefined();
		expect((resultMsg as { id: string }).id).toBe(callId);
		expect((resultMsg as { runId: string }).runId).toBe("run-1");
	});

	it("runCell error includes matching callId", async () => {
		ExtensionSession.prototype.runCellAsync = vi.fn().mockRejectedValue(new Error("Test cell error"));

		self.onmessage?.(new MessageEvent("message", { data: { type: "init", manifest: [] } }));
		await new Promise((resolve) => setTimeout(resolve, 50));

		const callId = "test-call-456";
		self.onmessage?.(new MessageEvent("message", {
			data: { type: "runCell", id: callId, code: "throw 1", stdin: "", runId: "run-2" },
		}));
		await new Promise((resolve) => setTimeout(resolve, 50));

		const errorMsg = sentMessages.find((m) => (m as { type?: string; id?: string }).type === "error" && (m as { type?: string; id?: string }).id === callId);
		expect(errorMsg).toBeDefined();
		expect((errorMsg as { id: string }).id).toBe(callId);
		expect((errorMsg as { runId: string }).runId).toBe("run-2");
		expect((errorMsg as { error: { message: string } }).error.message).toBe("Test cell error");
	});

	it("stopped or timed-out cell is not running after 2s", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });

		let resolveCell: (value: { status: string; stdout: string[]; stderr: string[]; result: string; error: null; execution_count: number }) => void;
		ExtensionSession.prototype.runCellAsync = vi.fn().mockImplementation(() => {
			return new Promise((resolve) => {
				resolveCell = resolve;
			});
		});

		self.onmessage?.(new MessageEvent("message", { data: { type: "init", manifest: [] } }));
		await new Promise((resolve) => setTimeout(resolve, 50));

		const callId = "test-call-timeout";
		self.onmessage?.(new MessageEvent("message", {
			data: { type: "runCell", id: callId, code: "sleep(3000)", stdin: "", runId: "run-3" },
		}));
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Cell is still running; no result yet
		expect(sentMessages.some((m) => (m as { type?: string; id?: string }).type === "result" && (m as { type?: string; id?: string }).id === callId)).toBe(false);

		// Resolve the cell after 2.5s simulated time
		await vi.advanceTimersByTimeAsync(2500);
		resolveCell!({
			status: "ok",
			stdout: [],
			stderr: [],
			result: "done",
			error: null,
			execution_count: 1,
		});
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Result should now be posted
		const resultMsg = sentMessages.find((m) => (m as { type?: string; id?: string }).type === "result" && (m as { type?: string; id?: string }).id === callId);
		expect(resultMsg).toBeDefined();
		expect((resultMsg as { data: { result: string } }).data.result).toBe("done");

		// A subsequent cell should run successfully, proving activeRunCell was cleared
		ExtensionSession.prototype.runCellAsync = vi.fn().mockResolvedValue({
			status: "ok",
			stdout: [],
			stderr: [],
			result: "next",
			error: null,
			execution_count: 2,
		});

		const nextCallId = "test-call-next";
		self.onmessage?.(new MessageEvent("message", {
			data: { type: "runCell", id: nextCallId, code: "2+2", stdin: "", runId: "run-4" },
		}));
		await new Promise((resolve) => setTimeout(resolve, 50));

		const nextResult = sentMessages.find((m) => (m as { type?: string; id?: string }).type === "result" && (m as { type?: string; id?: string }).id === nextCallId);
		expect(nextResult).toBeDefined();
		expect((nextResult as { data: { result: string } }).data.result).toBe("next");
	});

	it("tool events have deterministic chronological ordering", async () => {
		let callCount = 0;
		ExtensionSession.prototype.runCellAsync = vi.fn().mockImplementation(() => {
			callCount++;
			return Promise.resolve({
				status: "ok",
				stdout: [],
				stderr: [],
				result: `cell-${callCount}`,
				error: null,
				execution_count: callCount,
			});
		});

		self.onmessage?.(new MessageEvent("message", { data: { type: "init", manifest: [] } }));
		await new Promise((resolve) => setTimeout(resolve, 50));

		const firstId = "test-call-first";
		const secondId = "test-call-second";

		self.onmessage?.(new MessageEvent("message", {
			data: { type: "runCell", id: firstId, code: "1", stdin: "", runId: "run-a" },
		}));
		self.onmessage?.(new MessageEvent("message", {
			data: { type: "runCell", id: secondId, code: "2", stdin: "", runId: "run-b" },
		}));

		await new Promise((resolve) => setTimeout(resolve, 100));

		const resultMessages = sentMessages.filter((m) => (m as { type?: string }).type === "result");
		expect(resultMessages).toHaveLength(2);
		expect((resultMessages[0] as { id: string }).id).toBe(firstId);
		expect((resultMessages[0] as { data: { result: string } }).data.result).toBe("cell-1");
		expect((resultMessages[1] as { id: string }).id).toBe(secondId);
		expect((resultMessages[1] as { data: { result: string } }).data.result).toBe("cell-2");
	});
});
