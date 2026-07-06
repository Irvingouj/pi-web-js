// @vitest-environment jsdom
//
// Phase 1 test — per-session isolation of the abort signal.
//
// Background: `tool-registry.ts` held a single module-global
// `runnerAbortController`; main-thread tool helpers that poll (notably
// `pingTabContentScript`, whose retry loop called the argument-less
// `throwIfAborted()` every iteration) read that global on every tick. Two
// ExtensionSession instances in one document therefore shared one abort
// signal. Phase 1 replaces the global with a per-session signal threaded
// explicitly into every helper.
//
// These tests target the real behaviour change: each polling helper now takes
// its own `signal` and reacts only to THAT signal, never to some other
// session's. On main `pingTabContentScript(tabId, timeoutMs)` accepts no
// signal and reads the global, so aborting an unrelated controller has no
// effect (or, worse, aborting the global kills every session). After Phase 1,
// `pingTabContentScript(tabId, timeoutMs, signal)` aborts iff *its own*
// signal is aborted.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtensionSession } from "../src/main/index.js";
import {
	assertTabOwnership,
	extractTabIds,
	isTabReceivingAction,
} from "../src/main/runner/chrome/tab-ownership.js";
import { pingTabContentScript } from "../src/main/runner/tab/execute.js";
import {
	getActiveTabId,
	setActiveTabId,
} from "../src/main/tab-context.js";
import { TabTracker } from "../src/main/session/tab-tracker.js";

declare global {
	var chrome: {
		runtime: { id: string };
		tabs: {
			sendMessage: ReturnType<typeof vi.fn>;
			get: ReturnType<typeof vi.fn>;
		};
	};
}

describe("Phase 1: per-session abort signal in tab helpers", () => {
	beforeEach(() => {
		vi.stubGlobal("chrome", {
			runtime: { id: "test-extension-id" },
			tabs: {
				// Keep the content script perpetually unreachable so the retry
				// loop spins through throwIfAborted() on every iteration.
				sendMessage: vi.fn(() =>
					Promise.reject(new Error("Could not establish connection")),
				),
				get: vi.fn(() =>
					Promise.resolve({ id: 1, url: "https://example.com/" }),
				),
			},
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("pingTabContentScript aborts when its own signal is aborted", async () => {
		const controller = new AbortController();
		// Kick off the ping loop, then abort mid-flight.
		const pingPromise = pingTabContentScript(1, 2000, controller.signal);
		// Let one retry tick land so the loop is inside the while body.
		await new Promise((resolve) => setTimeout(resolve, 10));
		controller.abort();

		// throwIfAborted propagates as a rejection out of pingTabContentScript
		// (the caller, e.g. dispatchTool, catches and converts to an error
		// response). The point: it reacts to ITS OWN signal being aborted.
		await expect(pingPromise).rejects.toThrow(
			"Runner aborted: ExtensionSession stopped",
		);
	});

	it("pingTabContentScript ignores an unrelated session's abort signal", async () => {
		// Two independent controllers, as two ExtensionSession instances would
		// own. Aborting the OTHER one must not stop this ping loop.
		const ownController = new AbortController();
		const otherController = new AbortController();

		const pingPromise = pingTabContentScript(1, 400, ownController.signal);
		// Let the loop spin a little, then abort the UNRELATED controller.
		await new Promise((resolve) => setTimeout(resolve, 30));
		otherController.abort();
		await new Promise((resolve) => setTimeout(resolve, 30));
		// Own controller still unaborted -> loop must still be running.
		expect(ownController.signal.aborted).toBe(false);

		const result = await pingPromise;
		// The relay ran to its natural deadline (content script unreachable),
		// returning a content-script-missing error — NOT an abort.
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).not.toMatch(/aborted/i);
		}
	});

	it("pingTabContentScript without a signal does not abort on any controller", async () => {
		// Backwards-compat: callers that don't pass a signal (e.g. ad-hoc
		// scripts) must keep working regardless of any controller state.
		const someController = new AbortController();
		const pingPromise = pingTabContentScript(1, 300);
		await new Promise((resolve) => setTimeout(resolve, 20));
		someController.abort(); // must not affect the no-signal ping
		const result = await pingPromise;
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).not.toMatch(/aborted/i);
		}
	});
});

// ─── Phase 2: cross-window tab ownership ─────────────────────────
//
// VSCode-style isolation: each session belongs to one Chrome window and may
// only operate on tabs in THAT window. page.* (resolved active tab) and
// web.tab.* (explicit tabId) must both be rejected with E_TAB_NOT_OWNED when
// the target tab lives in another window, and chrome.tabs.sendMessage must
// never fire for such tabs.

interface Phase2Worker {
	postMessage: ReturnType<typeof vi.fn>;
	terminate: ReturnType<typeof vi.fn>;
	onmessage: ((e: MessageEvent) => void) | null;
	onerror: ((e: ErrorEvent) => void) | null;
	onmessageerror: ((e: MessageEvent) => void) | null;
}

describe("Phase 2: cross-window tab ownership", () => {
	let posts: unknown[];
	let bucket: Phase2Worker[];
	let sessions: ExtensionSession[];
	let sendMessage: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		posts = [];
		bucket = [];
		sessions = [];
		// Session's window is windowId 1. tabs.get returns whatever we program;
		// default to a tab in windowId 1 (owned).
		sendMessage = vi.fn(async () => ({ ok: true }));
		vi.stubGlobal("Worker", makeWorkerMock2(bucket, posts));
		vi.stubGlobal("URL", function () {
			return { toString: () => "mock-worker-url" };
		} as unknown as typeof URL);
		vi.stubGlobal("chrome", {
			runtime: { id: "test-extension-id" },
			tabs: {
				onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
				onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
				query: vi.fn(() => Promise.resolve([{ id: 1, windowId: 1 }])),
				get: vi.fn(() =>
					Promise.resolve({
						id: 1,
						status: "complete",
						url: "https://example.com/",
						windowId: 1,
					}),
				),
				sendMessage,
			},
			windows: { getCurrent: vi.fn(() => Promise.resolve({ id: 1 })) },
			scripting: { executeScript: vi.fn(() => Promise.resolve([])) },
		});
	});

	afterEach(async () => {
		for (const s of sessions) {
			try {
				await s.stopWith(Promise.resolve());
			} catch {
				/* ignore */
			}
		}
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	function relayResult(
		id: string,
	): { result?: { ok?: boolean; error?: { code?: string } } } | undefined {
		return posts.find(
			(m): m is { type: string; id?: string } =>
				typeof m === "object" &&
				m !== null &&
				(m as { type: string }).type === "asyncRelayResult" &&
				(m as { id?: string }).id === id,
		) as unknown as
			| { result?: { ok?: boolean; error?: { code?: string } } }
			| undefined;
	}

	it("rejects a page.* relay when the active tab belongs to another window", async () => {
		// Active tab resolves to tabId 1, but that tab is in windowId 999.
		(globalThis.chrome.tabs.get as ReturnType<typeof vi.fn>).mockImplementation(
			() =>
				Promise.resolve({
					id: 1,
					status: "complete",
					url: "https://x.com/",
					windowId: 999,
				}),
		);
		const [, worker] = await initOwnedSession(bucket, posts, sessions);

		worker.onmessage?.({
			data: {
				type: "asyncRelay",
				id: "r1",
				owner: "content-script",
				command: { action: "page_click", params: { refId: "e1" } },
			},
		} as MessageEvent);
		await new Promise((r) => setTimeout(r, 10));

		expect(relayResult("r1")?.result?.ok).toBe(false);
		expect(relayResult("r1")?.result?.error?.code).toBe("E_TAB_NOT_OWNED");
		expect(sendMessage).not.toHaveBeenCalled();
	});

	it("allows a page.* relay when the active tab is in this session's window", async () => {
		const [, worker] = await initOwnedSession(bucket, posts, sessions);
		sendMessage.mockImplementation(
			async (_t: number, m: Record<string, unknown>) =>
				m.action === "ping" ? { ok: true } : { ok: true, value: {} },
		);

		worker.onmessage?.({
			data: {
				type: "asyncRelay",
				id: "r2",
				owner: "content-script",
				command: { action: "page_click", params: { refId: "e1" } },
			},
		} as MessageEvent);
		await new Promise((r) => setTimeout(r, 10));

		expect(relayResult("r2")?.result?.ok).toBe(true);
		expect(sendMessage).toHaveBeenCalled();
	});

	it("rejects a web.tab.* relay with explicit tabId in another window", async () => {
		(globalThis.chrome.tabs.get as ReturnType<typeof vi.fn>).mockImplementation(
			() =>
				Promise.resolve({
					id: 5,
					status: "complete",
					url: "https://y.com/",
					windowId: 999,
				}),
		);
		const [, worker] = await initOwnedSession(bucket, posts, sessions);

		worker.onmessage?.({
			data: {
				type: "asyncRelay",
				id: "r3",
				owner: "content-script",
				tabPolicy: "required",
				command: { action: "tab_snapshot", params: { tabId: 5 } },
			},
		} as MessageEvent);
		await new Promise((r) => setTimeout(r, 10));

		expect(relayResult("r3")?.result?.ok).toBe(false);
		expect(relayResult("r3")?.result?.error?.code).toBe("E_TAB_NOT_OWNED");
		expect(sendMessage).not.toHaveBeenCalled();
	});
});

// ─── Follow-up: parity-tool window-ownership gate ────────────────
//
// Native-parity tools (chrome.tabs.sendMessage, chrome.scripting.executeScript,
// etc.) transport opaque NativeArgs and must not be reshaped (AGENTS.md), but
// they still must respect per-window isolation: a session may not inject into
// or message a tab in another window. The gate reads the tabId out of the
// (untouched) args and rejects before invoking Chrome.

// ─── Follow-up: parity-tool window-ownership gate (unit-level) ───
//
// assertTabOwnership reads tabIds out of untouched NativeArgs and rejects
// cross-window access. Direct unit tests avoid the capability/permission
// layer that gates the full relay path.

describe("parity-tool window-ownership gate", () => {
	beforeEach(() => {
		vi.stubGlobal("chrome", {
			runtime: { id: "test-extension-id" },
			tabs: {
				get: vi.fn(async (id: number) => ({ id, windowId: 999 })),
			},
		});
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("extractTabIds: tabs.* first-arg number", () => {
		expect(extractTabIds("chrome_tabs_sendMessage", [5, { hi: 1 }])).toEqual([
			5,
		]);
		expect(extractTabIds("chrome_tabs_update", [7, { url: "x" }])).toEqual([7]);
	});

	it("extractTabIds: tabs.remove accepts number or number[]", () => {
		expect(extractTabIds("chrome_tabs_remove", [3])).toEqual([3]);
		expect(extractTabIds("chrome_tabs_remove", [[1, 2, 3]])).toEqual([1, 2, 3]);
	});

	it("extractTabIds: scripting target.tabId / target.tabIds", () => {
		expect(
			extractTabIds("chrome_scripting_executeScript", [
				{ target: { tabId: 9 }, files: ["x.js"] },
			]),
		).toEqual([9]);
		expect(
			extractTabIds("chrome_scripting_insertCSS", [
				{ target: { tabIds: [1, 2] }, files: ["x.css"] },
			]),
		).toEqual([1, 2]);
	});

	it("extractTabIds returns [] for shapes it can't read", () => {
		expect(extractTabIds("chrome_tabs_sendMessage", [])).toEqual([]);
		expect(extractTabIds("chrome_scripting_executeScript", [{}])).toEqual([]);
	});

	it("assertTabOwnership rejects a foreign-window tab", async () => {
		await expect(
			assertTabOwnership(
				"chrome_tabs_sendMessage",
				[5, {}],
				1,
				globalThis.chrome,
			),
		).rejects.toMatchObject({ code: "E_TAB_NOT_OWNED" });
	});

	it("assertTabOwnership rejects scripting on a foreign-window tab", async () => {
		await expect(
			assertTabOwnership(
				"chrome_scripting_executeScript",
				[{ target: { tabId: 7 }, files: ["x.js"] }],
				1,
				globalThis.chrome,
			),
		).rejects.toMatchObject({ code: "E_TAB_NOT_OWNED" });
	});

	it("assertTabOwnership is a no-op when windowId is null", async () => {
		// Should not throw regardless of tab window.
		await expect(
			assertTabOwnership(
				"chrome_tabs_sendMessage",
				[5, {}],
				null,
				globalThis.chrome,
			),
		).resolves.toBeUndefined();
	});

	it("assertTabOwnership skips non-tab-receiving actions", async () => {
		await expect(
			assertTabOwnership("chrome_bookmarks_search", [[]], 1, globalThis.chrome),
		).resolves.toBeUndefined();
	});

	it("TAB_RECEIVING_ACTIONS membership is locked (write/message only, not reads)", () => {
		// Cross-window READS (chrome_tabs_get, chrome_tabs_query) are
		// intentionally NOT gated — only writes/messages to a tab id are.
		const gated = [
			"chrome_tabs_sendMessage",
			"chrome_tabs_update",
			"chrome_tabs_remove",
			"chrome_tabs_reload",
			"chrome_scripting_executeScript",
			"chrome_scripting_insertCSS",
			"chrome_scripting_removeCSS",
		];
		for (const a of gated) expect(isTabReceivingAction(a)).toBe(true);
		expect(isTabReceivingAction("chrome_tabs_get")).toBe(false);
		expect(isTabReceivingAction("chrome_tabs_query")).toBe(false);
		expect(isTabReceivingAction("chrome_bookmarks_search")).toBe(false);
	});
});

// ─── TabTracker: init + lifecycle (Plan B unit tests) ───────────
//
// TabTracker owns the per-session active-tab pointer + windowId-scoped
// chrome.tabs.* listeners. Init must resolve the initial active tab BEFORE
// returning; onRemoved must clear the pointer for OUR window only; onDetached
// (drag-out) drops the pointer; events for other windows are ignored.

describe("TabTracker: init + lifecycle", () => {
	let onActivated: (i: { tabId: number; windowId: number }) => void;
	let onUpdated: (
		id: number,
		c: { status?: string },
		t: { windowId?: number },
	) => void;
	let onAttached: (
		id: number,
		info: { newWindowId: number; newPosition: number },
	) => void;
	let onRemoved: (id: number, info: { windowId: number }) => void;
	let onDetached: (
		id: number,
		info: { oldWindowId: number; oldPosition: number },
	) => void;
	let removeSpies: {
		onActivated: ReturnType<typeof vi.fn>;
		onUpdated: ReturnType<typeof vi.fn>;
		onRemoved: ReturnType<typeof vi.fn>;
		onAttached: ReturnType<typeof vi.fn>;
		onDetached: ReturnType<typeof vi.fn>;
	};
	let tracker: TabTracker;

	beforeEach(() => {
		removeSpies = {
			onActivated: vi.fn(),
			onUpdated: vi.fn(),
			onRemoved: vi.fn(),
			onAttached: vi.fn(),
			onDetached: vi.fn(),
		};
		vi.stubGlobal("chrome", {
			runtime: { id: "test-extension-id" },
			tabs: {
				onActivated: {
					addListener: vi.fn(
						(f: (i: { tabId: number; windowId: number }) => void) =>
							(onActivated = f),
					),
					removeListener: removeSpies.onActivated,
				},
				onUpdated: {
					addListener: vi.fn(
						(
							f: (
								id: number,
								c: { status?: string },
								t: { windowId?: number },
							) => void,
						) => (onUpdated = f),
					),
					removeListener: removeSpies.onUpdated,
				},
				onRemoved: {
					addListener: vi.fn(
						(f: (id: number, i: { windowId: number }) => void) =>
							(onRemoved = f),
					),
					removeListener: removeSpies.onRemoved,
				},
				onAttached: {
					addListener: vi.fn(
						(
							f: (
								id: number,
								i: { newWindowId: number; newPosition: number },
							) => void,
						) => (onAttached = f),
					),
					removeListener: removeSpies.onAttached,
				},
				onDetached: {
					addListener: vi.fn(
						(
							f: (
								id: number,
								i: { oldWindowId: number; oldPosition: number },
							) => void,
						) => (onDetached = f),
					),
					removeListener: removeSpies.onDetached,
				},
				query: vi.fn(async () => [{ id: 42, windowId: 1 }]),
				sendMessage: vi.fn(async () => ({ ok: true })),
			},
		});
		tracker = new TabTracker(globalThis.chrome, 1);
	});

	afterEach(() => {
		tracker.dispose();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("init resolves the initial active tab before returning", async () => {
		await tracker.init();
		expect(tracker.getActiveTabId()).toBe(42);
	});

	it("clears activeTabId when the active tab is closed (onRemoved, our window)", async () => {
		await tracker.init();
		expect(tracker.getActiveTabId()).toBe(42);
		onRemoved?.(42, { windowId: 1 });
		expect(tracker.getActiveTabId()).toBeNull();
	});

	it("ignores onRemoved for other windows (profile-broadcast)", async () => {
		await tracker.init();
		tracker.setActiveTabId(7);
		onRemoved?.(99, { windowId: 55 });
		expect(tracker.getActiveTabId()).toBe(7);
	});

	it("drops the pointer on drag-out (onDetached oldWindowId===ours)", async () => {
		await tracker.init();
		expect(tracker.getActiveTabId()).toBe(42);
		onDetached?.(42, { oldWindowId: 1, oldPosition: 0 });
		expect(tracker.getActiveTabId()).toBeNull();
	});

	it("ignores drag-out for other windows", async () => {
		await tracker.init();
		onDetached?.(777, { oldWindowId: 55, oldPosition: 0 });
		expect(tracker.getActiveTabId()).toBe(42);
	});

	it("re-resolves lazily after the pointer is cleared", async () => {
		await tracker.init();
		onDetached?.(42, { oldWindowId: 1, oldPosition: 0 });
		expect(tracker.getActiveTabId()).toBeNull();
		// query still returns 42 in this mock; lazy re-query re-adopts it.
		expect(await tracker.resolveActiveTabId()).toBe(42);
	});

	it("dispose removes listeners (idempotent)", async () => {
		await tracker.init();
		tracker.dispose();
		// All five listeners are actually removed (not just "no throw"):
		expect(removeSpies.onActivated).toHaveBeenCalledTimes(1);
		expect(removeSpies.onUpdated).toHaveBeenCalledTimes(1);
		expect(removeSpies.onRemoved).toHaveBeenCalledTimes(1);
		expect(removeSpies.onAttached).toHaveBeenCalledTimes(1);
		expect(removeSpies.onDetached).toHaveBeenCalledTimes(1);
		tracker.dispose(); // idempotent — no second removeListener calls
		expect(removeSpies.onActivated).toHaveBeenCalledTimes(1);
	});

	// ─── tab merged back into our window ─────────────────────────
	// User drags the active tab out to a new window, then drags it back.
	// The pointer must recover — either via onActivated (event path) or via
	// lazy re-resolve (fallback path). Tab id is stable across the drag.

	it("recovers the pointer when a dragged-out tab returns via onActivated", async () => {
		await tracker.init();
		expect(tracker.getActiveTabId()).toBe(42);
		// drag out to window 999
		onDetached?.(42, { oldWindowId: 1, oldPosition: 0 });
		onAttached?.(42, { newWindowId: 999, newPosition: 0 });
		expect(tracker.getActiveTabId()).toBeNull();
		// drag back into our window + Chrome activates it here
		onDetached?.(42, { oldWindowId: 999, oldPosition: 0 });
		onAttached?.(42, { newWindowId: 1, newPosition: 0 });
		onActivated?.({ tabId: 42, windowId: 1 });
		expect(tracker.getActiveTabId()).toBe(42);
	});

	it("lazy re-resolve recovers when onActivated does not fire on merge-back", async () => {
		await tracker.init();
		onDetached?.(42, { oldWindowId: 1, oldPosition: 0 });
		expect(tracker.getActiveTabId()).toBeNull();
		// Tab returns to our window but Chrome does NOT fire onActivated in
		// window 1 (e.g. another tab stayed active). The cached pointer is
		// still null — the next page.* must re-resolve to window 1's current
		// active tab, which the mock now reports as id 5.
		(
			globalThis.chrome.tabs.query as ReturnType<typeof vi.fn>
		).mockResolvedValue([{ id: 5, windowId: 1 }]);
		expect(await tracker.resolveActiveTabId()).toBe(5);
		expect(tracker.getActiveTabId()).toBe(5);
	});

	it("onAttached alone does NOT grab a merged-back tab (no agent interruption)", async () => {
		await tracker.init();
		tracker.setActiveTabId(7); // agent is mid-flight on tab 7
		// some other tab (99) is dragged into our window
		onAttached?.(99, { newWindowId: 1, newPosition: 0 });
		expect(tracker.getActiveTabId()).toBe(7); // untouched
	});

	// ─── B2: onUpdated listener ──────────────────────────────────
	it("onUpdated re-points on status:complete (our window) and pings the tab", async () => {
		await tracker.init();
		expect(tracker.getActiveTabId()).toBe(42);
		// A non-complete update in our window must NOT re-point.
		onUpdated?.(55, { status: "loading" }, { windowId: 1 });
		expect(tracker.getActiveTabId()).toBe(42);
		// complete in our window → re-point + ping.
		onUpdated?.(55, { status: "complete" }, { windowId: 1 });
		expect(tracker.getActiveTabId()).toBe(55);
		expect(globalThis.chrome.tabs.sendMessage).toHaveBeenCalledWith(55, {
			action: "ping",
		});
	});

	it("onUpdated ignores updates for other windows (profile-broadcast)", async () => {
		await tracker.init();
		onUpdated?.(99, { status: "complete" }, { windowId: 55 });
		expect(tracker.getActiveTabId()).toBe(42);
		expect(globalThis.chrome.tabs.sendMessage).not.toHaveBeenCalled();
	});

	// ─── W2: drag-out of a NON-active tab ────────────────────────
	it("drag-out of a non-active tab does not clear the pointer", async () => {
		await tracker.init();
		expect(tracker.getActiveTabId()).toBe(42);
		// tab 77 is in our window but is NOT the active tab — dragging it out
		// must not touch our pointer.
		onDetached?.(77, { oldWindowId: 1, oldPosition: 2 });
		expect(tracker.getActiveTabId()).toBe(42);
	});

	// ─── W3: resolveActiveTabId edge branches ────────────────────
	it("resolveActiveTabId returns null when query returns empty", async () => {
		await tracker.init();
		onDetached?.(42, { oldWindowId: 1, oldPosition: 0 });
		expect(tracker.getActiveTabId()).toBeNull();
		(
			globalThis.chrome.tabs.query as ReturnType<typeof vi.fn>
		).mockResolvedValue([]);
		expect(await tracker.resolveActiveTabId()).toBeNull();
	});

	it("resolveActiveTabId returns null when query throws", async () => {
		await tracker.init();
		onDetached?.(42, { oldWindowId: 1, oldPosition: 0 });
		(
			globalThis.chrome.tabs.query as ReturnType<typeof vi.fn>
		).mockRejectedValue(new Error("boom"));
		expect(await tracker.resolveActiveTabId()).toBeNull();
	});

	it("resolveActiveTabId uses {active:true} only when windowId is null", async () => {
		const nullWindowTracker = new TabTracker(globalThis.chrome, null);
		await nullWindowTracker.init();
		// Clear the cached pointer so resolveActiveTabId actually re-queries.
		nullWindowTracker.setActiveTabId(null);
		(
			globalThis.chrome.tabs.query as ReturnType<typeof vi.fn>
		).mockResolvedValue([]);
		expect(await nullWindowTracker.resolveActiveTabId()).toBeNull();
		expect(globalThis.chrome.tabs.query).toHaveBeenLastCalledWith({
			active: true,
		});
		nullWindowTracker.dispose();
	});

	// ─── W4: TabTracker.resolveTabId direct unit tests ───────────
	it("resolveTabId: explicit tabId wins (bigint + number)", async () => {
		await tracker.init();
		expect(await tracker.resolveTabId("required", { tabId: 9n })).toBe(9);
		expect(await tracker.resolveTabId("required", { tab_id: 100 })).toBe(100);
	});

	it("resolveTabId: rejects unsafe bigint", async () => {
		await tracker.init();
		await expect(
			tracker.resolveTabId("required", {
				tabId: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
			}),
		).rejects.toThrow("tabId must be a finite number or safe integer bigint");
	});

	it("resolveTabId: required policy throws when no explicit tabId", async () => {
		await tracker.init();
		await expect(tracker.resolveTabId("required", {})).rejects.toThrow(
			"tabId is required",
		);
	});

	it("resolveTabId: active policy falls back to active tab lazily", async () => {
		await tracker.init();
		onDetached?.(42, { oldWindowId: 1, oldPosition: 0 });
		// cached pointer null; lazy re-query returns id 42 in this mock.
		expect(await tracker.resolveTabId("active", {})).toBe(42);
	});
});

// ─── Follow-up: two-session integration isolation ───────────────
//
// Closes the Phase 1 loop at integration level: two REAL ExtensionSession
// instances in one document. Stopping one must not settle the other's
// in-flight main-thread relay (the bug that the module-global AbortController
// caused on main).

describe("two-session integration: stop isolation", () => {
	let posts: unknown[];
	let bucket: Phase2Worker[];
	let sessions: ExtensionSession[];

	beforeEach(() => {
		posts = [];
		bucket = [];
		sessions = [];
		vi.stubGlobal("Worker", makeWorkerMock2(bucket, posts));
		vi.stubGlobal("URL", function () {
			return { toString: () => "mock-worker-url" };
		} as unknown as typeof URL);
		vi.stubGlobal("chrome", {
			runtime: { id: "test-extension-id" },
			tabs: {
				onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
				onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
				onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
				query: vi.fn(() => Promise.resolve([{ id: 1, windowId: 1 }])),
				get: vi.fn(() =>
					Promise.resolve({
						id: 1,
						status: "complete",
						url: "https://example.com/",
						windowId: 1,
					}),
				),
				sendMessage: vi.fn(async () => ({ ok: true })),
			},
			windows: { getCurrent: vi.fn(() => Promise.resolve({ id: 1 })) },
			scripting: { executeScript: vi.fn(() => Promise.resolve([])) },
		});
	});

	afterEach(async () => {
		for (const s of sessions) {
			try {
				await s.stopWith(Promise.resolve());
			} catch {
				/* ignore */
			}
		}
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	function relayResult(
		id: string,
	): { result?: { ok?: boolean; error?: { code?: string } } } | undefined {
		return posts.find(
			(m): m is { type: string; id?: string } =>
				typeof m === "object" &&
				m !== null &&
				(m as { type: string }).type === "asyncRelayResult" &&
				(m as { id?: string }).id === id,
		) as unknown as
			| { result?: { ok?: boolean; error?: { code?: string } } }
			| undefined;
	}

	it("stopping session B leaves session A's in-flight fetch relay intact", async () => {
		const fetchResolvers: Array<(r: Response) => void> = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(
				() =>
					new Promise<Response>((resolve) => {
						fetchResolvers.push(resolve);
					}),
			),
		);
		const makeMockResponse = (url: string): Response =>
			({
				url,
				ok: true,
				status: 200,
				statusText: "OK",
				headers: new Map(),
				text: () => Promise.resolve(""),
				json: () => Promise.resolve({}),
				blob: () => Promise.resolve(new Blob()),
				arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
			}) as unknown as Response;

		const [, workerA] = await initOwnedSession(bucket, posts, sessions);
		const [, runnerB] = await initOwnedSession(bucket, posts, sessions);

		// A fires a main-thread fetch relay; it parks on the pending fetch promise.
		workerA.onmessage?.({
			data: {
				type: "asyncRelay",
				id: "ia",
				owner: "main-thread",
				command: { action: "fetch", params: { url: "https://a.example.com/" } },
			},
		} as MessageEvent);
		await Promise.resolve();

		// Stop B. On main (module-global abort) A's relay would die with E_ABORT.
		await sessions[1].stopWith(runnerB);

		// A's relay is still pending (no result yet) — it survived B's stop.
		expect(relayResult("ia")).toBeUndefined();

		// Resolving A's fetch must complete the relay cleanly.
		fetchResolvers[0]?.(makeMockResponse("https://a.example.com/"));
		await new Promise((r) => setTimeout(r, 5));
		expect(relayResult("ia")?.result?.ok).toBe(true);
	});

	it("two sessions each own an independent AbortController", async () => {
		// Smoke test: both sessions init, run a trivial cell, and settle without
		// interfering. Guards against accidental shared-state regressions.
		const [sA, workerA] = await initOwnedSession(bucket, posts, sessions);
		const [sB, workerB] = await initOwnedSession(bucket, posts, sessions);
		expect(sA).not.toBe(sB);
		expect(workerA).not.toBe(workerB);
		// Both report ready and are independently usable.
		expect(sA.isReady ?? true).toBe(true);
		expect(sB.isReady ?? true).toBe(true);
	});
});

// ─── Plan B: tab drag-out / drag-in isolation ───────────────────
//
// chrome.tabs.* events are profile-broadcast (Chromium source confirms
// EventRouter::BroadcastEvent): every sidepanel document receives every tab
// event for every window. So per-window isolation must filter by windowId
// inside the listener. When a tab is dragged out of this session's window
// (onDetached with oldWindowId === ours) AND it was the active tab, the
// session must drop the stale pointer so the next page.* re-resolves instead
// of hitting a gone tab.

describe("Plan B: tab drag-out / drag-in", () => {
	let posts: unknown[];
	let bucket: Phase2Worker[];
	let sessions: ExtensionSession[];
	let listeners: {
		onActivated?: (i: { tabId: number; windowId: number }) => void;
		onUpdated?: (
			id: number,
			c: { status?: string },
			tab: { windowId: number },
		) => void;
		onRemoved?: (id: number, info: { windowId: number }) => void;
		onAttached?: (
			id: number,
			info: { newWindowId: number; newPosition: number },
		) => void;
		onDetached?: (
			id: number,
			info: { oldWindowId: number; oldPosition: number },
		) => void;
	};

	beforeEach(() => {
		posts = [];
		bucket = [];
		sessions = [];
		listeners = {};
		vi.stubGlobal("Worker", makeWorkerMock2(bucket, posts));
		vi.stubGlobal("URL", function () {
			return { toString: () => "mock-worker-url" };
		} as unknown as typeof URL);
		vi.stubGlobal("chrome", {
			runtime: { id: "test-extension-id" },
			tabs: {
				onActivated: {
					addListener: vi.fn(
						(f: (i: { tabId: number; windowId: number }) => void) =>
							(listeners.onActivated = f),
					),
					removeListener: vi.fn(),
				},
				onUpdated: {
					addListener: vi.fn(
						(
							f: (
								id: number,
								c: { status?: string },
								t: { windowId: number },
							) => void,
						) => (listeners.onUpdated = f),
					),
					removeListener: vi.fn(),
				},
				onRemoved: {
					addListener: vi.fn(
						(f: (id: number, i: { windowId: number }) => void) =>
							(listeners.onRemoved = f),
					),
					removeListener: vi.fn(),
				},
				onAttached: {
					addListener: vi.fn(
						(
							f: (
								id: number,
								i: { newWindowId: number; newPosition: number },
							) => void,
						) => (listeners.onAttached = f),
					),
					removeListener: vi.fn(),
				},
				onDetached: {
					addListener: vi.fn(
						(
							f: (
								id: number,
								i: { oldWindowId: number; oldPosition: number },
							) => void,
						) => (listeners.onDetached = f),
					),
					removeListener: vi.fn(),
				},
				query: vi.fn(async () => [{ id: 42, windowId: 1 }]),
				// tab 42 starts in windowId 1 (this session's window).
				get: vi.fn(async (id: number) => ({
					id,
					status: "complete",
					url: "https://example.com/",
					windowId: 1,
				})),
				sendMessage: vi.fn(async (_t: number, m: Record<string, unknown>) =>
					m.action === "ping"
						? { ok: true }
						: { ok: true, value: { url: "https://example.com/" } },
				),
			},
			windows: { getCurrent: vi.fn(() => Promise.resolve({ id: 1 })) },
			scripting: { executeScript: vi.fn(() => Promise.resolve([])) },
		});
	});

	afterEach(async () => {
		for (const s of sessions) {
			try {
				await s.stopWith(Promise.resolve());
			} catch {
				/* ignore */
			}
		}
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("drops the active tab pointer when it is dragged out of this window", async () => {
		const [session, _worker] = await initOwnedSession(bucket, posts, sessions);
		// active tab is 42, in windowId 1 (ours).
		expect(await session.resolveActiveTabId?.()).toBe(42);

		// User drags tab 42 out to a new window 999.
		listeners.onDetached?.(42, { oldWindowId: 1, oldPosition: 0 });
		listeners.onAttached?.(42, { newWindowId: 999, newPosition: 0 });

		// The cached pointer must have cleared (drag-out drops it). We check the
		// cached value directly — resolveActiveTabId would lazily re-query and
		// mask the drop.
		expect(session.getActiveTabId?.()).not.toBe(42);
	});

	it("ignores drag-out events for tabs in OTHER windows (profile-broadcast)", async () => {
		const [session] = await initOwnedSession(bucket, posts, sessions);
		expect(await session.resolveActiveTabId?.()).toBe(42);

		// Some other window's tab (not ours) gets dragged around. Our windowId is 1,
		// so onDetached with oldWindowId 55 must NOT touch our active tab.
		listeners.onDetached?.(777, { oldWindowId: 55, oldPosition: 0 });

		expect(session.getActiveTabId?.()).toBe(42);
	});
});

// ─── W6: bindTabContext degrades gracefully when windows.getCurrent fails ──
//
// The session must still come up ready when windows.getCurrent throws or is
// absent: windowId stays null, the TabTracker is constructed with null
// windowId (ownership check skipped, listeners no-op-filtered), and
// resolveActiveTabId still works via the {active:true} query.

describe("bindTabContext: getCurrent failure/absence", () => {
	let bucket: Phase2Worker[];
	let posts: unknown[];
	let sessions: ExtensionSession[];

	beforeEach(() => {
		bucket = [];
		posts = [];
		sessions = [];
		vi.stubGlobal("Worker", makeWorkerMock2(bucket, posts));
		vi.stubGlobal("URL", function () {
			return { toString: () => "mock-worker-url" };
		} as unknown as typeof URL);
	});

	afterEach(async () => {
		for (const sess of sessions) {
			try {
				await sess.stopWith(Promise.resolve());
			} catch {
				/* ignore */
			}
		}
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("session inits when windows.getCurrent throws (windowId stays null)", async () => {
		vi.stubGlobal("chrome", {
			runtime: { id: "test-extension-id" },
			tabs: {
				onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
				onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
				query: vi.fn(async () => [{ id: 5 }]),
				get: vi.fn(async (id: number) => ({ id, windowId: 1 })),
				sendMessage: vi.fn(async () => ({ ok: true })),
			},
			windows: {
				getCurrent: vi.fn(() => Promise.reject(new Error("no permission"))),
			},
			scripting: { executeScript: vi.fn(() => Promise.resolve([])) },
		});
		const [session] = await initOwnedSession(bucket, posts, sessions);
		// windowId unknown → ownership skipped, but tracker still resolves active tab.
		expect(await session.resolveActiveTabId()).toBe(5);
		expect(session.getActiveTabId()).toBe(5);
	});

	it("session inits when windows.getCurrent is absent (windowId stays null)", async () => {
		vi.stubGlobal("chrome", {
			runtime: { id: "test-extension-id" },
			tabs: {
				onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
				onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
				query: vi.fn(async () => [{ id: 7 }]),
				get: vi.fn(async (id: number) => ({ id, windowId: 1 })),
				sendMessage: vi.fn(async () => ({ ok: true })),
			},
			// no windows key at all
			scripting: { executeScript: vi.fn(() => Promise.resolve([])) },
		});
		const [session] = await initOwnedSession(bucket, posts, sessions);
		expect(await session.resolveActiveTabId()).toBe(7);
	});

	it("session inits when windows.getCurrent returns no numeric id", async () => {
		vi.stubGlobal("chrome", {
			runtime: { id: "test-extension-id" },
			tabs: {
				onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
				onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
				query: vi.fn(async () => [{ id: 9 }]),
				get: vi.fn(async (id: number) => ({ id, windowId: 1 })),
				sendMessage: vi.fn(async () => ({ ok: true })),
			},
			windows: { getCurrent: vi.fn(async () => ({ id: undefined })) },
			scripting: { executeScript: vi.fn(() => Promise.resolve([])) },
		});
		const [session] = await initOwnedSession(bucket, posts, sessions);
		expect(await session.resolveActiveTabId()).toBe(9);
	});
});

// ─── Phase 2: cross-window tab ownership ─────────────────────────
//
// VSCode-style isolation: each session belongs to one Chrome window and may
// only operate on tabs in THAT window. page.* (resolved active tab) and
// web.tab.* (explicit tabId) must both be rejected with E_TAB_NOT_OWNED when
// the target tab lives in another window, and chrome.tabs.sendMessage must
// never fire for such tabs.

interface Phase2Worker {
	postMessage: ReturnType<typeof vi.fn>;
	terminate: ReturnType<typeof vi.fn>;
	onmessage: ((e: MessageEvent) => void) | null;
	onerror: ((e: ErrorEvent) => void) | null;
	onmessageerror: ((e: MessageEvent) => void) | null;
}

function makeWorkerMock2(
	bucket: Phase2Worker[],
	posts: unknown[],
): typeof Worker {
	return function () {
		const w: Phase2Worker = {
			postMessage: vi.fn((m: unknown) => posts.push(m)),
			terminate: vi.fn(),
			onmessage: null,
			onerror: null,
			onmessageerror: null,
		};
		bucket.push(w);
		return w;
	} as unknown as typeof Worker;
}

async function initOwnedSession(
	bucket: Phase2Worker[],
	posts: unknown[],
	sessions: ExtensionSession[],
): Promise<[ExtensionSession, Phase2Worker]> {
	const p = ExtensionSession.init();
	setTimeout(() => {
		bucket[bucket.length - 1]?.onmessage?.({ data: { type: "ready" } } as MessageEvent);
	}, 0);
	const [session] = await p;
	sessions.push(session);
	return [session, bucket[bucket.length - 1]];
}
