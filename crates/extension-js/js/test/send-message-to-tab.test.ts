// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveTabId } from "../src/main/tab-context.js";
import { sendMessageToTab } from "../src/main/runner/tab/messaging.js";

describe("sendMessageToTab", () => {
	beforeEach(() => {
		vi.stubGlobal("chrome", {
			runtime: { id: "test-extension" },
			tabs: {
				sendMessage: vi.fn(async (_tabId: number, msg: { action?: string }) => {
					if (msg.action === "ping") {
						return { ok: true };
					}
					return { ok: true, value: { ok: true, action: "click", refId: "e1" } };
				}),
				get: vi.fn(async () => ({ url: "https://example.com/" })),
			},
		});
		setActiveTabId(1);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		setActiveTabId(null);
	});

	it("returns E_NO_EXTENSION outside extension context", async () => {
		vi.stubGlobal("chrome", {
			runtime: {},
			tabs: { sendMessage: vi.fn(), get: vi.fn() },
		});
		const result = await sendMessageToTab(1, { action: "click" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_NO_EXTENSION");
		}
	});

	it("returns E_NO_TAB when no tab is resolved", async () => {
		setActiveTabId(null);
		const result = await sendMessageToTab(null, { action: "click" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_NO_TAB");
		}
	});

	it("returns E_CONTENT_SCRIPT when ping fails", async () => {
		const chrome = globalThis.chrome as {
			tabs: { sendMessage: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
		};
		chrome.tabs.sendMessage.mockRejectedValue(
			new Error("Receiving end does not exist."),
		);
		const result = await sendMessageToTab(1, { action: "click" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("E_CONTENT_SCRIPT");
			expect(result.error.hint).toContain("page.snapshot()");
		}
	});

	it("returns structured result after ping succeeds", async () => {
		const result = await sendMessageToTab(1, { action: "click" });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ ok: true, action: "click", refId: "e1" });
		}
	});
});
