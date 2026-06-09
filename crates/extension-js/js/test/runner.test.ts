// @vitest-environment jsdom

import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// ─── Mocks ───────────────────────────────────────────────────────

// @pi-oxide/dom-semantic-tree is aliased to ./__mocks__/dom-semantic-tree.js via vitest.config.ts

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
			timer: vi.fn(() => vi.fn()),
		})),
		timer: vi.fn(() => vi.fn()),
	},
	setLogLevel: vi.fn(),
	getLogLevel: vi.fn(() => "error"),
	registerWasmSetLogLevel: vi.fn(),
	Logger: class MockLogger {
		debug = vi.fn();
		error = vi.fn();
		warn = vi.fn();
		info = vi.fn();
		child = vi.fn(() => new MockLogger());
		timer = vi.fn(() => vi.fn());
	},
}));

const mockChrome = {
	runtime: { id: "test-extension-id" },
	tabs: {
		onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
		onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
		query: vi.fn(() => Promise.resolve([{ id: 1 }])),
		get: vi.fn(() => Promise.resolve({ id: 1, status: "complete" })),
		update: vi.fn(() => Promise.resolve({})),
		remove: vi.fn(() => Promise.resolve()),
		reload: vi.fn(() => Promise.resolve()),
		sendMessage: vi.fn(() => Promise.resolve({})),
		create: vi.fn(() => Promise.resolve({ id: 2 })),
	},
	scripting: {
		executeScript: vi.fn(() => Promise.resolve([{ result: "test" }])),
	},
	cookies: {
		get: vi.fn(() => Promise.resolve({ name: "test", value: "value" })),
		set: vi.fn(() => Promise.resolve({})),
		remove: vi.fn(() => Promise.resolve({})),
		getAll: vi.fn(() => Promise.resolve([])),
	},
	bookmarks: {
		search: vi.fn(() => Promise.resolve([])),
		create: vi.fn(() => Promise.resolve({ id: "1" })),
		remove: vi.fn(() => Promise.resolve()),
	},
	history: {
		search: vi.fn(() => Promise.resolve([])),
		deleteUrl: vi.fn(() => Promise.resolve()),
	},
	notifications: {
		create: vi.fn(() => Promise.resolve("notif-id")),
		clear: vi.fn(() => Promise.resolve(true)),
	},
	alarms: {
		create: vi.fn(() => Promise.resolve()),
		clear: vi.fn(() => Promise.resolve(true)),
	},
	action: {
		setBadgeText: vi.fn(() => Promise.resolve()),
		setBadgeBackgroundColor: vi.fn(() => Promise.resolve()),
		setTitle: vi.fn(() => Promise.resolve()),
		setIcon: vi.fn(() => Promise.resolve()),
	},
	contextMenus: {
		create: vi.fn(() => Promise.resolve()),
		remove: vi.fn(() => Promise.resolve()),
	},
	windows: {
		getAll: vi.fn(() => Promise.resolve([])),
		create: vi.fn(() => Promise.resolve({ id: 1 })),
		update: vi.fn(() => Promise.resolve({})),
		remove: vi.fn(() => Promise.resolve()),
	},
	sidePanel: {
		setOptions: vi.fn(() => Promise.resolve()),
	},
	tabGroups: {
		query: vi.fn(() => Promise.resolve([])),
		get: vi.fn(() => Promise.resolve({})),
		update: vi.fn(() => Promise.resolve({})),
	},
	sessions: {
		getRecentlyClosed: vi.fn(() => Promise.resolve([])),
		restore: vi.fn(() => Promise.resolve({})),
		getDevices: vi.fn(() => Promise.resolve([])),
	},
	downloads: {
		download: vi.fn(() => Promise.resolve(1)),
		search: vi.fn(() => Promise.resolve([])),
		pause: vi.fn(() => Promise.resolve()),
		resume: vi.fn(() => Promise.resolve()),
		cancel: vi.fn(() => Promise.resolve()),
		erase: vi.fn(() => Promise.resolve([])),
		open: vi.fn(() => Promise.resolve()),
		show: vi.fn(() => Promise.resolve()),
	},
	system: {
		cpu: {
			getInfo: vi.fn(() =>
				Promise.resolve({
					archName: "x86_64",
					modelName: "Test CPU",
					numOfProcessors: 4,
					features: [],
				}),
			),
		},
		memory: {
			getInfo: vi.fn(() =>
				Promise.resolve({
					capacity: 8589934592,
					availableCapacity: 4294967296,
				}),
			),
		},
		storage: {
			getInfo: vi.fn(() => Promise.resolve([])),
		},
	},
	permissions: {
		getAll: vi.fn(() => Promise.resolve({ permissions: [] })),
	},
};

// Extend existing tabs mock with group/ungroup
(mockChrome.tabs as any).group = vi.fn(() => Promise.resolve(1));
(mockChrome.tabs as any).ungroup = vi.fn(() => Promise.resolve());

function clearTestLocalStorage(): void {
	if (
		typeof localStorage !== "undefined" &&
		typeof localStorage.clear === "function"
	) {
		localStorage.clear();
		return;
	}
	if (typeof localStorage !== "undefined") {
		for (const key of Object.keys(localStorage)) {
			localStorage.removeItem(key);
		}
	}
}

const ALL_MANIFEST_PERMISSIONS = [
	"alarms",
	"bookmarks",
	"browsingData",
	"contextMenus",
	"cookies",
	"declarativeNetRequest",
	"desktopCapture",
	"downloads",
	"history",
	"identity",
	"idle",
	"management",
	"notifications",
	"offscreen",
	"pageCapture",
	"scripting",
	"sessions",
	"sidePanel",
	"storage",
	"system.cpu",
	"tabGroups",
	"tabs",
	"topSites",
	"tts",
	"windows",
];

function chromeWithGrantedPermissions() {
	return {
		...mockChrome,
		permissions: {
			getAll: vi.fn(() =>
				Promise.resolve({ permissions: [...ALL_MANIFEST_PERMISSIONS] }),
			),
		},
	};
}

async function stubChromeWithGrantedPermissions(): Promise<void> {
	resetCapabilities();
	vi.stubGlobal("chrome", chromeWithGrantedPermissions());
	await initCapabilities();
}

// ─── Imports ─────────────────────────────────────────────────────

import { logger } from "../src/shared/logger.js";
// runner.ts registers all tools at module load time; initExtensionListeners()
// is a no-op because chrome is not yet stubbed.  We stub it before tests
// that need it.
import {
	executeMainThreadCommand,
	normalizeParams,
	registerHostHandler,
	registerHostHandlers,
} from "../src/main/runner/index.js";
import {
	pingTabContentScript,
	waitForTabLoad,
} from "../src/main/runner/runtime.js";
import { buildSnapshotInTab } from "../src/main/runner/dom/snapshot.js";
import {
	initCapabilities,
	resetCapabilities,
} from "../src/main/runner/tools/chrome/capability.js";

import {
	clearJsRegistry,
	clearRegistry,
	dispatchTool,
	freezeJsRegistry,
	getSerializableJsManifest,
	getTool,
	listTools,
	registerJsCall,
	setRunnerAbortController,
	throwIfAborted,
} from "../src/shared/tool-registry.js";
import {
	dispatchContentScriptCall,
	registerContentScriptSpec,
} from "../src/content-script/registry.js";
import {
	addContentScriptAction,
	getContentScriptActions,
} from "../src/shared/registry/content-script-actions.js";
import { buildContentScriptSpecs } from "../src/content-script/schemas.js";
import { handlers } from "../src/content-script/handlers.js";

// ─── Polyfills ───────────────────────────────────────────────────

if (typeof globalThis.CSS === "undefined" || !globalThis.CSS.escape) {
	(globalThis as unknown as Record<string, unknown>).CSS = {
		escape: (s: string) => s.replace(/([.*+?^${}()|[\]\\])/g, "\\$1"),
	};
}

// Mock localStorage for test environments where it is unavailable
function createMockLocalStorage(): Storage {
	const store = new Map<string, string>();
	return {
		get length() {
			return store.size;
		},
		key(index: number): string | null {
			const keys = Array.from(store.keys());
			return keys[index] ?? null;
		},
		getItem(key: string): string | null {
			return store.get(key) ?? null;
		},
		setItem(key: string, value: string): void {
			store.set(key, value);
		},
		removeItem(key: string): void {
			store.delete(key);
		},
		clear(): void {
			store.clear();
		},
	} as Storage;
}

if (typeof globalThis.localStorage === "undefined") {
	Object.defineProperty(globalThis, "localStorage", {
		value: createMockLocalStorage(),
		writable: true,
		configurable: true,
	});
}

// ─── Helpers ─────────────────────────────────────────────────────

function makeTestTool(
	action: string,
	handler?: (p: unknown) => Promise<unknown>,
) {
	return {
		action,
		namespace: "test",
		description: "Test tool",
		params: z.object({}),
		returns: z.unknown(),
		handler: handler ?? (async () => null),
		paramTypes: [],
		returnDoc: "null",
		errorCode: "ETEST",
	};
}

function registerTestTool(tool: ReturnType<typeof makeTestTool>): void {
	registerJsCall({
		action: tool.action,
		namespace: tool.namespace,
		name: tool.action,
		description: tool.description,
		params: tool.params,
		returns: tool.returns,
		owner: "main-thread",
		handler: (params) => tool.handler(params),
		paramTypes: tool.paramTypes,
		returnDoc: tool.returnDoc,
		errorCode: tool.errorCode,
	});
}

// ─── 1. normalizeParams tests ──────────────────────────────────

describe("normalizeParams", () => {
	// Element actions no longer have array normalizers (WU-5)
	const arrayActions = [
		"tab_press",
		"tab_unhover",
		"tab_scroll",
		"tab_back",
		"tab_wait_for_load",
		"tab_evaluate",
		"tab_fetch",
		"tab_snapshot",
		"tab_snapshot_text",
		"tab_snapshot_data",
	];

	it.each(arrayActions)("%s converts array params to object", (action) => {
		const result = normalizeParams(action, [42, "e1", "extra"]);
		expect(result).toBeDefined();
		expect(typeof result).toBe("object");
		expect(Array.isArray(result)).toBe(false);
	});

	it("tab_scroll array normalizer uses defaults", () => {
		const result = normalizeParams("tab_scroll", [42]);
		expect(result).toEqual({ tabId: 42, direction: "down", amount: 300 });
	});

	it("tab_wait_for_load array normalizer uses default timeout", () => {
		const result = normalizeParams("tab_wait_for_load", [42]);
		expect(result).toEqual({ tabId: 42, timeout: 30000n });
	});

	it("tab_snapshot array normalizer produces correct shape", () => {
		const result = normalizeParams("tab_snapshot", [42]);
		expect(result).toEqual({ tabId: 42, options: {} });
	});

	it("tab_back scalar normalizer converts number to object", () => {
		const result = normalizeParams("tab_back", 42);
		expect(result).toEqual({ tabId: 42 });
	});

	it("tab_unhover scalar normalizer converts number to object", () => {
		const result = normalizeParams("tab_unhover", 42);
		expect(result).toEqual({ tabId: 42 });
	});

	it("tab_wait_for_load scalar normalizer converts number to object", () => {
		const result = normalizeParams("tab_wait_for_load", 42);
		expect(result).toEqual({ tabId: 42 });
	});

	it("tab_scroll scalar normalizer converts number to object", () => {
		const result = normalizeParams("tab_scroll", 42);
		expect(result).toEqual({ tabId: 42 });
	});

	it("tab_create string normalizer converts url string to object", () => {
		expect(normalizeParams("tab_create", "https://example.com")).toEqual({
			url: "https://example.com",
		});
		expect(normalizeParams("page_new_tab", "https://example.com")).toEqual({
			url: "https://example.com",
		});
	});

	it("element action arrays pass through unchanged (rejected by schema)", () => {
		expect(normalizeParams("tab_click", [42, "e1"])).toEqual([42, "e1"]);
		expect(normalizeParams("tab_fill", [42, "e1", "hello"])).toEqual([
			42,
			"e1",
			"hello",
		]);
		expect(normalizeParams("tab_type", [42, "e1", "hi"])).toEqual([
			42,
			"e1",
			"hi",
		]);
	});

	it("non-array/non-scalar params pass through unchanged", () => {
		const obj = { foo: "bar" };
		expect(normalizeParams("tab_press", obj)).toBe(obj);
		expect(normalizeParams("some_other_action", [1, 2])).toEqual([1, 2]);
	});

	it("page_find string normalizer maps selector", () => {
		expect(normalizeParams("page_find", "h1")).toEqual({ selector: "h1" });
	});

	it("page_wait_for array normalizer maps selector and timeout", () => {
		expect(normalizeParams("page_wait_for", ["#submit", 5000])).toEqual({
			selector: "#submit",
			timeout: 5000,
		});
	});

	it("page_extract array normalizer maps fields", () => {
		expect(normalizeParams("page_extract", ["title", "url"])).toEqual({
			fields: ["title", "url"],
		});
	});

	it("sidepanel_press string normalizer maps key", () => {
		expect(normalizeParams("sidepanel_press", "Enter")).toEqual({
			key: "Enter",
		});
	});

	it("sidepanel_wait scalar normalizer maps duration", () => {
		expect(normalizeParams("sidepanel_wait", 1000)).toEqual({
			duration: 1000,
		});
	});

	it("storage_get_many array normalizer maps keys", () => {
		expect(normalizeParams("storage_get_many", ["a", "b"])).toEqual({
			keys: ["a", "b"],
		});
	});
});

// ─── 2. Abort behavior tests ─────────────────────────────────────

describe("abort behavior", () => {
	afterEach(() => {
		setRunnerAbortController(null);
	});

	it("throwIfAborted throws when abort controller is aborted", () => {
		const controller = new AbortController();
		setRunnerAbortController(controller);
		controller.abort();
		expect(() => throwIfAborted()).toThrow(
			"Runner aborted: ExtensionSession stopped",
		);
	});

	it("throwIfAborted does not throw when not aborted", () => {
		const controller = new AbortController();
		setRunnerAbortController(controller);
		expect(() => throwIfAborted()).not.toThrow();
	});

	it("executeMainThreadCommand throws when aborted before dispatch", async () => {
		const controller = new AbortController();
		setRunnerAbortController(controller);
		controller.abort();
		await expect(
			executeMainThreadCommand({ action: "sleep", params: { duration: 100n } }),
		).rejects.toThrow("Runner aborted: ExtensionSession stopped");
	});

	it("dispatchTool throws when aborted before handler", async () => {
		const actionName = `test_abort_dispatch_${Math.random().toString(36).slice(2)}`;
		registerTestTool(makeTestTool(actionName));
		const controller = new AbortController();
		setRunnerAbortController(controller);
		controller.abort();
		await expect(dispatchTool(actionName, {})).rejects.toThrow(
			"Runner aborted: ExtensionSession stopped",
		);
	});
});

// ─── 3. Error code preservation tests ────────────────────────────

describe("error code preservation", () => {
	it("unknown action returns E_UNKNOWN", async () => {
		const result = await dispatchTool("totally_unknown_action_xyz", {});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_UNKNOWN");
		}
	});

	it("invalid params return E_INVALID_PARAMS", async () => {
		// storage_get requires { key: string }
		const result = await dispatchTool("storage_get", { key: 123 });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
		}
	});

	it("chrome passthrough without extension context returns E_NO_EXTENSION", async () => {
		// Remove chrome stub so runner.ts sees no extension context
		const originalChrome = globalThis.chrome;
		vi.stubGlobal("chrome", undefined);
		const result = await dispatchTool("chrome_tabs_query", [{}]);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_NO_EXTENSION");
		}
		vi.stubGlobal("chrome", originalChrome);
	});
});

// ─── 4. Schema validation tests ──────────────────────────────────

describe("schema validation", () => {
	beforeEach(async () => {
		await stubChromeWithGrantedPermissions();
	});

	it("valid params pass zod validation", async () => {
		const result = await dispatchTool("storage_set", {
			key: "valid_key",
			value: "valid_value",
		});
		expect(result.ok).toBe(true);
	});

	it("invalid params fail with sanitized error messages (no raw input values)", async () => {
		const result = await dispatchTool("storage_set", {
			key: "valid_key",
			value: 12345,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			// The error message should mention the API name, field path, and issue,
			// but should NOT contain the raw invalid value in a way that leaks sensitive data.
			expect(result.error.message).toContain("Invalid parameters for storage_set");
			expect(result.error.message).toContain("at 'value'");
			expect(result.error.message).toContain("Expected string, received number");
			expect(result.error.message).not.toContain("12345");
		}
	});

	it("clipboard_write accepts array-with-object form", async () => {
		const result = await dispatchTool("clipboard_write", [{ text: "hello" }]);
		// It will fail because navigator.clipboard is not mocked, but params should validate
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).not.toBe("E_INVALID_PARAMS");
		}
	});

	it("clipboard_write accepts array-with-string form", async () => {
		const result = await dispatchTool("clipboard_write", ["hello"]);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).not.toBe("E_INVALID_PARAMS");
		}
	});

	it("clipboard_write accepts object-with-text form", async () => {
		const result = await dispatchTool("clipboard_write", { text: "hello" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).not.toBe("E_INVALID_PARAMS");
		}
	});

	it("clipboard_write accepts object-with-value form", async () => {
		const result = await dispatchTool("clipboard_write", { value: "hello" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).not.toBe("E_INVALID_PARAMS");
		}
	});
});

// ─── 4b. WU-9: Actionable validation errors ────────────────────────

describe("WU-9: actionable validation errors", () => {
	beforeEach(() => {
		vi.stubGlobal("chrome", mockChrome);
		vi.clearAllMocks();
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
	});

	it("page_unhover with string param shows API name and expected shape", async () => {
		const result = await dispatchContentScriptCall(
			"page_unhover",
			"unhover",
			handlers.unhover,
			"x",
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toContain("Invalid parameters for page_unhover");
			expect(result.error.message).toContain("expected { } or no args");
			expect(result.error.message).toContain("received string");
		}
	});

	it("mock_async with number param shows accepted union alternatives", async () => {
		const result = await dispatchTool("mock_async", 123);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toContain("Invalid parameters for mock_async");
			expect(result.error.message).toContain("expected string or { label?: string }");
			expect(result.error.message).toContain("received number");
		}
	});

	it("nested path errors show actual path instead of empty string", async () => {
		const result = await dispatchTool("page_extract", {
			fields: [123],
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toContain("Invalid parameters for page_extract");
			expect(result.error.message).toContain("at 'fields.0'");
			expect(result.error.message).toContain("Expected string, received number");
		}
	});
});

// ─── 5. Integration tests ────────────────────────────────────────

describe("integration", () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		await stubChromeWithGrantedPermissions();
		clearTestLocalStorage();
	});

	it("executeMainThreadCommand dispatches through registry for a real action", async () => {
		const result = await executeMainThreadCommand({
			action: "storage_set",
			params: { key: "integration_test_key", value: "integration_test_value" },
		});
		expect(result.ok).toBe(true);
	});

	it("host_* prefix routing works", async () => {
		registerHostHandler("foo", async (params) => {
			return { handled: true, params };
		});
		const result = await executeMainThreadCommand({
			action: "host_foo",
			params: { test: "data" },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ handled: true, params: { test: "data" } });
		}
	});

	it("alias actions work", async () => {
		// cookies_get is an alias for chrome_cookies_get
		const result = await executeMainThreadCommand({
			action: "cookies_get",
			params: [{ url: "https://example.com", name: "session" }],
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ name: "test", value: "value" });
		}
	});

	it("manifest registers at least 130 actions", () => {
		expect(getSerializableJsManifest().length).toBeGreaterThanOrEqual(130);
	});

	it("every tool has schema and documentation", () => {
		const tools = listTools();
		for (const tool of tools) {
			expect(tool.description).toBeTruthy();
			expect(tool.description.length).toBeGreaterThan(0);
			expect(Array.isArray(tool.params)).toBe(true);
			expect(tool.returns.description).toBeTruthy();
			expect(tool.errorCode).toBeTruthy();
		}
	});

	it("every registered tool has paramTypes on the underlying ToolDefinition", () => {
		const tools = listTools();
		for (const tool of tools) {
			const definition = getTool(tool.action);
			expect(definition).toBeDefined();
			expect(Array.isArray(definition?.paramTypes)).toBe(true);
		}
	});
});

// ─── 7. Storage tests ────────────────────────────────────────────

describe("storage", () => {
	const testKey = `runner_test_key_${Date.now()}`;

	beforeEach(async () => {
		vi.clearAllMocks();
		await stubChromeWithGrantedPermissions();
		clearTestLocalStorage();
	});

	it("storage_set + storage_get roundtrip", async () => {
		await dispatchTool("storage_set", { key: testKey, value: "roundtrip" });
		const result = await dispatchTool("storage_get", { key: testKey });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe("roundtrip");
		}
	});

	it("storage_delete removes key", async () => {
		const key = `${testKey}_del`;
		await dispatchTool("storage_set", { key, value: "x" });
		await dispatchTool("storage_delete", { key });
		const result = await dispatchTool("storage_get", { key });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBeNull();
		}
	});

	it("storage_list returns all keys", async () => {
		const key = `${testKey}_list`;
		await dispatchTool("storage_set", { key, value: "x" });
		const result = await dispatchTool("storage_list", {});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(Array.isArray(result.value)).toBe(true);
			expect(result.value).toContain(key);
		}
	});

	it("storage_clear removes only __csl__: keys", async () => {
		// Set a regular key and a __csl__ key
		await dispatchTool("storage_set", { key: "regular_key", value: "x" });
		await dispatchTool("storage_set_many", { mypref: "y" });

		await dispatchTool("storage_clear", {});

		const regularResult = await dispatchTool("storage_get", {
			key: "regular_key",
		});
		expect(regularResult.ok).toBe(true);
		if (regularResult.ok) {
			expect(regularResult.value).toBe("x"); // still there
		}

		const cslResult = await dispatchTool("storage_get_many", {
			keys: ["mypref"],
		});
		expect(cslResult.ok).toBe(true);
		if (cslResult.ok) {
			expect(cslResult.value.mypref).toBeNull(); // cleared
		}
	});
});

// ─── 8. Network tests ────────────────────────────────────────────

describe("network", () => {
	it("fetch returns full response object", async () => {
		globalThis.fetch = vi.fn(() =>
			Promise.resolve({
				status: 200,
				ok: true,
				headers: new Map([["content-type", "text/plain"]]),
				text: () => Promise.resolve("hello"),
			}),
		) as unknown as typeof fetch;

		const result = await dispatchTool("fetch", {
			url: "https://example.com",
			method: "GET",
			headers: {},
			body: null,
			timeout: 5000n,
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.status).toBe(200);
			expect(result.value.ok).toBe(true);
			expect(result.value.body).toBe("hello");
		}
	});
});

// ─── 9. Sidepanel tests ─────────────────────────────────────────

describe("sidepanel", () => {
	it("sidepanel_url accepts WASM Map params", async () => {
		const result = await dispatchTool("sidepanel_url", new Map());
		expect(result.ok).toBe(true);
	});

	it("sidepanel_url returns window.location.href", async () => {
		const result = await dispatchTool("sidepanel_url", {});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(typeof result.value).toBe("string");
		}
	});

	it("sidepanel_title returns document.title", async () => {
		const result = await dispatchTool("sidepanel_title", {});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(typeof result.value).toBe("string");
		}
	});

	it("sidepanel_wait returns true after duration", async () => {
		const start = Date.now();
		const result = await dispatchTool("sidepanel_wait", { duration: 50n });
		const elapsed = Date.now() - start;
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe(true);
		}
		expect(elapsed).toBeGreaterThanOrEqual(40);
	});

	it("sidepanel_click throws E_STALE when target element missing", async () => {
		const result = await dispatchTool("sidepanel_click", {
			refId: "e999",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_STALE");
		}
	});

	it("sidepanel_click returns E_INVALID_PARAMS for invalid refId formats", async () => {
		for (const badRefId of [2, "2", "btn"]) {
			const result = await dispatchTool("sidepanel_click", { refId: badRefId });
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe("E_INVALID_PARAMS");
			}
		}
	});
});

// ─── 10. Chrome passthrough tests ────────────────────────────────

describe("chrome passthrough", () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		await stubChromeWithGrantedPermissions();
	});

	it("rejects non-array transport with E_INVALID_ARGUMENT_TRANSPORT", async () => {
		const result = await dispatchTool("chrome_bookmarks_search", "query");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_ARGUMENT_TRANSPORT");
		}
		expect(mockChrome.bookmarks.search).not.toHaveBeenCalled();
	});

	it("chrome_bookmarks_search forwards empty object unchanged", async () => {
		const result = await dispatchTool("chrome_bookmarks_search", [{}]);
		expect(result.ok).toBe(true);
		expect(mockChrome.bookmarks.search).toHaveBeenCalledWith({});
	});

	it("chrome_bookmarks_search forwards string query unchanged", async () => {
		await dispatchTool("chrome_bookmarks_search", ["term"]);
		expect(mockChrome.bookmarks.search).toHaveBeenCalledWith("term");
	});

	it("chrome_bookmarks_search defaults empty args to {}", async () => {
		await dispatchTool("chrome_bookmarks_search", []);
		expect(mockChrome.bookmarks.search).toHaveBeenCalledWith({});
	});

	it("bookmarks_search alias forwards the same argument array", async () => {
		await dispatchTool("bookmarks_search", [{}]);
		expect(mockChrome.bookmarks.search).toHaveBeenCalledWith({});
	});

	it("chrome_tabs_query returns tab array", async () => {
		const result = await dispatchTool("chrome_tabs_query", [{ active: true }]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(Array.isArray(result.value)).toBe(true);
		}
		expect(mockChrome.tabs.query).toHaveBeenCalledWith({ active: true });
	});

	it("chrome_tabs_update preserves argument order and falsey values", async () => {
		await dispatchTool("chrome_tabs_update", [0, { active: false }]);
		expect(mockChrome.tabs.update).toHaveBeenCalledWith(0, { active: false });
	});

	it("chrome_cookies_get returns cookie", async () => {
		const details = { url: "https://example.com", name: "session" };
		const result = await dispatchTool("chrome_cookies_get", [details]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ name: "test", value: "value" });
		}
		expect(mockChrome.cookies.get).toHaveBeenCalledWith(details);
	});

	it("chrome_history_search returns history", async () => {
		const query = { text: "query" };
		const result = await dispatchTool("chrome_history_search", [query]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(Array.isArray(result.value)).toBe(true);
		}
		expect(mockChrome.history.search).toHaveBeenCalledWith(query);
	});

	it("chrome_notifications_create preserves empty notification id", async () => {
		const options = { title: "Test" };
		const result = await dispatchTool("chrome_notifications_create", [
			"",
			options,
		]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe("notif-id");
		}
		expect(mockChrome.notifications.create).toHaveBeenCalledWith("", options);
	});

	it("chrome_tabGroups_query returns array", async () => {
		const result = await dispatchTool("chrome_tabGroups_query", [{}]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(Array.isArray(result.value)).toBe(true);
		}
		expect(mockChrome.tabGroups.query).toHaveBeenCalledWith({});
	});

	it("chrome_sessions_getRecentlyClosed invokes zero-arg form", async () => {
		const result = await dispatchTool("chrome_sessions_getRecentlyClosed", []);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(Array.isArray(result.value)).toBe(true);
		}
		expect(mockChrome.sessions.getRecentlyClosed).toHaveBeenCalledWith();
	});

	it("chrome_downloads_download returns id", async () => {
		const options = { url: "https://example.com/file.zip" };
		const result = await dispatchTool("chrome_downloads_download", [options]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe(1);
		}
		expect(mockChrome.downloads.download).toHaveBeenCalledWith(options);
	});

	it("chrome_system_cpu_getInfo returns object", async () => {
		const result = await dispatchTool("chrome_system_cpu_getInfo", []);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(typeof result.value).toBe("object");
		}
		expect(mockChrome.system.cpu.getInfo).toHaveBeenCalledWith();
	});

	it("history_delete alias normalizes string url to chrome object arg", async () => {
		const result = await dispatchTool("history_delete", ["https://example.com"]);
		expect(result.ok).toBe(true);
		expect(mockChrome.history.deleteUrl).toHaveBeenCalledWith({
			url: "https://example.com",
		});
	});

	it("history_delete alias normalizes via executeMainThreadCommand", async () => {
		const result = await executeMainThreadCommand({
			action: "history_delete",
			params: ["https://example.com"],
			call_id: 1,
		});
		expect(result.ok).toBe(true);
		expect(mockChrome.history.deleteUrl).toHaveBeenCalledWith({
			url: "https://example.com",
		});
	});

	it("bookmarks_search alias normalizes string query", async () => {
		const result = await dispatchTool("bookmarks_search", ["example"]);
		expect(result.ok).toBe(true);
		expect(mockChrome.bookmarks.search).toHaveBeenCalledWith({
			query: "example",
		});
	});

	it("notifications_create alias normalizes wrapper object to native args", async () => {
		const options = { type: "basic", title: "Hello", message: "World" };
		const result = await dispatchTool("notifications_create", [
			{ id: "test-id", options },
		]);
		expect(result.ok).toBe(true);
		expect(mockChrome.notifications.create).toHaveBeenCalledWith(
			"test-id",
			options,
		);
	});

	it("notifications_create alias normalizes via executeMainThreadCommand", async () => {
		const options = { type: "basic", title: "Hello", message: "World" };
		const result = await executeMainThreadCommand({
			action: "notifications_create",
			params: [{ id: "test-id", options }],
			call_id: 1,
		});
		expect(result.ok).toBe(true);
		expect(mockChrome.notifications.create).toHaveBeenCalledWith(
			"test-id",
			options,
		);
	});
});

// ─── 10b. Capability gating tests ────────────────────────────────

describe("capability gating", () => {
	beforeEach(() => {
		resetCapabilities();
	});

	afterEach(() => {
		resetCapabilities();
		vi.unstubAllGlobals();
	});

	it("missing chrome namespace returns E_PERMISSION when permission not granted", async () => {
		const minimalChrome = {
			...mockChrome,
			notifications: undefined,
			permissions: {
				getAll: vi.fn(() => Promise.resolve({ permissions: [] })),
			},
		};
		vi.stubGlobal("chrome", minimalChrome);
		await initCapabilities();
		const result = await dispatchTool("chrome_notifications_create", ["", { title: "Test" }]);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_PERMISSION");
			expect(result.error.message).toContain("notifications");
		}
	});

	it("missing chrome namespace returns E_UNAVAILABLE when permission is granted", async () => {
		const minimalChrome = {
			...mockChrome,
			notifications: undefined,
			permissions: {
				getAll: vi.fn(() => Promise.resolve({ permissions: ["notifications"] })),
			},
		};
		vi.stubGlobal("chrome", minimalChrome);
		await initCapabilities();
		const result = await dispatchTool("chrome_notifications_create", ["", { title: "Test" }]);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_UNAVAILABLE");
			expect(result.error.message).toContain("chrome.notifications");
		}
	});

	it("manifestPermissionForApiPath maps system sub-apis", async () => {
		const { manifestPermissionForApiPath } = await import(
			"../src/main/runner/tools/chrome/capability.js"
		);
		expect(manifestPermissionForApiPath(["system", "cpu"])).toBe("system.cpu");
		expect(manifestPermissionForApiPath(["system", "memory"])).toBe(
			"system.memory",
		);
		expect(manifestPermissionForApiPath(["system", "storage"])).toBe(
			"system.storage",
		);
	});

	it("refreshCapabilities runs after chrome.permissions.request", async () => {
		const getAllFn = vi
			.fn()
			.mockResolvedValueOnce({ permissions: [] })
			.mockResolvedValue({ permissions: ["notifications"] });
		const requestFn = vi.fn(() => Promise.resolve(true));
		const chrome = {
			...mockChrome,
			permissions: {
				getAll: getAllFn,
				request: requestFn,
			},
			runtime: {
				...mockChrome.runtime,
				getManifest: vi.fn(() => ({ permissions: [] })),
			},
		};
		vi.stubGlobal("chrome", chrome);
		await initCapabilities();
		const blocked = await dispatchTool("notifications_create", [
			"",
			{ title: "Test" },
		]);
		expect(blocked.ok).toBe(false);
		const result = await dispatchTool("chrome_permissions_request", [
			{ permissions: ["notifications"] },
		]);
		expect(result.ok).toBe(true);
		expect(requestFn).toHaveBeenCalled();
		expect(getAllFn.mock.calls.length).toBeGreaterThanOrEqual(2);
		const allowed = await dispatchTool("notifications_create", [
			"",
			{ title: "Test" },
		]);
		expect(allowed.ok).toBe(true);
	});

	it("web alias returns E_PERMISSION via cached path when underlying API is unavailable", async () => {
		const minimalChrome = {
			...mockChrome,
			notifications: undefined,
			permissions: {
				getAll: vi.fn(() => Promise.resolve({ permissions: [] })),
			},
		};
		vi.stubGlobal("chrome", minimalChrome);
		await initCapabilities();
		const result = await dispatchTool("notifications_create", ["", { title: "Test" }]);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_PERMISSION");
			expect(result.error.message).toContain("notifications");
		}
	});

	it("web alias succeeds when permission is granted via cache", async () => {
		const fullChrome = {
			...mockChrome,
			permissions: {
				getAll: vi.fn(() => Promise.resolve({ permissions: ["notifications"] })),
			},
		};
		vi.stubGlobal("chrome", fullChrome);
		await initCapabilities();
		const result = await dispatchTool("notifications_create", ["", { title: "Test" }]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe("notif-id");
		}
	});

	it("normalizeChromeError maps permission messages to E_PERMISSION", async () => {
		const { normalizeChromeError } = await import("../src/main/runner/chrome/internals.js");
		const result = normalizeChromeError(new Error("User denied permission"));
		expect(result.error.code).toBe("E_PERMISSION");
		expect(result.error.category).toBe("permission");
	});

	it("APIs without manifest permissions work when cache is empty", async () => {
		const chromeWithRuntime = {
			...mockChrome,
			permissions: {
				getAll: vi.fn(() => Promise.resolve({ permissions: [] })),
			},
		};
		vi.stubGlobal("chrome", chromeWithRuntime);
		await initCapabilities();
		const result = await dispatchTool("chrome_runtime_getURL", ["/test"]);
		if (!result.ok) {
			expect(result.error.code).not.toBe("E_PERMISSION");
		}
	});

	it("chrome.action APIs work without manifest permission when cache is empty", async () => {
		const chromeWithAction = {
			...mockChrome,
			permissions: {
				getAll: vi.fn(() => Promise.resolve({ permissions: [] })),
			},
		};
		vi.stubGlobal("chrome", chromeWithAction);
		await initCapabilities();
		const result = await dispatchTool("chrome_action_setBadgeText", [
			{ text: "1" },
		]);
		expect(result.ok).toBe(true);
	});

	it("initCapabilities merges manifest permissions when getAll omits them", async () => {
		const chromeWithManifestOnly = {
			...mockChrome,
			runtime: {
				...mockChrome.runtime,
				getManifest: vi.fn(() => ({ permissions: ["windows", "bookmarks"] })),
			},
			permissions: {
				getAll: vi.fn(() => Promise.resolve({ permissions: ["bookmarks"] })),
			},
		};
		vi.stubGlobal("chrome", chromeWithManifestOnly);
		await initCapabilities();
		const result = await dispatchTool("chrome_windows_getAll", [
			{ populate: false },
		]);
		expect(result.ok).toBe(true);
	});
});

// ─── 11. Page action tests ───────────────────────────────────────

describe("page actions", () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		await stubChromeWithGrantedPermissions();
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
	});

	it("page_url is registered for main-thread execution in the manifest", () => {
		const manifest = getSerializableJsManifest();
		const entry = manifest.find((e) => e.action === "page_url");
		expect(entry?.owner).toBe("main-thread");
	});

	it("page.health reports mutationsReady false when content script is missing", async () => {
		mockChrome.tabs.get.mockResolvedValue({
			id: 1,
			url: "https://www.google.com/",
			title: "Google",
		});
		mockChrome.tabs.sendMessage.mockRejectedValue(
			new Error("Receiving end does not exist."),
		);

		const result = await executeMainThreadCommand({
			action: "page_health",
			params: {},
			call_id: 1,
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const health = result.value as {
				mutationsReady: boolean;
				contentScript: string;
				hint?: string;
				recovery?: string[];
			};
			expect(health.mutationsReady).toBe(false);
			expect(health.contentScript).toBe("missing");
			expect(health.hint).toContain("page.snapshot()");
			expect(health.recovery?.[0]).toContain("page.goto");
		}
	});

	it("page.health reports mutationsReady true when content script is connected", async () => {
		mockChrome.tabs.get.mockResolvedValue({
			id: 1,
			url: "https://www.google.com/",
			title: "Google",
		});
		mockChrome.tabs.sendMessage.mockImplementation(
			async (_tabId: number, msg: { action?: string }) => {
				if (msg.action === "ping") {
					return { ok: true };
				}
				return {};
			},
		);

		const result = await executeMainThreadCommand({
			action: "page_health",
			params: {},
			call_id: 1,
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const health = result.value as {
				mutationsReady: boolean;
				contentScript: string;
				scripting: string;
				hint?: string;
				recovery?: string[];
			};
			expect(health.mutationsReady).toBe(true);
			expect(health.contentScript).toBe("connected");
			expect(health.scripting).toBe("ok");
			expect(health.tabId).toBe(1);
			expect(health.url).toBe("https://www.google.com/");
			expect(health.title).toBe("Google");
			expect(health.hint).toBeUndefined();
			expect(health.recovery).toBeUndefined();
		}
	});

	it("page.health reports scripting-blocked hint for non-http tabs", async () => {
		mockChrome.tabs.get.mockResolvedValue({
			id: 1,
			url: "chrome://settings/",
			title: "Settings",
		});
		mockChrome.tabs.sendMessage.mockImplementation(
			async (_tabId: number, msg: { action?: string }) => {
				if (msg.action === "ping") {
					return { ok: true };
				}
				return {};
			},
		);

		const result = await executeMainThreadCommand({
			action: "page_health",
			params: {},
			call_id: 1,
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const health = result.value as {
				mutationsReady: boolean;
				scripting: string;
				contentScript: string;
				hint?: string;
				recovery?: string[];
			};
			expect(health.mutationsReady).toBe(false);
			expect(health.scripting).toBe("blocked");
			expect(health.contentScript).toBe("connected");
			expect(health.hint).toContain("http(s)");
			expect(health.recovery?.[0]).toContain("page.goto");
			expect(health.hint).not.toContain("MV3 does not retro-inject");
		}
	});

	it("page.active_tab returns a single tab object with tabId", async () => {
		mockChrome.tabs.get.mockResolvedValue({
			id: 42,
			url: "https://example.com/",
			title: "Example",
		});
		const result = await executeMainThreadCommand({
			action: "page_active_tab",
			params: {},
			call_id: 1,
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(Array.isArray(result.value)).toBe(false);
			expect((result.value as { tabId: number }).tabId).toBe(42);
			expect((result.value as { url: string }).url).toBe("https://example.com/");
			expect((result.value as { title: string }).title).toBe("Example");
		}
	});

	it("page_find accepts positional selector string", async () => {
		mockChrome.scripting.executeScript.mockResolvedValue([
			{ result: [{ tag: "H1", refId: null, text: "Hi" }] },
		]);
		const result = await executeMainThreadCommand({
			action: "page_find",
			params: "h1",
			call_id: 1,
		});
		expect(result.ok).toBe(true);
	});

	it("page_wait_for accepts positional selector and timeout", async () => {
		mockChrome.scripting.executeScript.mockResolvedValue([{ result: true }]);
		const result = await executeMainThreadCommand({
			action: "page_wait_for",
			params: ["#submit", 50n],
			call_id: 1,
		});
		expect(result.ok).toBe(true);
	});

	it("storage_get_many accepts positional keys array", async () => {
		const result = await executeMainThreadCommand({
			action: "storage_get_many",
			params: ["key1", "key2"],
			call_id: 1,
		});
		expect(result.ok).toBe(true);
	});

	it("page_extract accepts positional fields array", async () => {
		mockChrome.scripting.executeScript.mockResolvedValue([
			{ result: { title: "Fixture", url: "https://example.com" } },
		]);
		const result = await executeMainThreadCommand({
			action: "page_extract",
			params: ["title", "url"],
			call_id: 1,
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({
				title: "Fixture",
				url: "https://example.com",
			});
		}
	});

	it("page_wait_for timeout returns E_TIMEOUT with category timeout", async () => {
		// Mock executeInTab by making scripting always return false for selector check
		mockChrome.scripting.executeScript.mockResolvedValue([{ result: false }]);
		const result = await dispatchTool("page_wait_for", {
			selector: "#never-exists",
			timeout: 100n,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_TIMEOUT");
			expect(result.error.category).toBe("timeout");
		}
	});

	it("page_click returns E_INVALID_PARAMS when refId and label both missing", async () => {
		const result = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{},
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
		}
	});

	it("page_fill returns E_INVALID_PARAMS when refId and label both missing", async () => {
		const result = await dispatchContentScriptCall(
			"page_fill",
			"fill",
			handlers.fill,
			{},
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
		}
	});

	it("page_type returns E_INVALID_PARAMS when refId and label both missing", async () => {
		const result = await dispatchContentScriptCall(
			"page_type",
			"type",
			handlers.type,
			{},
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
		}
	});

	it("page_click returns E_INVALID_PARAMS for invalid refId formats", async () => {
		for (const badRefId of [2, "2", "btn"]) {
			const result = await dispatchContentScriptCall(
				"page_click",
				"click",
				handlers.click,
				{ refId: badRefId },
			);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe("E_INVALID_PARAMS");
			}
		}
	});

	it("page_goto awaits tab complete and ping success", async () => {
		mockChrome.tabs.get
			.mockResolvedValueOnce({ id: 1, status: "complete", url: "https://old.example" })
			.mockResolvedValueOnce({ id: 1, status: "loading", url: "https://example.com" })
			.mockResolvedValue({ id: 1, status: "complete", url: "https://example.com" });
		mockChrome.tabs.sendMessage.mockResolvedValue({ ok: true });
		const onUpdatedListeners: Array<
			(tabId: number, changeInfo: { status?: string }) => void
		> = [];
		mockChrome.tabs.onUpdated.addListener.mockImplementation((fn: any) => {
			onUpdatedListeners.push(fn);
		});
		mockChrome.tabs.onUpdated.removeListener.mockImplementation((fn: any) => {
			const idx = onUpdatedListeners.indexOf(fn);
			if (idx !== -1) onUpdatedListeners.splice(idx, 1);
		});

		const dispatchPromise = dispatchTool("page_goto", { url: "https://example.com" });

		setTimeout(() => {
			mockChrome.tabs.get.mockResolvedValue({
				id: 1,
				status: "complete",
				url: "https://example.com",
			});
			for (const listener of onUpdatedListeners) {
				listener(1, { status: "loading" });
				listener(1, { status: "complete" });
			}
		}, 150);

		const result = await dispatchPromise;
		expect(result.ok).toBe(true);
		expect(mockChrome.tabs.update).toHaveBeenCalledWith(1, {
			url: "https://example.com",
		});
		expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
			action: "ping",
		});
		expect(mockChrome.tabs.onUpdated.removeListener).toHaveBeenCalled();
	}, 10_000);

	it("page_goto returns E_NAVIGATION on tab load timeout", async () => {
		mockChrome.tabs.get.mockResolvedValue({ id: 1, status: "loading" });
		mockChrome.tabs.onUpdated.addListener.mockImplementation(() => {});
		mockChrome.tabs.onUpdated.removeListener.mockImplementation(() => {});

		const result = await dispatchTool("page_goto", {
			url: "https://example.com",
			timeout: 100n,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_NAVIGATION");
			expect(result.error.category).toBe("navigation");
			expect(result.error.message).toContain("timeout");
			expect(result.error.message).toContain("1");
		}
	});

	it("page_goto returns E_NAVIGATION for non-http(s) URLs", async () => {
		const result = await dispatchTool("page_goto", {
			url: "chrome://settings",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_NAVIGATION");
			expect(result.error.category).toBe("navigation");
			expect(result.error.message).toContain("Navigation blocked");
			expect(result.error.message).toContain("URL scheme not supported");
			expect(result.error.message).toContain("chrome://settings");
		}
	});

	it("page_goto succeeds when final URL differs after redirect", async () => {
		mockChrome.tabs.get
			.mockResolvedValueOnce({ id: 1, status: "complete", url: "https://old.example" })
			.mockResolvedValue({ id: 1, status: "complete", url: "https://redirected.com/" });
		mockChrome.tabs.sendMessage.mockResolvedValue({ ok: true });
		const onUpdatedListeners: Array<
			(tabId: number, changeInfo: { status?: string }) => void
		> = [];
		mockChrome.tabs.onUpdated.addListener.mockImplementation((fn: any) => {
			onUpdatedListeners.push(fn);
		});
		mockChrome.tabs.onUpdated.removeListener.mockImplementation((fn: any) => {
			const idx = onUpdatedListeners.indexOf(fn);
			if (idx !== -1) onUpdatedListeners.splice(idx, 1);
		});

		const dispatchPromise = dispatchTool("page_goto", {
			url: "https://example.com",
			timeout: 2000n,
		});

		setTimeout(() => {
			for (const listener of onUpdatedListeners) {
				listener(1, { status: "loading" });
				listener(1, { status: "complete" });
			}
		}, 150);

		const result = await dispatchPromise;
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toMatchObject({ url: "https://redirected.com/" });
		}
	}, 10_000);

	it("page_goto succeeds on same-URL navigation after loading events", async () => {
		const url = "https://example.com";
		let onUpdatedListener:
			| ((tabId: number, changeInfo: { status?: string }) => void)
			| undefined;
		mockChrome.tabs.onUpdated.addListener.mockImplementation((fn) => {
			onUpdatedListener = fn;
		});
		mockChrome.tabs.onUpdated.removeListener.mockImplementation(() => {});
		mockChrome.tabs.get
			.mockResolvedValueOnce({ id: 1, status: "complete", url })
			.mockResolvedValue({ id: 1, status: "complete", url });
		mockChrome.tabs.sendMessage.mockResolvedValue({ ok: true });

		const dispatchPromise = dispatchTool("page_goto", { url, timeout: 2000n });
		setTimeout(() => {
			onUpdatedListener?.(1, { status: "loading" });
			onUpdatedListener?.(1, { status: "complete" });
		}, 10);

		const result = await dispatchPromise;
		expect(result.ok).toBe(true);
		expect(mockChrome.tabs.update).toHaveBeenCalledWith(1, { url });
		expect(mockChrome.tabs.sendMessage).toHaveBeenCalled();
	});

	it("waitForTabLoad does not settle on same-URL complete without loading", async () => {
		const url = "https://example.com";
		mockChrome.tabs.get.mockResolvedValue({
			id: 1,
			status: "complete",
			url,
		});
		mockChrome.tabs.onUpdated.addListener.mockImplementation(() => {});
		mockChrome.tabs.onUpdated.removeListener.mockImplementation(() => {});

		const result = await waitForTabLoad(1, 200, {
			preNavigationUrl: url,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_NAVIGATION");
		}
	});

	it("waitForTabLoad settles on same-URL when loading was observed", async () => {
		const url = "https://example.com";
		mockChrome.tabs.get.mockResolvedValue({
			id: 1,
			status: "complete",
			url,
		});
		mockChrome.tabs.onUpdated.addListener.mockImplementation(() => {});
		mockChrome.tabs.onUpdated.removeListener.mockImplementation(() => {});

		const result = await waitForTabLoad(1, 1000, {
			preNavigationUrl: url,
			getNavSawLoading: () => true,
		});
		expect(result.ok).toBe(true);
	});

	it("pingTabContentScript retries transient receiving-end errors", async () => {
		mockChrome.tabs.sendMessage
			.mockRejectedValueOnce(new Error("Receiving end does not exist."))
			.mockResolvedValue({ ok: true });

		const result = await pingTabContentScript(1, 2000);
		expect(result.ok).toBe(true);
		expect(mockChrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
	});

	it("pingTabContentScript returns E_CONTENT_SCRIPT with hint and recovery when CS missing", async () => {
		mockChrome.tabs.sendMessage.mockRejectedValue(
			new Error("Receiving end does not exist."),
		);
		mockChrome.tabs.get.mockResolvedValue({
			id: 1,
			url: "https://www.google.com/",
		});

		const result = await pingTabContentScript(1, 50);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_CONTENT_SCRIPT");
			expect(result.error.hint).toContain("page.snapshot()");
			expect(result.error.recovery?.[0]).toContain("page.goto");
			expect(result.error.message).not.toContain("Receiving end does not exist");
		}
	});

	it("pingTabContentScript returns E_CONTENT_SCRIPT on ping timeout", async () => {
		mockChrome.tabs.sendMessage.mockImplementation(
			() => new Promise(() => {
				/* hang until ping deadline */
			}),
		);
		mockChrome.tabs.get.mockResolvedValue({
			id: 1,
			url: "https://www.google.com/",
		});

		const result = await pingTabContentScript(1, 50);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_CONTENT_SCRIPT");
			expect(result.error.hint).toContain("page.snapshot()");
			expect(result.error.recovery?.length).toBeGreaterThan(0);
		}
	});
});

// ─── 12. Tab action tests ────────────────────────────────────────

describe("tab actions", () => {
	beforeEach(async () => {
		await stubChromeWithGrantedPermissions();
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
	});

	it("tab_create accepts positional url string", async () => {
		const result = await dispatchTool(
			"tab_create",
			"https://extension-js.test/fixture",
		);
		expect(result.ok).toBe(true);
		expect(mockChrome.tabs.create).toHaveBeenCalledWith({
			url: "https://extension-js.test/fixture",
		});
	});

	it("tab_click returns E_INVALID_PARAMS when refId missing", async () => {
		const result = await dispatchContentScriptCall(
			"tab_click",
			"click",
			handlers.click,
			{ tabId: 1 },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
		}
	});

	it("tab_fill returns E_INVALID_PARAMS when refId missing", async () => {
		const result = await dispatchContentScriptCall(
			"tab_fill",
			"fill",
			handlers.fill,
			{ tabId: 1 },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
		}
	});

	it("tab_type returns E_INVALID_PARAMS when refId missing", async () => {
		const result = await dispatchContentScriptCall(
			"tab_type",
			"type",
			handlers.type,
			{ tabId: 1 },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
		}
	});

	it("tab_select returns E_INVALID_PARAMS when refId missing", async () => {
		const result = await dispatchContentScriptCall(
			"tab_select",
			"select",
			handlers.select,
			{ tabId: 1 },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
		}
	});

	it("tab_check returns E_INVALID_PARAMS when refId missing", async () => {
		const result = await dispatchContentScriptCall(
			"tab_check",
			"check",
			handlers.check,
			{ tabId: 1 },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
		}
	});

	it("tab_hover returns E_INVALID_PARAMS when refId missing", async () => {
		const result = await dispatchContentScriptCall(
			"tab_hover",
			"hover",
			handlers.hover,
			{ tabId: 1 },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
		}
	});

	it("tab_dblclick returns E_INVALID_PARAMS when refId missing", async () => {
		const result = await dispatchContentScriptCall(
			"tab_dblclick",
			"dblclick",
			handlers.dblclick,
			{ tabId: 1 },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
		}
	});

	it("tab_click returns E_INVALID_PARAMS for invalid refId formats", async () => {
		for (const badRefId of [2, "2", "btn"]) {
			const result = await dispatchContentScriptCall(
				"tab_click",
				"click",
				handlers.click,
				{ tabId: 1, refId: badRefId },
			);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe("E_INVALID_PARAMS");
			}
		}
	});

	it("tab_scroll is registered for content-script execution", () => {
		const manifest = getSerializableJsManifest();
		expect(manifest.find((e) => e.action === "tab_scroll")?.owner).toBe(
			"content-script",
		);
	});

	it("tab_back is registered for content-script execution", () => {
		const manifest = getSerializableJsManifest();
		expect(manifest.find((e) => e.action === "tab_back")?.owner).toBe(
			"content-script",
		);
	});
});

// ─── 12b. WU-5: Unambiguous element action arguments ─────────────

describe("WU-5: unambiguous element action arguments", () => {
	beforeEach(() => {
		vi.stubGlobal("chrome", mockChrome);
		vi.clearAllMocks();
		for (const spec of buildContentScriptSpecs()) {
			registerContentScriptSpec(spec);
		}
	});

	// ── Positional args rejected ──────────────────────────────────

	it("page_click rejects positional string with E_INVALID_PARAMS", async () => {
		const result = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			"Learn more",
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
			expect(result.error.message).toContain("object form");
			expect(result.error.message).toContain("refId");
		}
	});

	it("page_click rejects positional number with E_INVALID_PARAMS", async () => {
		const result = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			2,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
			expect(result.error.message).toContain("object form");
		}
	});

	it("tab_click rejects positional array with E_INVALID_PARAMS", async () => {
		const result = await dispatchContentScriptCall(
			"tab_click",
			"click",
			handlers.click,
			[1, "e2"],
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
		}
	});

	it("tab_fill rejects positional array with E_INVALID_PARAMS", async () => {
		const result = await dispatchContentScriptCall(
			"tab_fill",
			"fill",
			handlers.fill,
			[1, "e2", "hello"],
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
		}
	});

	it.each([
		["tab_type", "type", handlers.type, [1, "e2", "hello"]],
		["tab_select", "select", handlers.select, [1, "e2", "opt"]],
		["tab_check", "check", handlers.check, [1, "e2", true]],
		["tab_hover", "hover", handlers.hover, [1, "e2"]],
		["tab_dblclick", "dblclick", handlers.dblclick, [1, "e2"]],
		["tab_scroll_to", "scroll_to", handlers.scroll_to, [1, "e2"]],
	])("%s rejects positional array with E_INVALID_PARAMS", async (action, handlerKey, handler, args) => {
		const result = await dispatchContentScriptCall(
			action,
			handlerKey,
			handler,
			args,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
		}
	});

	// ── refId path works ──────────────────────────────────────────

	it("page_click resolves element by refId", async () => {
		const btn = document.createElement("button");
		btn.setAttribute("data-ref-id", "e2");
		document.body.appendChild(btn);
		const result = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ refId: "e2" },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toMatchObject({ ok: true, action: "click", refId: "e2" });
		}
		document.body.removeChild(btn);
	});

	it("page_fill resolves element by refId", async () => {
		const input = document.createElement("input");
		input.setAttribute("data-ref-id", "e3");
		document.body.appendChild(input);
		const result = await dispatchContentScriptCall(
			"page_fill",
			"fill",
			handlers.fill,
			{ refId: "e3", value: "hello" },
		);
		expect(result.ok).toBe(true);
		expect((input as HTMLInputElement).value).toBe("hello");
		document.body.removeChild(input);
	});

	it("page_select resolves element by refId", async () => {
		const select = document.createElement("select");
		select.setAttribute("data-ref-id", "e4");
		const opt = document.createElement("option");
		opt.value = "a";
		select.appendChild(opt);
		document.body.appendChild(select);
		const result = await dispatchContentScriptCall(
			"page_select",
			"select",
			handlers.select,
			{ refId: "e4", value: "a" },
		);
		expect(result.ok).toBe(true);
		document.body.removeChild(select);
	});

	it("page_check resolves element by refId", async () => {
		const cb = document.createElement("input");
		cb.type = "checkbox";
		cb.setAttribute("data-ref-id", "e5");
		document.body.appendChild(cb);
		const result = await dispatchContentScriptCall(
			"page_check",
			"check",
			handlers.check,
			{ refId: "e5", checked: false },
		);
		expect(result.ok).toBe(true);
		expect((cb as HTMLInputElement).checked).toBe(false);
		document.body.removeChild(cb);
	});

	it("page_hover resolves element by refId", async () => {
		const btn = document.createElement("button");
		btn.setAttribute("data-ref-id", "e6");
		document.body.appendChild(btn);
		const result = await dispatchContentScriptCall(
			"page_hover",
			"hover",
			handlers.hover,
			{ refId: "e6" },
		);
		expect(result.ok).toBe(true);
		document.body.removeChild(btn);
	});

	it("page_scroll_to resolves element by refId", async () => {
		const btn = document.createElement("button");
		btn.setAttribute("data-ref-id", "e7");
		btn.scrollIntoView = vi.fn();
		document.body.appendChild(btn);
		const result = await dispatchContentScriptCall(
			"page_scroll_to",
			"scroll_to",
			handlers.scroll_to,
			{ refId: "e7" },
		);
		expect(result.ok).toBe(true);
		document.body.removeChild(btn);
	});

	it("page_scroll_to accepts coordinate-only params", async () => {
		const scrollTo = vi.fn();
		Object.defineProperty(window, "scrollTo", { value: scrollTo, configurable: true });
		const result = await dispatchContentScriptCall(
			"page_scroll_to",
			"scroll_to",
			handlers.scroll_to,
			{ x: 0, y: 100 },
		);
		expect(result.ok).toBe(true);
		expect(scrollTo).toHaveBeenCalledWith({
			left: 0,
			top: 100,
			behavior: "smooth",
		});
	});

	it("page_dblclick resolves element by refId", async () => {
		const btn = document.createElement("button");
		btn.setAttribute("data-ref-id", "e8");
		document.body.appendChild(btn);
		const result = await dispatchContentScriptCall(
			"page_dblclick",
			"dblclick",
			handlers.dblclick,
			{ refId: "e8" },
		);
		expect(result.ok).toBe(true);
		document.body.removeChild(btn);
	});

	it("page_type resolves element by refId", async () => {
		const input = document.createElement("input");
		input.setAttribute("data-ref-id", "e20");
		document.body.appendChild(input);
		const result = await dispatchContentScriptCall(
			"page_type",
			"type",
			handlers.type,
			{ refId: "e20", text: "hello" },
		);
		expect(result.ok).toBe(true);
		expect((input as HTMLInputElement).value).toBe("hello");
		document.body.removeChild(input);
	});

	it("page_append resolves element by refId", async () => {
		const input = document.createElement("input");
		input.setAttribute("data-ref-id", "e21");
		input.value = "pre";
		document.body.appendChild(input);
		const result = await dispatchContentScriptCall(
			"page_append",
			"append",
			handlers.append,
			{ refId: "e21", text: "fix" },
		);
		expect(result.ok).toBe(true);
		expect((input as HTMLInputElement).value).toBe("prefix");
		document.body.removeChild(input);
	});

	it("tab_click resolves element by refId", async () => {
		const btn = document.createElement("button");
		btn.setAttribute("data-ref-id", "e30");
		document.body.appendChild(btn);
		const result = await dispatchContentScriptCall(
			"tab_click",
			"click",
			handlers.click,
			{ tabId: 1, refId: "e30" },
		);
		expect(result.ok).toBe(true);
		document.body.removeChild(btn);
	});

	// ── label path works ────────────────────────────────────────

	it("page_click resolves element by label", async () => {
		const btn = document.createElement("button");
		btn.textContent = "Learn more";
		document.body.appendChild(btn);
		const result = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ label: "Learn more" },
		);
		expect(result.ok).toBe(true);
		document.body.removeChild(btn);
	});

	it("page_fill resolves element by label", async () => {
		const input = document.createElement("input");
		input.setAttribute("aria-label", "Search");
		document.body.appendChild(input);
		const result = await dispatchContentScriptCall(
			"page_fill",
			"fill",
			handlers.fill,
			{ label: "Search", value: "query" },
		);
		expect(result.ok).toBe(true);
		expect((input as HTMLInputElement).value).toBe("query");
		document.body.removeChild(input);
	});

	it("page_select resolves element by label", async () => {
		const select = document.createElement("select");
		select.setAttribute("aria-label", "Country");
		const opt = document.createElement("option");
		opt.value = "us";
		select.appendChild(opt);
		document.body.appendChild(select);
		const result = await dispatchContentScriptCall(
			"page_select",
			"select",
			handlers.select,
			{ label: "Country", value: "us" },
		);
		expect(result.ok).toBe(true);
		document.body.removeChild(select);
	});

	it("page_check resolves element by label", async () => {
		const cb = document.createElement("input");
		cb.type = "checkbox";
		cb.setAttribute("aria-label", "Accept terms");
		document.body.appendChild(cb);
		const result = await dispatchContentScriptCall(
			"page_check",
			"check",
			handlers.check,
			{ label: "Accept terms", checked: true },
		);
		expect(result.ok).toBe(true);
		expect((cb as HTMLInputElement).checked).toBe(true);
		document.body.removeChild(cb);
	});

	it("page_hover resolves element by label", async () => {
		const btn = document.createElement("button");
		btn.textContent = "Submit";
		document.body.appendChild(btn);
		const result = await dispatchContentScriptCall(
			"page_hover",
			"hover",
			handlers.hover,
			{ label: "Submit" },
		);
		expect(result.ok).toBe(true);
		document.body.removeChild(btn);
	});

	it("page_scroll_to resolves element by label", async () => {
		const btn = document.createElement("button");
		btn.textContent = "Footer";
		btn.scrollIntoView = vi.fn();
		document.body.appendChild(btn);
		const result = await dispatchContentScriptCall(
			"page_scroll_to",
			"scroll_to",
			handlers.scroll_to,
			{ label: "Footer" },
		);
		expect(result.ok).toBe(true);
		document.body.removeChild(btn);
	});

	it("page_dblclick resolves element by label", async () => {
		const btn = document.createElement("button");
		btn.textContent = "Open";
		document.body.appendChild(btn);
		const result = await dispatchContentScriptCall(
			"page_dblclick",
			"dblclick",
			handlers.dblclick,
			{ label: "Open" },
		);
		expect(result.ok).toBe(true);
		document.body.removeChild(btn);
	});

	it("page_type resolves element by label", async () => {
		const input = document.createElement("input");
		input.setAttribute("aria-label", "Username");
		document.body.appendChild(input);
		const result = await dispatchContentScriptCall(
			"page_type",
			"type",
			handlers.type,
			{ label: "Username", text: "world" },
		);
		expect(result.ok).toBe(true);
		expect((input as HTMLInputElement).value).toBe("world");
		document.body.removeChild(input);
	});

	it("page_append resolves element by label", async () => {
		const input = document.createElement("input");
		input.setAttribute("aria-label", "Notes");
		input.value = "pre";
		document.body.appendChild(input);
		const result = await dispatchContentScriptCall(
			"page_append",
			"append",
			handlers.append,
			{ label: "Notes", text: "fix" },
		);
		expect(result.ok).toBe(true);
		expect((input as HTMLInputElement).value).toBe("prefix");
		document.body.removeChild(input);
	});

	it("tab_click resolves element by label", async () => {
		const btn = document.createElement("button");
		btn.textContent = "TabBtn";
		document.body.appendChild(btn);
		const result = await dispatchContentScriptCall(
			"tab_click",
			"click",
			handlers.click,
			{ tabId: 1, label: "TabBtn" },
		);
		expect(result.ok).toBe(true);
		document.body.removeChild(btn);
	});

	// ── Error messages state lookup mode ──────────────────────────

	it("not-found error mentions refId when refId was used", async () => {
		const result = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ refId: "e999" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toContain('by refId "e999"');
		}
	});

	it("not-found error mentions label when label was used", async () => {
		const result = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ label: "Nonexistent" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_NOT_FOUND");
			expect(result.error.message).toContain('by label "Nonexistent"');
		}
	});

	it("tab_click not-found error mentions refId", async () => {
		const result = await dispatchContentScriptCall(
			"tab_click",
			"click",
			handlers.click,
			{ tabId: 1, refId: "e999" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toContain('by refId "e999"');
		}
	});

	it("tab_click not-found error mentions label", async () => {
		const result = await dispatchContentScriptCall(
			"tab_click",
			"click",
			handlers.click,
			{ tabId: 1, label: "Nonexistent" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_NOT_FOUND");
			expect(result.error.message).toContain('by label "Nonexistent"');
		}
	});

	// ── Sidepanel positional rejection ────────────────────────────

	it("sidepanel_click rejects positional string with E_INVALID_PARAMS", async () => {
		const result = await dispatchTool("sidepanel_click", "e1");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
		}
	});

	it("sidepanel_click resolves by refId", async () => {
		const btn = document.createElement("button");
		btn.setAttribute("data-ref-id", "e10");
		document.body.appendChild(btn);
		const result = await dispatchTool("sidepanel_click", { refId: "e10" });
		expect(result.ok).toBe(true);
		document.body.removeChild(btn);
	});

	it("sidepanel_click resolves by label", async () => {
		const btn = document.createElement("button");
		btn.textContent = "SidepanelBtn";
		document.body.appendChild(btn);
		const result = await dispatchTool("sidepanel_click", { label: "SidepanelBtn" });
		expect(result.ok).toBe(true);
		document.body.removeChild(btn);
	});
});

// ─── 13. Host call tests ─────────────────────────────────────────

describe("host call", () => {
	it("registerHostHandler registers single handler", async () => {
		registerHostHandler("test_host_single", async (params) => {
			return { single: true, params };
		});
		const result = await executeMainThreadCommand({
			action: "host_test_host_single",
			params: { a: 1 },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ single: true, params: { a: 1 } });
		}
	});

	it("registerHostHandlers registers multiple handlers", async () => {
		registerHostHandlers({
			test_host_multi_a: async () => "a",
			test_host_multi_b: async () => "b",
		});
		const resultA = await executeMainThreadCommand({
			action: "host_test_host_multi_a",
			params: {},
		});
		expect(resultA.ok).toBe(true);
		if (resultA.ok) {
			expect(resultA.value).toBe("a");
		}

		const resultB = await executeMainThreadCommand({
			action: "host_test_host_multi_b",
			params: {},
		});
		expect(resultB.ok).toBe(true);
		if (resultB.ok) {
			expect(resultB.value).toBe("b");
		}
	});

	it("host_call returns E_UNKNOWN when missing", async () => {
		const result = await executeMainThreadCommand({
			action: "host_nonexistent_handler_xyz",
			params: {},
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_UNKNOWN");
		}
	});
});

// ─── 14. Sleep / util tests ──────────────────────────────────────

describe("sleep", () => {
	it("sleep waits for the specified duration", async () => {
		const start = Date.now();
		const result = await dispatchTool("sleep", { duration: 50n });
		const elapsed = Date.now() - start;
		expect(result.ok).toBe(true);
		expect(elapsed).toBeGreaterThanOrEqual(40);
	});
});

// ─── 15. Snapshot refId contract tests ───────────────────────────

describe("snapshot refId contract", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("buildSnapshotInTab includes input value on form controls", () => {
		const input = document.createElement("input");
		input.type = "text";
		input.value = "preset";
		document.body.appendChild(input);

		const result = buildSnapshotInTab(500);
		const inputNode = result.nodes.find((n) => n.tag === "input");
		expect(inputNode?.value).toBe("preset");
	});

	it("buildSnapshotInTab includes checked and disabled on form controls", () => {
		const checkbox = document.createElement("input");
		checkbox.type = "checkbox";
		checkbox.checked = true;
		document.body.appendChild(checkbox);

		const disabled = document.createElement("input");
		disabled.type = "text";
		disabled.disabled = true;
		document.body.appendChild(disabled);

		const result = buildSnapshotInTab(500);
		const checkboxNode = result.nodes.find((n) => n.tag === "input" && n.checked === true);
		const disabledNode = result.nodes.find((n) => n.disabled === true);
		expect(checkboxNode?.checked).toBe(true);
		expect(disabledNode?.disabled).toBe(true);
	});

	it("buildSnapshotInTab emits string refIds in e{N} format", () => {
		const btn1 = document.createElement("button");
		btn1.textContent = "First";
		const btn2 = document.createElement("button");
		btn2.textContent = "Second";
		document.body.appendChild(btn1);
		document.body.appendChild(btn2);

		const result = buildSnapshotInTab(500);
		expect(result.nodes).toHaveLength(2);
		expect(result.nodes[0].refId).toBe("e1");
		expect(result.nodes[1].refId).toBe("e2");
		expect(typeof result.nodes[0].refId).toBe("string");
		expect(result.nodes[0].refId).toMatch(/^e\d+$/);
	});

	it("buildSnapshotInTab sets data-ref-id attributes on DOM", () => {
		const btn = document.createElement("button");
		btn.textContent = "Click me";
		document.body.appendChild(btn);

		buildSnapshotInTab(500);
		expect(btn.getAttribute("data-ref-id")).toBe("e1");
	});

	it("buildSnapshotInTab snapshot text uses [e1] not [ref=", () => {
		const btn = document.createElement("button");
		btn.textContent = "Click me";
		document.body.appendChild(btn);

		const result = buildSnapshotInTab(500);
		expect(result.text).toContain("[e1]");
		expect(result.text).not.toContain("[ref=");
	});

	it("snapshot_data → click round-trip works without manual conversion", () => {
		const btn = document.createElement("button");
		btn.textContent = "Click me";
		let clicked = false;
		btn.addEventListener("click", () => {
			clicked = true;
		});
		document.body.appendChild(btn);

		const snapshot = buildSnapshotInTab(500);
		const refId = snapshot.nodes[0].refId;
		expect(refId).toMatch(/^e\d+$/);

		const el = document.querySelector(
			`[data-ref-id='${CSS.escape(refId)}']`,
		);
		expect(el).toBe(btn);
		(el as HTMLElement).click();
		expect(clicked).toBe(true);
	});
});

// ─── 16. Acceptance criteria verification ────────────────────────

describe("acceptance criteria verification", () => {
	const commandPath = path.resolve(__dirname, "../src/main/runner/command.ts");

	it("AC-1: no switch statements in runner command dispatch", () => {
		const content = fs.readFileSync(commandPath, "utf-8");
		const matches = content.match(/\bswitch\b/g);
		expect(matches ?? []).toHaveLength(0);
	});

	it("AC-2: executeMainThreadCommand is ≤15 lines", () => {
		const content = fs.readFileSync(commandPath, "utf-8");
		// Find the function definition
		const match = content.match(
			/export async function executeMainThreadCommand\([\s\S]*?^\}/m,
		);
		expect(match).toBeTruthy();
		const lines = match?.[0].split("\n");
		expect(lines.length).toBeLessThanOrEqual(15);
	});

	it("AC-3: manifest has ≥130 registered actions", () => {
		expect(getSerializableJsManifest().length).toBeGreaterThanOrEqual(130);
	});

	it("AC-18: every tool has description, paramTypes, and returnDoc", () => {
		const tools = listTools();
		for (const tool of tools) {
			expect(tool.description).toBeTruthy();
			expect(tool.description.length).toBeGreaterThan(0);
			expect(Array.isArray(tool.params)).toBe(true);
			expect(tool.returns.description).toBeTruthy();
			expect(tool.returns.description.length).toBeGreaterThan(0);
			expect(tool.errorCode).toBeTruthy();
		}
	});

	it("AC-14: chrome passthrough has no firstRec heuristics", () => {
		const internalsPath = path.resolve(
			__dirname,
			"../src/main/runner/chrome/internals.ts",
		);
		const content = fs.readFileSync(internalsPath, "utf-8");
		expect(content).not.toContain("firstRec");
		expect(content).not.toContain("chromePassthroughHandlers");
	});

	it("AC-15: native spread only appears in invokeNative", () => {
		const nativePath = path.resolve(
			__dirname,
			"../src/main/runner/chrome/native.ts",
		);
		const internalsPath = path.resolve(
			__dirname,
			"../src/main/runner/chrome/internals.ts",
		);
		const nativeContent = fs.readFileSync(nativePath, "utf-8");
		const internalsContent = fs.readFileSync(internalsPath, "utf-8");
		expect(nativeContent).toContain("method(...args)");
		expect(internalsContent).not.toContain("method(...");
	});

	it("AC-13: normalizeParams uses Maps, no switch", () => {
		const paramsPath = path.resolve(
			__dirname,
			"../src/main/runner/lib/params.ts",
		);
		const content = fs.readFileSync(paramsPath, "utf-8");
		// Check that normalizeParams uses scalarNormalizers and arrayNormalizers Maps
		expect(content).toContain("scalarNormalizers");
		expect(content).toContain("arrayNormalizers");
		// And no switch inside normalizeParams
		const normalizeMatch = content.match(
			/export function normalizeParams\([\s\S]*?^\}/m,
		);
		expect(normalizeMatch).toBeTruthy();
		expect(normalizeMatch?.[0]).not.toContain("switch");
	});
});

// ─── 17. Registry contract with runner tools ─────────────────────
// These must run BEFORE the isolated registry contract block because
// they depend on the runner.ts module-level registrations.

describe("registry contract with runner tools", () => {
	it("test_chrome_storage_local_apis_exist: chrome.storage.local actions are registered", () => {
		const setTool = getTool("chrome_storage_local_set");
		const getTool_ = getTool("chrome_storage_local_get");
		const removeTool = getTool("chrome_storage_local_remove");
		const clearTool = getTool("chrome_storage_local_clear");

		expect(setTool).toBeDefined();
		expect(setTool?.namespace).toBe("chrome.storage.local");
		expect(getTool_).toBeDefined();
		expect(getTool_?.namespace).toBe("chrome.storage.local");
		expect(removeTool).toBeDefined();
		expect(removeTool?.namespace).toBe("chrome.storage.local");
		expect(clearTool).toBeDefined();
		expect(clearTool?.namespace).toBe("chrome.storage.local");
	});

	it("test_page_fetch_exists: page_fetch is registered", () => {
		const tool = getTool("page_fetch");
		expect(tool).toBeDefined();
		expect(tool?.namespace).toBe("page");
		expect(tool?.action).toBe("page_fetch");
	});

	it("content-script APIs are exported with content-script owner metadata", () => {
		const manifest = getSerializableJsManifest();
		const pageClick = manifest.find((entry) => entry.action === "page_click");
		const tabClick = manifest.find((entry) => entry.action === "tab_click");
		expect(pageClick?.owner).toBe("content-script");
		expect(tabClick?.owner).toBe("content-script");
	});

	it("chrome passthrough manifest entries must not set fields", () => {
		const manifest = getSerializableJsManifest();
		const offenders = manifest.filter(
			(e) =>
				e.action.startsWith("chrome_") &&
				Array.isArray(e.fields) &&
				e.fields.length > 0,
		);
		expect(
			offenders.map((e) => `${e.action}:${JSON.stringify(e.fields)}`),
		).toEqual([]);
	});

	it("chrome cookies manifest entries compare get vs getAll", () => {
		const manifest = getSerializableJsManifest();
		const get = manifest.find((e) => e.action === "chrome_cookies_get");
		const getAll = manifest.find((e) => e.action === "chrome_cookies_getAll");
		const alias = manifest.find((e) => e.action === "cookies_get");
		expect(get).toBeDefined();
		expect(getAll).toBeDefined();
		expect(get?.fields ?? null).toBeNull();
		expect(getAll?.fields ?? null).toBeNull();
		expect(get?.namespace).toBe("chrome.cookies");
		expect(getAll?.namespace).toBe("chrome.cookies");
		expect(alias?.namespace).toBe("web.cookies");
	});
});

// ─── 18. Registry contract tests (isolated) ──────────────────────

describe("registry contract", () => {
	beforeEach(() => {
		clearJsRegistry();
	});

	it("test_js_registry_integrity: every registered tool has required fields", () => {
		registerJsCall({
			action: "contract_integrity_test",
			namespace: "contract",
			name: "integrity_test",
			description: "Contract integrity test tool",
			params: z.object({}),
			returns: z.null(),
			owner: "main-thread",
			handler: async () => null,
			paramTypes: [],
			returnDoc: "null",
			errorCode: "ETEST",
		});

		const tools = listTools();
		expect(tools.length).toBeGreaterThanOrEqual(1);
		for (const tool of tools) {
			expect(tool.action).toBeTruthy();
			expect(tool.namespace).toBeTruthy();
			expect(tool.description).toBeTruthy();
			expect(Array.isArray(tool.params)).toBe(true);
			expect(tool.returns.description).toBeTruthy();
			expect(tool.errorCode).toBeTruthy();
		}
	});

	it("test_js_registry_no_duplicates: no duplicate actions in registry", () => {
		registerJsCall({
			action: "contract_dup_test_a",
			namespace: "contract",
			name: "dup_test_a",
			description: "Test A",
			params: z.object({}),
			returns: z.null(),
			owner: "main-thread",
			handler: async () => null,
			paramTypes: [],
			returnDoc: "null",
			errorCode: "ETEST",
		});
		registerJsCall({
			action: "contract_dup_test_b",
			namespace: "contract",
			name: "dup_test_b",
			description: "Test B",
			params: z.object({}),
			returns: z.null(),
			owner: "main-thread",
			handler: async () => null,
			paramTypes: [],
			returnDoc: "null",
			errorCode: "ETEST",
		});

		const tools = listTools();
		const actions = tools.map((t) => t.action);
		const uniqueActions = new Set(actions);
		expect(uniqueActions.size).toBe(actions.length);
	});

	it("test_freeze_prevents_registration: after freeze, registerJsCall throws", () => {
		registerJsCall({
			action: "contract_freeze_test",
			namespace: "contract",
			name: "freeze_test",
			description: "Freeze test",
			params: z.object({}),
			returns: z.null(),
			owner: "main-thread",
			handler: async () => null,
			paramTypes: [],
			returnDoc: "null",
			errorCode: "ETEST",
		});

		freezeJsRegistry();
		expect(() =>
			registerJsCall({
				action: "contract_after_freeze",
				namespace: "contract",
				name: "after_freeze",
				description: "Should fail",
				params: z.object({}),
				returns: z.null(),
			owner: "main-thread",
				handler: async () => null,
				paramTypes: [],
				returnDoc: "null",
				errorCode: "ETEST",
			}),
		).toThrow("JS registry is frozen");
	});

	it("test_manifest_export: getSerializableJsManifest returns entries with correct metadata", () => {
		registerJsCall({
			action: "contract_manifest_test",
			namespace: "contract",
			name: "manifest_test",
			description: "Manifest export test",
			params: z.object({ key: z.string() }),
			returns: z.string(),
			fields: ["key"],
			aliases: [{ namespace: "contract", name: "manifest_test_alias" }],
			owner: "main-thread",
			handler: async () => "ok",
			paramTypes: [
				{
					name: "key",
					type: "string",
					required: true,
					description: "Test key",
				},
			],
			returnType: "string",
			returnDoc: "Test result",
			errorCode: "ETEST",
			errorCategory: "test",
		});

		const manifest = getSerializableJsManifest();
		expect(manifest.length).toBeGreaterThanOrEqual(1);

		const entry = manifest.find((e) => e.action === "contract_manifest_test");
		expect(entry).toBeDefined();
		expect(entry?.namespace).toBe("contract");
		expect(entry?.name).toBe("manifest_test");
		expect(entry?.publicName).toBe("contract.manifest_test");
		expect(entry?.description).toBe("Manifest export test");
		expect(entry?.fields).toEqual(["key"]);
		expect(entry?.aliases).toEqual([
			{ namespace: "contract", name: "manifest_test_alias", fields: null },
		]);
		expect(entry?.owner).toBe("main-thread");
		expect(entry?.paramsDoc).toEqual([
			{ name: "key", type: "string", required: true, description: "Test key" },
		]);
		expect(entry?.returnsDoc.type).toBe("string");
		expect(entry?.returnsDoc.description).toBe("Test result");
		expect(entry?.errorCode).toBe("ETEST");
		expect(entry?.errorCategory).toBe("test");
	});
});

// ─── 19. Registry core tests ─────────────────────────────────────
// These go LAST because clearRegistry() removes all tools and we
// do not attempt to re-register the full runner.ts suite.

describe("registry core", () => {
	beforeEach(() => {
		clearRegistry();
	});

	it("registerJsCall registers a tool and getTool retrieves it", () => {
		const tool = makeTestTool("test_get");
		registerTestTool(tool);
		expect(getTool("test_get")).toBeDefined();
		expect(getTool("test_get")?.action).toBe("test_get");
	});

	it("registerJsCall throws on duplicate action", () => {
		const tool = makeTestTool("test_dup");
		registerTestTool(tool);
		expect(() => registerTestTool(makeTestTool("test_dup"))).toThrow(
			'Tool "test_dup" is already registered',
		);
	});

	it("clearRegistry removes all tools", () => {
		registerTestTool(makeTestTool("test_clear_1"));
		registerTestTool(makeTestTool("test_clear_2"));
		expect(listTools().length).toBeGreaterThanOrEqual(2);
		clearRegistry();
		expect(listTools().length).toBe(0);
	});

	it("clearRegistry removes content-script actions", () => {
		registerJsCall({
			action: "test_cs_clear",
			namespace: "test",
			name: "cs_clear",
			description: "Test CS clear",
			params: z.object({}),
			returns: z.null(),
			owner: "content-script",
			handler: async () => null,
			errorCode: "E_TEST",
			paramTypes: [],
			returnDoc: "null",
		});
		addContentScriptAction("test_cs_clear");
		expect(getContentScriptActions().length).toBeGreaterThan(0);
		clearRegistry();
		expect(getContentScriptActions().length).toBe(0);
	});

	it("listTools returns all registered tools", () => {
		registerTestTool(makeTestTool("test_list_a"));
		registerTestTool(makeTestTool("test_list_b"));
		const docs = listTools();
		expect(docs.some((d) => d.action === "test_list_a")).toBe(true);
		expect(docs.some((d) => d.action === "test_list_b")).toBe(true);
	});

	it("dispatchTool calls handler and returns { ok: true, value }", async () => {
		registerTestTool(
			makeTestTool("test_dispatch_ok", async (params) => {
				return { echoed: params };
			}),
		);
		const result = await dispatchTool("test_dispatch_ok", { foo: "bar" });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ echoed: {} });
		}
	});

	it("dispatchTool returns { ok: false, error } for unknown action with code E_UNKNOWN", async () => {
		const result = await dispatchTool("test_unknown_action", {});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_UNKNOWN");
			expect(result.error.category).toBe("unknown");
		}
	});

	it("dispatchTool returns { ok: false, error } for invalid params with code E_INVALID_PARAMS", async () => {
		registerJsCall({
			action: "test_validate",
			namespace: "test",
			name: "test_validate",
			description: "Validation test",
			params: z.object({ name: z.string() }),
			returns: z.null(),
			owner: "main-thread",
			handler: async () => null,
			paramTypes: [],
			returnDoc: "null",
			errorCode: "ETEST",
		});
		const result = await dispatchTool("test_validate", { name: 123 });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_INVALID_PARAMS");
			expect(result.error.category).toBe("validation");
		}
	});
});

// ─── 20. Logging tests ───────────────────────────────────────────

describe("logging", () => {
	it("logs command dispatch with runId on success", async () => {
		registerHostHandler("test_logging_ok", async () => ({ ok: true }));

		const finishFn = vi.fn();
		const childLogger = {
			debug: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
			info: vi.fn(),
			timer: vi.fn(() => finishFn),
		};
		vi.mocked(logger.child).mockReturnValue(
			childLogger as unknown as ReturnType<typeof logger.child>,
		);

		const result = await executeMainThreadCommand({
			action: "host_test_logging_ok",
			params: {},
			runId: "test-run-123",
			call_id: 42,
		});

		expect(logger.child).toHaveBeenCalledWith("runner");
		expect(childLogger.timer).toHaveBeenCalledWith("command_dispatch", {
			action: "host_test_logging_ok",
			commandId: 42,
			runId: "test-run-123",
		});
		expect(finishFn).toHaveBeenCalledWith({ ok: true, handler: "host" });
		expect(result.ok).toBe(true);
	});

	it("logs command dispatch without runId on failure", async () => {
		const finishFn = vi.fn();
		const childLogger = {
			debug: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
			info: vi.fn(),
			timer: vi.fn(() => finishFn),
		};
		vi.mocked(logger.child).mockReturnValue(
			childLogger as unknown as ReturnType<typeof logger.child>,
		);

		const result = await executeMainThreadCommand({
			action: "host_nonexistent_handler_for_logging",
			params: {},
			call_id: 99,
		});

		expect(logger.child).toHaveBeenCalledWith("runner");
		expect(childLogger.timer).toHaveBeenCalledWith("command_dispatch", {
			action: "host_nonexistent_handler_for_logging",
			commandId: 99,
			runId: undefined,
		});
		expect(finishFn).toHaveBeenCalledWith({ ok: false });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_UNKNOWN");
		}
	});
});
