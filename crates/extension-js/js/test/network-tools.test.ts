import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

vi.mock("../src/shared/main/logger.js", () => ({
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

function createMockEvent() {
	const listeners: Array<(details: any) => void> = [];
	return {
		addListener: vi.fn((cb: (details: any) => void) => listeners.push(cb)),
		removeListener: vi.fn(),
		fire(details: any) {
			for (const cb of listeners) cb(details);
		},
	};
}

function createMockChrome() {
	return {
		runtime: { id: "test-extension" },
		tabs: {
			query: vi.fn(() => Promise.resolve([{ id: 7 }])),
			onActivated: createMockEvent(),
			onUpdated: createMockEvent(),
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

let dispatchTool: typeof import("../src/shared/main/tool-registry.js").dispatchTool;
let clearAllNetworkEntriesForTest: typeof import("../src/main/runner/lib/network-log-store.js").clearAllNetworkEntriesForTest;
let initNetworkLogSession: typeof import("../src/main/runner/lib/network-log-store.js").initNetworkLogSession;
let mockChrome: ReturnType<typeof createMockChrome>;
let originalChrome: typeof globalThis.chrome;

describe("network tools", () => {
	beforeAll(async () => {
		await import("../src/main/runner/index.js");
		({ dispatchTool } = await import("../src/shared/main/tool-registry.js"));
		({ clearAllNetworkEntriesForTest, initNetworkLogSession } = await import(
			"../src/main/runner/lib/network-log-store.js"
		));
	});

	beforeEach(() => {
		originalChrome = globalThis.chrome;
		mockChrome = createMockChrome();
		globalThis.chrome = mockChrome as unknown as typeof globalThis.chrome;
		clearAllNetworkEntriesForTest();
		initNetworkLogSession();
	});

	afterEach(() => {
		clearAllNetworkEntriesForTest();
		globalThis.chrome = originalChrome;
	});

	it("page.network list/get/clear use the active tab", async () => {
		mockChrome.webRequest.onBeforeRequest.fire({
			requestId: "r1",
			tabId: 7,
			url: "https://example.com/api",
			method: "POST",
			type: "xmlhttprequest",
			requestBody: {
				raw: [{ bytes: new TextEncoder().encode("hello=world").buffer }],
			},
			timeStamp: 1000,
		});
		mockChrome.webRequest.onCompleted.fire({
			requestId: "r1",
			tabId: 7,
			statusCode: 200,
			statusLine: "HTTP/1.1 200 OK",
			timeStamp: 1010,
		});

		const listResult = await dispatchTool(
			"page_network_list",
			{},
			{ action: "page_network_list" },
		);
		expect(listResult.ok).toBe(true);
		const rows = (listResult as { ok: true; value: Array<{ id: string }> })
			.value;
		expect(rows).toHaveLength(1);
		expect(mockChrome.tabs.query).toHaveBeenCalledWith({ active: true });

		const getResult = await dispatchTool("page_network_get", rows[0].id, {
			action: "page_network_get",
		});
		expect(getResult.ok).toBe(true);
		expect(
			(getResult as { ok: true; value: any }).value.requestBody,
		).toMatchObject({
			kind: "raw",
			text: "hello=world",
		});

		const clearResult = await dispatchTool(
			"page_network_clear",
			{},
			{ action: "page_network_clear" },
		);
		expect(clearResult.ok).toBe(true);
		const emptyResult = await dispatchTool(
			"page_network_list",
			{ all: true },
			{ action: "page_network_list" },
		);
		expect((emptyResult as { ok: true; value: unknown[] }).value).toEqual([]);
	});

	it("web.tab.network requires and uses the explicit tabId", async () => {
		mockChrome.webRequest.onBeforeRequest.fire({
			requestId: "r1",
			tabId: 9,
			url: "https://example.com/api",
			method: "GET",
			type: "xmlhttprequest",
		});

		const listResult = await dispatchTool(
			"tab_network_list",
			{ tabId: 9 },
			{ action: "tab_network_list" },
		);
		expect(listResult.ok).toBe(true);
		const rows = (listResult as { ok: true; value: Array<{ id: string }> })
			.value;
		expect(rows).toHaveLength(1);

		const getResult = await dispatchTool(
			"tab_network_get",
			{
				tabId: 9,
				id: rows[0].id,
			},
			{ action: "tab_network_get" },
		);
		expect(getResult.ok).toBe(true);
		expect((getResult as { ok: true; value: any }).value.url).toBe(
			"https://example.com/api",
		);
		expect(mockChrome.tabs.query).not.toHaveBeenCalled();

		const clearResult = await dispatchTool(
			"tab_network_clear",
			{ tabId: 9 },
			{ action: "tab_network_clear" },
		);
		expect(clearResult.ok).toBe(true);
		expect(
			(await dispatchTool(
				"tab_network_list",
				{ tabId: 9, all: true },
				{ action: "tab_network_list" },
			)) as {
				ok: true;
				value: unknown[];
			},
		).toMatchObject({ value: [] });
	});
});
