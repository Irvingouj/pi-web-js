import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearAllNetworkEntriesForTest,
	clearNetworkEntries,
	getNetworkEntry,
	initNetworkLogSession,
	listNetworkEntries,
} from "../src/main/runner/lib/network-log-store.js";

function createMockEvent() {
	const listeners: Array<(details: any) => void> = [];
	return {
		addListener: vi.fn((cb: (details: any) => void) => listeners.push(cb)),
		fire(details: any) {
			for (const cb of listeners) cb(details);
		},
	};
}

function createMockChrome() {
	return {
		runtime: { id: "test-extension" },
		tabs: {
			onRemoved: createMockEvent(),
		},
		webRequest: {
			onBeforeRequest: createMockEvent(),
			onBeforeSendHeaders: createMockEvent(),
			onHeadersReceived: createMockEvent(),
			onBeforeRedirect: createMockEvent(),
			onCompleted: createMockEvent(),
			onErrorOccurred: createMockEvent(),
		},
	};
}

describe("network log store", () => {
	let originalChrome: typeof globalThis.chrome;
	let mockChrome: ReturnType<typeof createMockChrome>;

	beforeEach(() => {
		vi.resetModules();
		clearAllNetworkEntriesForTest();
		originalChrome = globalThis.chrome;
		mockChrome = createMockChrome();
		globalThis.chrome = mockChrome as unknown as typeof globalThis.chrome;
		initNetworkLogSession();
	});

	afterEach(() => {
		clearAllNetworkEntriesForTest();
		globalThis.chrome = originalChrome;
	});

	it("captures full raw details and compact summaries for page-tab traffic", () => {
		const bytes = new TextEncoder().encode("hello=world").buffer;
		mockChrome.webRequest.onBeforeRequest.fire({
			requestId: "r1",
			tabId: 7,
			frameId: 0,
			parentFrameId: -1,
			url: "https://example.com/api",
			method: "POST",
			type: "xmlhttprequest",
			initiator: "https://example.com",
			documentUrl: "https://example.com/app",
			requestBody: { raw: [{ bytes }] },
			timeStamp: 1000,
		});
		mockChrome.webRequest.onBeforeSendHeaders.fire({
			requestId: "r1",
			tabId: 7,
			requestHeaders: [{ name: "authorization", value: "Bearer secret" }],
		});
		mockChrome.webRequest.onHeadersReceived.fire({
			requestId: "r1",
			tabId: 7,
			statusCode: 201,
			statusLine: "HTTP/2 201",
			responseHeaders: [{ name: "set-cookie", value: "sid=secret" }],
		});
		mockChrome.webRequest.onCompleted.fire({
			requestId: "r1",
			tabId: 7,
			statusCode: 201,
			statusLine: "HTTP/2 201",
			timeStamp: 1250,
		});

		const rows = listNetworkEntries(7);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			id: "n1",
			requestId: "r1",
			method: "POST",
			statusCode: 201,
			hasRequestHeaders: true,
			hasResponseHeaders: true,
			hasRequestBody: true,
			requestBodyKind: "raw",
			durationMs: 250,
		});
		expect(rows[0]).not.toHaveProperty("requestHeaders");

		const full = getNetworkEntry(7, rows[0].id);
		expect(full?.requestHeaders?.[0]?.value).toBe("Bearer secret");
		expect(full?.responseHeaders?.[0]?.value).toBe("sid=secret");
		expect(full?.requestBody).toMatchObject({ kind: "raw", text: "hello=world" });
	});

	it("defaults list() to backend-looking requests but keeps all captured traffic", () => {
		mockChrome.webRequest.onBeforeRequest.fire({
			requestId: "doc",
			tabId: 7,
			url: "https://example.com/",
			method: "GET",
			type: "main_frame",
			timeStamp: 1000,
		});
		mockChrome.webRequest.onBeforeRequest.fire({
			requestId: "api",
			tabId: 7,
			url: "https://example.com/api",
			method: "GET",
			type: "xmlhttprequest",
			timeStamp: 1001,
		});

		expect(listNetworkEntries(7).map((e) => e.requestId)).toEqual(["api"]);
		expect(listNetworkEntries(7, { all: true }).map((e) => e.requestId)).toEqual([
			"doc",
			"api",
		]);
	});

	it("keeps every raw request body part up to the body cap", () => {
		mockChrome.webRequest.onBeforeRequest.fire({
			requestId: "r1",
			tabId: 7,
			url: "https://example.com/api",
			method: "POST",
			type: "xmlhttprequest",
			requestBody: {
				raw: [
					{ bytes: new TextEncoder().encode("hello=").buffer },
					{ bytes: new TextEncoder().encode("world").buffer },
				],
			},
		});

		const [row] = listNetworkEntries(7);
		const full = getNetworkEntry(7, row.id);
		expect(full?.requestBody).toMatchObject({
			kind: "raw",
			text: "hello=world",
			originalBytesKnown: 11,
			truncated: false,
		});
	});

	it("attaches redirect completion data to the current hop for reused requestIds", () => {
		mockChrome.webRequest.onBeforeRequest.fire({
			requestId: "r1",
			tabId: 7,
			url: "https://example.com/old",
			method: "GET",
			type: "xmlhttprequest",
			timeStamp: 1000,
		});
		mockChrome.webRequest.onBeforeRedirect.fire({
			requestId: "r1",
			tabId: 7,
			statusCode: 302,
			statusLine: "HTTP/1.1 302 Found",
			redirectUrl: "https://example.com/new",
			timeStamp: 1010,
		});
		mockChrome.webRequest.onBeforeRequest.fire({
			requestId: "r1",
			tabId: 7,
			url: "https://example.com/new",
			method: "GET",
			type: "xmlhttprequest",
			timeStamp: 1020,
		});
		mockChrome.webRequest.onCompleted.fire({
			requestId: "r1",
			tabId: 7,
			statusCode: 200,
			statusLine: "HTTP/1.1 200 OK",
			timeStamp: 1040,
		});

		const rows = listNetworkEntries(7);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			url: "https://example.com/old",
			statusCode: 302,
			redirectUrl: "https://example.com/new",
			durationMs: 10,
		});
		expect(rows[1]).toMatchObject({
			url: "https://example.com/new",
			statusCode: 200,
			durationMs: 20,
		});
	});

	it("ignores tabId -1 and clears closed tabs", () => {
		mockChrome.webRequest.onBeforeRequest.fire({
			requestId: "extension",
			tabId: -1,
			url: "https://api.openai.com/",
			method: "POST",
			type: "xmlhttprequest",
		});
		mockChrome.webRequest.onBeforeRequest.fire({
			requestId: "page",
			tabId: 7,
			url: "https://example.com/api",
			method: "GET",
			type: "xmlhttprequest",
		});

		expect(listNetworkEntries(7)).toHaveLength(1);
		mockChrome.tabs.onRemoved.fire(7);
		expect(listNetworkEntries(7, { all: true })).toHaveLength(0);
	});

	it("keeps per-tab storage bounded", () => {
		for (let i = 0; i < 305; i++) {
			mockChrome.webRequest.onBeforeRequest.fire({
				requestId: `r${i}`,
				tabId: 7,
				url: `https://example.com/api/${i}`,
				method: "GET",
				type: "xmlhttprequest",
			});
		}

		const rows = listNetworkEntries(7);
		expect(rows).toHaveLength(300);
		expect(rows[0].requestId).toBe("r5");
		expect(getNetworkEntry(7, "n1")).toBeUndefined();
	});

	it("clears a tab explicitly", () => {
		mockChrome.webRequest.onBeforeRequest.fire({
			requestId: "r1",
			tabId: 7,
			url: "https://example.com/api",
			method: "GET",
			type: "xmlhttprequest",
		});
		clearNetworkEntries(7);
		expect(listNetworkEntries(7, { all: true })).toEqual([]);
	});
});
