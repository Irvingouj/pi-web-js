/// <reference types="chrome" />
import {
	coerceWasmParams,
	type AsyncResponse,
} from "../../../shared/tool-registry.js";
import {
	DEFAULT_SCROLL_AMOUNT,
	DEFAULT_TIMEOUT_MS,
} from "./constants.js";
import { makeError } from "./types.js";
import { asRecord } from "./params-helpers.js";

export { asRecord, extractTabId } from "./params-helpers.js";

// ─── Main command dispatcher ─────────────────────────────────────

const scalarNormalizers = new Map<string, (v: number | bigint) => unknown>([
	["tab_back", (v) => ({ tabId: v })],
	["tab_unhover", (v) => ({ tabId: v })],
	["tab_wait_for_load", (v) => ({ tabId: v })],
	["tab_scroll", (v) => ({ tabId: v })],
]);

const arrayNormalizers = new Map<string, (arr: unknown[]) => unknown>([
	["tab_click", (p) => ({ tabId: p[0], refId: p[1] })],
	["tab_fill", (p) => ({ tabId: p[0], refId: p[1], value: p[2] })],
	["tab_type", (p) => ({ tabId: p[0], refId: p[1], text: p[2] })],
	["tab_press", (p) => ({ tabId: p[0], key: p[1] })],
	["tab_select", (p) => ({ tabId: p[0], refId: p[1], value: p[2] })],
	["tab_check", (p) => ({ tabId: p[0], refId: p[1], checked: p[2] ?? true })],
	["tab_hover", (p) => ({ tabId: p[0], refId: p[1] })],
	["tab_unhover", (p) => ({ tabId: p[0] })],
	[
		"tab_scroll",
		(p) => ({
			tabId: p[0],
			direction: p[1] ?? "down",
			amount: p[2] ?? DEFAULT_SCROLL_AMOUNT,
		}),
	],
	["tab_dblclick", (p) => ({ tabId: p[0], refId: p[1] })],
	["tab_back", (p) => ({ tabId: p[0] })],
	[
		"tab_wait_for_load",
		(p) => ({ tabId: p[0], timeout: p[1] ?? BigInt(DEFAULT_TIMEOUT_MS) }),
	],
	[
		"tab_scroll_to",
		(p) => ({ tabId: p[0], x: p[1] ?? 0, y: p[2] ?? 0, refId: p[3] ?? null }),
	],
	["tab_evaluate", (p) => ({ tabId: p[0], script: p[1] })],
	["tab_fetch", (p) => ({ tabId: p[0], url: p[1], options: p[2] ?? {} })],
	["tab_snapshot", (p) => ({ tabId: p[0], options: p[1] ?? {} })],
	["tab_snapshot_text", (p) => ({ tabId: p[0], options: p[1] ?? {} })],
	["tab_snapshot_data", (p) => ({ tabId: p[0], options: p[1] ?? {} })],
]);

export function normalizeParams(action: string, params: unknown): unknown {
	params = coerceWasmParams(params);
	if (typeof params === "number" || typeof params === "bigint") {
		const normalizer = scalarNormalizers.get(action);
		if (normalizer) return normalizer(params);
	}
	if (Array.isArray(params)) {
		const normalizer = arrayNormalizers.get(action);
		if (normalizer) return normalizer(params);
	}
	return params;
}

export function unwrapResult<T>(result: AsyncResponse<T>): T {
	if (!result.ok) {
		throw makeError(
			result.error.message,
			result.error.code,
			result.error.category,
		);
	}
	return result.value;
}
