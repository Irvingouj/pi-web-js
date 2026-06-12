import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/shared/logger.js", () => ({
	logger: {
		debug: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		info: vi.fn(),
		child: vi.fn(() => ({
			debug: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
			info: vi.fn(),
		})),
	},
}));

import { NetworkTracker } from "../src/main/runner/lib/network-tracker.js";

function createMockWebRequest() {
	const listeners: Record<string, Array<(...args: unknown[]) => void>> = {
		onBeforeRequest: [],
		onCompleted: [],
		onErrorOccurred: [],
	};

	return {
		onBeforeRequest: {
			addListener: vi.fn((cb: (...args: unknown[]) => void) =>
				listeners.onBeforeRequest.push(cb),
			),
			removeListener: vi.fn(),
		},
		onCompleted: {
			addListener: vi.fn((cb: (...args: unknown[]) => void) =>
				listeners.onCompleted.push(cb),
			),
			removeListener: vi.fn(),
		},
		onErrorOccurred: {
			addListener: vi.fn((cb: (...args: unknown[]) => void) =>
				listeners.onErrorOccurred.push(cb),
			),
			removeListener: vi.fn(),
		},
		_fireBeforeRequest: (details: { requestId: string; tabId: number }) => {
			for (const cb of listeners.onBeforeRequest) cb(details);
		},
		_fireCompleted: (details: { requestId: string; tabId: number }) => {
			for (const cb of listeners.onCompleted) cb(details);
		},
		_fireError: (details: { requestId: string; tabId: number }) => {
			for (const cb of listeners.onErrorOccurred) cb(details);
		},
	};
}

describe("NetworkTracker", () => {
	let mockWebRequest: ReturnType<typeof createMockWebRequest>;
	let originalChrome: typeof globalThis.chrome;

	beforeEach(() => {
		mockWebRequest = createMockWebRequest();
		originalChrome = globalThis.chrome;
		globalThis.chrome = {
			webRequest: mockWebRequest,
		} as unknown as typeof globalThis.chrome;
	});

	afterEach(() => {
		globalThis.chrome = originalChrome;
	});

	it("registers webRequest listeners on start", () => {
		const tracker = new NetworkTracker(42);
		tracker.start();
		expect(mockWebRequest.onBeforeRequest.addListener).toHaveBeenCalled();
		expect(mockWebRequest.onCompleted.addListener).toHaveBeenCalled();
		expect(mockWebRequest.onErrorOccurred.addListener).toHaveBeenCalled();
		tracker.dispose();
	});

	it("removes listeners on dispose", () => {
		const tracker = new NetworkTracker(42);
		tracker.start();
		tracker.dispose();
		expect(mockWebRequest.onBeforeRequest.removeListener).toHaveBeenCalled();
		expect(mockWebRequest.onCompleted.removeListener).toHaveBeenCalled();
		expect(mockWebRequest.onErrorOccurred.removeListener).toHaveBeenCalled();
	});

	it("waitForIdle resolves immediately when no requests are in flight", async () => {
		const tracker = new NetworkTracker(42);
		tracker.start();
		const start = Date.now();
		await tracker.waitForIdle(5000);
		const elapsed = Date.now() - start;
		// Should resolve after ~500ms quiet period (NETWORK_IDLE_QUIET_MS)
		expect(elapsed).toBeGreaterThanOrEqual(450);
		expect(elapsed).toBeLessThan(2000);
		tracker.dispose();
	});

	it("waitForIdle waits for in-flight requests to complete", async () => {
		const tracker = new NetworkTracker(42);
		tracker.start();

		// Simulate a request starting
		mockWebRequest._fireBeforeRequest({ requestId: "req-1", tabId: 42 });

		// waitForIdle should not resolve while request is in flight
		let resolved = false;
		const promise = tracker.waitForIdle(5000).then(() => {
			resolved = true;
		});

		// Wait a bit — should not have resolved yet
		await new Promise((r) => setTimeout(r, 300));
		expect(resolved).toBe(false);
		expect(tracker.pendingCount).toBe(1);

		// Complete the request
		mockWebRequest._fireCompleted({ requestId: "req-1", tabId: 42 });

		await promise;
		expect(resolved).toBe(true);
		expect(tracker.pendingCount).toBe(0);
		tracker.dispose();
	});

	it("waitForIdle rejects on timeout", async () => {
		const tracker = new NetworkTracker(42);
		tracker.start();

		// Start a request that never completes
		mockWebRequest._fireBeforeRequest({ requestId: "req-stuck", tabId: 42 });

		await expect(tracker.waitForIdle(200)).rejects.toThrow(
			"Network idle timeout",
		);
		tracker.dispose();
	});

	it("ignores requests from other tabs", async () => {
		const tracker = new NetworkTracker(42);
		tracker.start();

		// Request from a different tab
		mockWebRequest._fireBeforeRequest({ requestId: "req-other", tabId: 99 });

		// Should resolve immediately since our tab (42) has no requests
		const start = Date.now();
		await tracker.waitForIdle(5000);
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(2000);
		tracker.dispose();
	});
});
