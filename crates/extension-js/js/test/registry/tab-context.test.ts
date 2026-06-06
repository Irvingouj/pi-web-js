// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	initTabContext,
	removeTabContextListeners,
	resolveActiveTabId,
	resolveTabId,
	setActiveTabId,
} from "../../src/main/tab-context.js";

describe("resolveTabId", () => {
	it("accepts safe bigint tabId", () => {
		expect(resolveTabId("required", { tabId: 1n })).toBe(1);
	});

	it("accepts tab_id alias as bigint", () => {
		expect(resolveTabId("required", { tab_id: 42n })).toBe(42);
	});

	it("rejects unsafe bigint tabId", () => {
		expect(() =>
			resolveTabId("required", { tabId: BigInt(Number.MAX_SAFE_INTEGER) + 1n }),
		).toThrow("tabId must be a finite number or safe integer bigint");
	});

	it("falls back to active tab when policy is active", () => {
		setActiveTabId(7);
		expect(resolveTabId("active", {})).toBe(7);
	});

	it("initTabContext is idempotent", () => {
		const chromeApi = {
			runtime: { id: "ext-1" },
			tabs: {
				onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
				onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
				query: vi.fn(() => Promise.resolve([{ id: 3 }])),
				sendMessage: vi.fn(() => Promise.resolve()),
			},
		};
		vi.stubGlobal("chrome", chromeApi);
		initTabContext(chromeApi as unknown as typeof chrome);
		initTabContext(chromeApi as unknown as typeof chrome);
		expect(chromeApi.tabs.onActivated.addListener).toHaveBeenCalledTimes(1);
		removeTabContextListeners();
	});

	it("resolveActiveTabId queries chrome when cache is empty", async () => {
		setActiveTabId(null);
		const chromeApi = {
			runtime: { id: "ext-1" },
			tabs: {
				query: vi.fn(() => Promise.resolve([{ id: 42 }])),
			},
		};
		vi.stubGlobal("chrome", chromeApi);
		await expect(resolveActiveTabId()).resolves.toBe(42);
	});
});

afterEach(() => {
	removeTabContextListeners();
	vi.unstubAllGlobals();
});
