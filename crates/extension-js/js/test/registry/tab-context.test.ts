// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { TabTracker } from "../../src/main/session/tab-tracker.js";
import {
	resolveActiveTabId,
	resolveTabId,
	setActiveTabId,
} from "../../src/main/tab-context.js";

describe("resolveTabId (bare-call fallback path)", () => {
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

describe("TabTracker init is idempotent", () => {
	it("registers listeners only once", async () => {
		const addActivated = vi.fn();
		const chromeApi = {
			runtime: { id: "ext-1" },
			tabs: {
				onActivated: { addListener: addActivated, removeListener: vi.fn() },
				onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
				onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
				onAttached: { addListener: vi.fn(), removeListener: vi.fn() },
				onDetached: { addListener: vi.fn(), removeListener: vi.fn() },
				query: vi.fn(() => Promise.resolve([{ id: 3, windowId: 1 }])),
				sendMessage: vi.fn(() => Promise.resolve()),
			},
		};
		vi.stubGlobal("chrome", chromeApi);
		const t = new TabTracker(chromeApi as unknown as typeof chrome, 1);
		await t.init();
		await t.init();
		expect(addActivated).toHaveBeenCalledTimes(1);
		t.dispose();
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});
