// @vitest-environment jsdom

import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// ─── Mocks ───────────────────────────────────────────────────────

// @pi-oxide/dom-semantic-tree is aliased to ./__mocks__/dom-semantic-tree.js via vitest.config.ts

vi.mock("./logger.js", () => ({
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
			getInfo: vi.fn(() => Promise.resolve({})),
		},
		memory: {
			getInfo: vi.fn(() => Promise.resolve({})),
		},
		storage: {
			getInfo: vi.fn(() => Promise.resolve([])),
		},
	},
};

// Extend existing tabs mock with group/ungroup
(mockChrome.tabs as any).group = vi.fn(() => Promise.resolve(1));
(mockChrome.tabs as any).ungroup = vi.fn(() => Promise.resolve());

// ─── Imports ─────────────────────────────────────────────────────

import { logger } from "./logger.js";
// runner.ts registers all tools at module load time; initExtensionListeners()
// is a no-op because chrome is not yet stubbed.  We stub it before tests
// that need it.
import {
	executeMainThreadCommand,
	normalizeParams,
	registerHostHandler,
	registerHostHandlers,
} from "./runner.js";

import {
	clearRegistry,
	dispatchTool,
	getTool,
	listTools,
	registerTool,
	setRunnerAbortController,
	throwIfAborted,
} from "./tool-registry.js";

// ─── Polyfills ───────────────────────────────────────────────────

if (typeof globalThis.CSS === "undefined" || !globalThis.CSS.escape) {
	(globalThis as unknown as Record<string, unknown>).CSS = {
		escape: (s: string) => s.replace(/([.*+?^${}()|[\]\\])/g, "\\$1"),
	};
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
		returns: z.null(),
		handler: handler ?? (async () => null),
		paramTypes: [],
		returnDoc: "null",
		errorCode: "ETEST",
	};
}

// ─── 1. normalizeParams tests ──────────────────────────────────

describe("normalizeParams", () => {
	const arrayActions = [
		"tab_click",
		"tab_fill",
		"tab_type",
		"tab_press",
		"tab_select",
		"tab_check",
		"tab_hover",
		"tab_unhover",
		"tab_scroll",
		"tab_dblclick",
		"tab_back",
		"tab_wait_for_load",
		"tab_scroll_to",
		"tab_evaluate",
		"tab_fetch",
		"tab_snapshot",
		"tab_snapshot_text",
		"tab_snapshot_data",
	];

	it.each(arrayActions)("%s converts array params to object", (action) => {
		const result = normalizeParams(action, [42, "ref-1", "extra"]);
		expect(result).toBeDefined();
		expect(typeof result).toBe("object");
		expect(Array.isArray(result)).toBe(false);
	});

	it("tab_click array normalizer produces correct shape", () => {
		const result = normalizeParams("tab_click", [42, "ref-1"]);
		expect(result).toEqual({ tabId: 42, refId: "ref-1" });
	});

	it("tab_fill array normalizer produces correct shape", () => {
		const result = normalizeParams("tab_fill", [42, "ref-1", "hello"]);
		expect(result).toEqual({ tabId: 42, refId: "ref-1", value: "hello" });
	});

	it("tab_scroll array normalizer uses defaults", () => {
		const result = normalizeParams("tab_scroll", [42]);
		expect(result).toEqual({ tabId: 42, direction: "down", amount: 300 });
	});

	it("tab_wait_for_load array normalizer uses default timeout", () => {
		const result = normalizeParams("tab_wait_for_load", [42]);
		expect(result).toEqual({ tabId: 42, timeout: 30000n });
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

	it("non-array/non-scalar params pass through unchanged", () => {
		const obj = { foo: "bar" };
		expect(normalizeParams("tab_click", obj)).toBe(obj);
		expect(normalizeParams("some_other_action", [1, 2])).toEqual([1, 2]);
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
		registerTool(makeTestTool(actionName));
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
		const result = await dispatchTool("chrome_tabs_query", {});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_NO_EXTENSION");
		}
		vi.stubGlobal("chrome", originalChrome);
	});
});

// ─── 4. Schema validation tests ──────────────────────────────────

describe("schema validation", () => {
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
			// The error message should mention the field and issue, but should NOT
			// contain the raw invalid value in a way that leaks sensitive data.
			expect(result.error.message).toContain("invalid value for field");
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

// ─── 5. Integration tests ────────────────────────────────────────

describe("integration", () => {
	beforeEach(() => {
		vi.stubGlobal("chrome", mockChrome);
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
			params: { url: "https://example.com", name: "session" },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ name: "test", value: "value" });
		}
	});

	it("listTools returns at least 130 tools", () => {
		const tools = listTools();
		expect(tools.length).toBeGreaterThanOrEqual(130);
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

// ─── 6. Filesystem tests ─────────────────────────────────────────

describe("filesystem", () => {
	const testPath = `/test/fs_test_${Date.now()}.txt`;
	const testDir = `/test/dir_${Date.now()}`;

	it("fs_write + fs_read_text roundtrip", async () => {
		const writeResult = await dispatchTool("fs_write", {
			path: testPath,
			data: "hello world",
		});
		expect(writeResult.ok).toBe(true);

		const readResult = await dispatchTool("fs_read_text", { path: testPath });
		expect(readResult.ok).toBe(true);
		if (readResult.ok) {
			expect(readResult.value).toBe("hello world");
		}
	});

	it("fs_exists true after write, false after delete", async () => {
		const path = `${testPath}_exists`;
		await dispatchTool("fs_write", { path, data: "x" });

		const existsResult = await dispatchTool("fs_exists", { path });
		expect(existsResult.ok).toBe(true);
		if (existsResult.ok) {
			expect(existsResult.value).toBe(true);
		}

		await dispatchTool("fs_delete", { path });
		const notExistsResult = await dispatchTool("fs_exists", { path });
		expect(notExistsResult.ok).toBe(true);
		if (notExistsResult.ok) {
			expect(notExistsResult.value).toBe(false);
		}
	});

	it("fs_stat returns correct kind and size", async () => {
		const path = `${testPath}_stat`;
		await dispatchTool("fs_write", { path, data: "abc" });

		const statResult = await dispatchTool("fs_stat", { path });
		expect(statResult.ok).toBe(true);
		if (statResult.ok) {
			expect(statResult.value.kind).toBe("File");
			expect(statResult.value.size).toBe(3);
		}
	});

	it("fs_stat on missing file returns E_NOT_FOUND (not generic EFS)", async () => {
		const result = await dispatchTool("fs_stat", {
			path: "/nonexistent/file.txt",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_NOT_FOUND");
		}
	});

	it("fs_list returns directory entries", async () => {
		await dispatchTool("fs_mkdir", { path: testDir });
		await dispatchTool("fs_write", { path: `${testDir}/a.txt`, data: "a" });
		await dispatchTool("fs_write", { path: `${testDir}/b.txt`, data: "b" });

		const listResult = await dispatchTool("fs_list", { path: testDir });
		expect(listResult.ok).toBe(true);
		if (listResult.ok) {
			const names = listResult.value.map((e: { name: string }) => e.name);
			expect(names).toContain("a.txt");
			expect(names).toContain("b.txt");
		}
	});

	it("fs_copy duplicates file", async () => {
		const from = `${testPath}_copy_src`;
		const to = `${testPath}_copy_dst`;
		await dispatchTool("fs_write", { path: from, data: "copyme" });
		await dispatchTool("fs_copy", { from, to });

		const readResult = await dispatchTool("fs_read_text", { path: to });
		expect(readResult.ok).toBe(true);
		if (readResult.ok) {
			expect(readResult.value).toBe("copyme");
		}
	});

	it("fs_move moves file", async () => {
		const from = `${testPath}_move_src`;
		const to = `${testPath}_move_dst`;
		await dispatchTool("fs_write", { path: from, data: "moveme" });
		await dispatchTool("fs_move", { from, to });

		const readResult = await dispatchTool("fs_read_text", { path: to });
		expect(readResult.ok).toBe(true);
		if (readResult.ok) {
			expect(readResult.value).toBe("moveme");
		}

		const existsResult = await dispatchTool("fs_exists", { path: from });
		expect(existsResult.ok).toBe(true);
		if (existsResult.ok) {
			expect(existsResult.value).toBe(false);
		}
	});

	it("fs_hash returns correct SHA-256", async () => {
		const path = `${testPath}_hash`;
		await dispatchTool("fs_write", { path, data: "hashme" });

		const hashResult = await dispatchTool("fs_hash", { path, algo: "sha256" });
		expect(hashResult.ok).toBe(true);
		if (hashResult.ok) {
			expect(typeof hashResult.value).toBe("string");
			expect(hashResult.value.length).toBe(64); // hex sha256
		}
	});

	it("fs_append concatenates data", async () => {
		const path = `${testPath}_append`;
		await dispatchTool("fs_write", { path, data: "hello" });
		await dispatchTool("fs_append", { path, data: " world" });

		const readResult = await dispatchTool("fs_read_text", { path });
		expect(readResult.ok).toBe(true);
		if (readResult.ok) {
			expect(readResult.value).toBe("hello world");
		}
	});
});

// ─── 7. Storage tests ────────────────────────────────────────────

describe("storage", () => {
	const testKey = `runner_test_key_${Date.now()}`;

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

	it("sidepanel_click throws ENOTFOUND when target element missing", async () => {
		const result = await dispatchTool("sidepanel_click", {
			refId: "nonexistent",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("ENOTFOUND");
		}
	});
});

// ─── 10. Chrome passthrough tests ────────────────────────────────

describe("chrome passthrough", () => {
	beforeEach(() => {
		vi.stubGlobal("chrome", mockChrome);
		vi.clearAllMocks();
	});

	it("chrome_tabs_query returns tab array", async () => {
		const result = await dispatchTool("chrome_tabs_query", { active: true });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(Array.isArray(result.value)).toBe(true);
		}
		expect(mockChrome.tabs.query).toHaveBeenCalled();
	});

	it("chrome_cookies_get returns cookie", async () => {
		const result = await dispatchTool("chrome_cookies_get", {
			url: "https://example.com",
			name: "session",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ name: "test", value: "value" });
		}
	});

	it("chrome_bookmarks_search returns bookmarks", async () => {
		const result = await dispatchTool("chrome_bookmarks_search", "query");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(Array.isArray(result.value)).toBe(true);
		}
	});

	it("chrome_history_search returns history", async () => {
		const result = await dispatchTool("chrome_history_search", {
			text: "query",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(Array.isArray(result.value)).toBe(true);
		}
	});

	it("chrome_notifications_create returns notification id", async () => {
		const result = await dispatchTool("chrome_notifications_create", {
			options: { title: "Test" },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe("notif-id");
		}
	});

	it("chrome_tabGroups_query returns array", async () => {
		const result = await dispatchTool("chrome_tabGroups_query", {});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(Array.isArray(result.value)).toBe(true);
		}
		expect(mockChrome.tabGroups.query).toHaveBeenCalled();
	});

	it("chrome_sessions_getRecentlyClosed returns array", async () => {
		const result = await dispatchTool("chrome_sessions_getRecentlyClosed", {});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(Array.isArray(result.value)).toBe(true);
		}
		expect(mockChrome.sessions.getRecentlyClosed).toHaveBeenCalled();
	});

	it("chrome_downloads_download returns id", async () => {
		const result = await dispatchTool("chrome_downloads_download", {
			url: "https://example.com/file.zip",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe(1);
		}
		expect(mockChrome.downloads.download).toHaveBeenCalled();
	});

	it("chrome_system_cpu_getInfo returns object", async () => {
		const result = await dispatchTool("chrome_system_cpu_getInfo", {});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(typeof result.value).toBe("object");
		}
		expect(mockChrome.system.cpu.getInfo).toHaveBeenCalled();
	});
});

// ─── 11. Page action tests ───────────────────────────────────────

describe("page actions", () => {
	beforeEach(() => {
		vi.stubGlobal("chrome", mockChrome);
		vi.clearAllMocks();
	});

	it("page_url with no active tab returns E_NO_TAB", async () => {
		// Override query to return empty so activeTabId stays null
		mockChrome.tabs.query.mockResolvedValueOnce([]);
		const result = await dispatchTool("page_url", {});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_NO_TAB");
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

	it("page_click returns E_MISSING_PARAM when refId and label both missing", async () => {
		const result = await dispatchTool("page_click", {});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_MISSING_PARAM");
		}
	});

	it("page_fill returns E_MISSING_PARAM when refId and label both missing", async () => {
		const result = await dispatchTool("page_fill", {});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_MISSING_PARAM");
		}
	});

	it("page_type returns E_MISSING_PARAM when refId and label both missing", async () => {
		const result = await dispatchTool("page_type", {});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_MISSING_PARAM");
		}
	});
});

// ─── 12. Tab action tests ────────────────────────────────────────

describe("tab actions", () => {
	beforeEach(() => {
		vi.stubGlobal("chrome", mockChrome);
		vi.clearAllMocks();
	});

	it("tab_click returns E_MISSING_PARAM when refId missing", async () => {
		const result = await dispatchTool("tab_click", { tabId: 1 });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_MISSING_PARAM");
		}
	});

	it("tab_fill returns E_MISSING_PARAM when refId missing", async () => {
		const result = await dispatchTool("tab_fill", { tabId: 1 });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_MISSING_PARAM");
		}
	});

	it("tab_type returns E_MISSING_PARAM when refId missing", async () => {
		const result = await dispatchTool("tab_type", { tabId: 1 });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_MISSING_PARAM");
		}
	});

	it("tab_select returns E_MISSING_PARAM when refId missing", async () => {
		const result = await dispatchTool("tab_select", { tabId: 1 });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_MISSING_PARAM");
		}
	});

	it("tab_check returns E_MISSING_PARAM when refId missing", async () => {
		const result = await dispatchTool("tab_check", { tabId: 1 });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_MISSING_PARAM");
		}
	});

	it("tab_hover returns E_MISSING_PARAM when refId missing", async () => {
		const result = await dispatchTool("tab_hover", { tabId: 1 });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_MISSING_PARAM");
		}
	});

	it("tab_dblclick returns E_MISSING_PARAM when refId missing", async () => {
		const result = await dispatchTool("tab_dblclick", { tabId: 1 });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_MISSING_PARAM");
		}
	});

	it("tab_scroll sends scroll message with direction and amount", async () => {
		mockChrome.tabs.sendMessage.mockResolvedValue({});
		const result = await dispatchTool("tab_scroll", {
			tabId: 1,
			direction: "up",
			amount: 100,
		});
		expect(result.ok).toBe(true);
		expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
			action: "scroll",
			params: { direction: "up", amount: 100 },
		});
	});

	it("tab_back sends back message", async () => {
		mockChrome.tabs.sendMessage.mockResolvedValue({});
		const result = await dispatchTool("tab_back", { tabId: 1 });
		expect(result.ok).toBe(true);
		expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
			action: "back",
			params: {},
		});
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

	it("host_call returns ENOHANDLER when missing", async () => {
		const result = await executeMainThreadCommand({
			action: "host_nonexistent_handler_xyz",
			params: {},
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("ENOHANDLER");
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

// ─── 15. Acceptance criteria verification ────────────────────────

describe("acceptance criteria verification", () => {
	const runnerPath = path.resolve(__dirname, "runner.ts");

	it("AC-1: no switch statements in runner.ts", () => {
		const content = fs.readFileSync(runnerPath, "utf-8");
		// Exclude inline function switches by only matching standalone switch
		const matches = content.match(/\bswitch\b/g);
		expect(matches ?? []).toHaveLength(0);
	});

	it("AC-2: executeMainThreadCommand is ≤10 lines", () => {
		const content = fs.readFileSync(runnerPath, "utf-8");
		// Find the function definition
		const match = content.match(
			/export async function executeMainThreadCommand\([\s\S]*?^\}/m,
		);
		expect(match).toBeTruthy();
		const lines = match?.[0].split("\n");
		expect(lines.length).toBeLessThanOrEqual(10);
	});

	it("AC-3: listTools().length ≥130", () => {
		expect(listTools().length).toBeGreaterThanOrEqual(130);
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

	it("AC-13: normalizeParams uses Maps, no switch", () => {
		const content = fs.readFileSync(runnerPath, "utf-8");
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

// ─── 16. Registry core tests ─────────────────────────────────────
// These go LAST because clearRegistry() removes all tools and we
// do not attempt to re-register the full runner.ts suite.

describe("registry core", () => {
	beforeEach(() => {
		clearRegistry();
	});

	it("registerTool registers a tool and getTool retrieves it", () => {
		const tool = makeTestTool("test_get");
		registerTool(tool);
		expect(getTool("test_get")).toBeDefined();
		expect(getTool("test_get")?.action).toBe("test_get");
	});

	it("registerTool throws on duplicate action", () => {
		const tool = makeTestTool("test_dup");
		registerTool(tool);
		expect(() => registerTool(makeTestTool("test_dup"))).toThrow(
			'Tool "test_dup" is already registered',
		);
	});

	it("clearRegistry removes all tools", () => {
		registerTool(makeTestTool("test_clear_1"));
		registerTool(makeTestTool("test_clear_2"));
		expect(listTools().length).toBeGreaterThanOrEqual(2);
		clearRegistry();
		expect(listTools().length).toBe(0);
	});

	it("listTools returns all registered tools", () => {
		registerTool(makeTestTool("test_list_a"));
		registerTool(makeTestTool("test_list_b"));
		const docs = listTools();
		expect(docs.some((d) => d.action === "test_list_a")).toBe(true);
		expect(docs.some((d) => d.action === "test_list_b")).toBe(true);
	});

	it("dispatchTool calls handler and returns { ok: true, value }", async () => {
		registerTool(
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
		registerTool({
			action: "test_validate",
			namespace: "test",
			description: "Validation test",
			params: z.object({ name: z.string() }),
			returns: z.null(),
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

// ─── 17. Logging tests ───────────────────────────────────────────

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
		expect(finishFn).toHaveBeenCalledWith({ ok: false, handler: "host" });
		expect(result.ok).toBe(false);
	});
});
