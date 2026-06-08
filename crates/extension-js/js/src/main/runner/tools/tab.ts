/// <reference types="chrome" />
import { z } from "zod";
import { logger } from "../../../shared/logger.js";
import * as schemas from "../../../shared/schemas.js";
import {
	dispatchTool,
	registerJsCall,
	registerContentScriptJsCall,
	type CallContext,
	type ToolDocParam,
} from "../../../shared/tool-registry.js";
import type { DomFormatParams, DomSnapshotParams, FetchParams } from "../runtime.js";
import {
	makeError,
	asRecord,
	extractTabId,
	unwrapResult,
	getActiveTabId,
	resolveActiveTabId,
	executeSnapshotInTab,
	executeInTab,
	preflightScriptableTab,
	waitForTabLoad,
	handleFetch,
	handleHostCallAction,
	registerChromePassthrough,
	getElementByRefId,
	extractRefId,
	handleDomSnapshot,
	handleDomFormat,
	ensureDomSnapshot,
	throwIfAborted,
	DEFAULT_TIMEOUT_MS,
	DEFAULT_MAX_NODES,
	DEFAULT_SCROLL_AMOUNT,
	DEFAULT_POLL_INTERVAL_MS,
} from "../runtime.js";

async function runTabSnapshot(
	params: unknown,
	actionLabel: string,
): Promise<Record<string, unknown>> {
	const tabId = extractTabId(params);
	if (tabId === null) {
		throw makeError("No tab ID provided", "E_NO_TAB");
	}
	const obj = asRecord(params);
	const opts = asRecord(obj.options ?? obj);
	const maxNodes =
		typeof opts.max_nodes === "number" ? opts.max_nodes : DEFAULT_MAX_NODES;
	const blocked = await preflightScriptableTab(tabId);
	if (blocked && !blocked.ok) {
		throw makeError(
			blocked.error.message,
			blocked.error.code,
			blocked.error.category,
		);
	}
	const result = await executeSnapshotInTab(tabId, maxNodes);
	if (!result.ok) {
		throw makeError(
			`${actionLabel} failed for tab ${tabId}: ${result.error.message}`,
			result.error.code,
			result.error.category,
		);
	}
	if (result.value && typeof result.value === "object") {
		return result.value as Record<string, unknown>;
	}
	throw makeError(
		`${actionLabel} returned no data for tab ${tabId}`,
		"E_SNAPSHOT",
	);
}

// ─── Tab actions ─────────────────────────────────────────────────

registerJsCall({
	action: "tab_query",
	namespace: "web.tab",
	name: "query",
	description: "Query tabs",
	params: schemas.TabQueryParamsSchema,
	returns: schemas.ChromeTabArraySchema,
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const result = unwrapResult(
			await dispatchTool("chrome_tabs_query", [params]),
		);
		if (result == null) return [];
		if (!Array.isArray(result)) {
			throw makeError(
				`tab.query returned unexpected type: ${typeof result}`,
				"E_TAB_QUERY",
				"extension",
			);
		}
		return result;
	},
	paramTypes: [
		{
			name: "query",
			type: "object",
			required: false,
			description: "Tab query object (literal)",
		},
	],
	returnDoc: "Tab array",
	errorCode: "ECHROME",
	errorCategory: "extension",
	example: "web.tab.query({ active: true })",
});

registerJsCall({
	action: "tab_current",
	namespace: "web.tab",
	name: "current",
	description: "Get the active tab in the current window",
	params: z.object({}),
	returns: schemas.ChromeTabSchema,
	aliases: [{ namespace: "tab", name: "current" }],
	owner: "main-thread",
	handler: async (_params, _ctx) => {
		const tabId = await resolveActiveTabId();
		if (tabId === null) {
			throw new Error("No active tab available");
		}
		const tab = unwrapResult(
			await dispatchTool("chrome_tabs_get", [tabId]),
		) as Record<string, unknown>;
		return { ...tab, tabId: tab.id ?? tabId };
	},
	paramTypes: [],
	returnDoc: "Active tab object",
	errorCode: "E_TAB",
	errorCategory: "extension",
	example: "web.tab.current()",
});

registerJsCall({
	action: "tab_get",
	namespace: "web.tab",
	name: "get",
	description: "Get a tab by id",
	params: schemas.ChromeTabsGetParamsSchema,
	returns: schemas.ChromeTabSchema,
	fields: ["tabId"],
	aliases: [{ namespace: "tab", name: "get", fields: ["tabId"] }],
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const tabId = extractTabId(asRecord(params));
		return unwrapResult(await dispatchTool("chrome_tabs_get", [tabId]));
	},
	paramTypes: [
		{
			name: "tabId",
			type: "number",
			required: true,
			description: "Tab ID to get (literal)",
		},
	],
	returnDoc: "Tab object",
	errorCode: "ECHROME",
	errorCategory: "extension",
	example: "web.tab.get(123)",
});

registerJsCall({
	action: "tab_find",
	namespace: "web.tab",
	name: "find",
	description: "Find tabs matching a query",
	params: schemas.TabQueryParamsSchema,
	returns: schemas.ChromeTabArraySchema,
	aliases: [{ namespace: "tab", name: "find" }],
	owner: "main-thread",
	handler: async (params, _ctx) => {
		return unwrapResult(await dispatchTool("chrome_tabs_query", [params]));
	},
	paramTypes: [
		{
			name: "query",
			type: "object",
			required: false,
			description: "Tab query object (literal)",
		},
	],
	returnDoc: "Matching tabs",
	errorCode: "ECHROME",
	errorCategory: "extension",
	example: "web.tab.find({ url: \"*://example.com/*\" })",
});

registerJsCall({
	action: "tab_list",
	namespace: "web.tab",
	name: "list",
	description: "List all tabs",
	params: z.object({}),
	returns: schemas.ChromeTabArraySchema,
	aliases: [{ namespace: "tab", name: "list" }],
	owner: "main-thread",
	handler: async (_params, _ctx) => {
		return unwrapResult(await dispatchTool("chrome_tabs_query", [{}]));
	},
	paramTypes: [],
	returnDoc: "All tabs",
	errorCode: "ECHROME",
	errorCategory: "extension",
	example: "web.tab.list()",
});

registerJsCall({
	action: "tab_create",
	namespace: "web.tab",
	name: "create",
	description: "Create a tab",
	params: schemas.TabCreateParamsSchema,
	returns: schemas.ChromeTabSchema,
	fields: ["url"],
	aliases: [{ namespace: "tab", name: "create", fields: ["url"] }],
	owner: "main-thread",
	handler: async (params, _ctx) => {
		return unwrapResult(await dispatchTool("chrome_tabs_create", [params]));
	},
	paramTypes: [
		{
			name: "url",
			type: "string",
			required: false,
			description: "URL to open in new tab (url)",
		},
		{
			name: "active",
			type: "boolean",
			required: false,
			description: "Whether to focus the new tab (literal)",
		},
	],
	returnDoc: "Created tab",
	errorCode: "ECHROME",
	errorCategory: "extension",
	example: "web.tab.create(\"https://example.com\")",
});

registerJsCall({
	action: "tab_activate",
	namespace: "web.tab",
	name: "activate",
	description: "Activate a tab",
	params: schemas.TabActivateParamsSchema,
	returns: schemas.ChromeTabSchema,
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const tabId = typeof params === "number" ? params : extractTabId(params);
		if (tabId === null) {
			throw makeError("tab_activate requires a tabId", "E_MISSING_PARAM");
		}
		return unwrapResult(
			await dispatchTool("chrome_tabs_update", [tabId, { active: true }]),
		);
	},
	paramTypes: [
		{
			name: "tabId",
			type: "number",
			required: false,
			description: "Tab ID to activate (literal)",
		},
	],
	returnDoc: "Updated tab",
	errorCode: "E_MISSING_PARAM",
	example: "web.tab.activate(123)",
});

registerJsCall({
	action: "tab_close",
	namespace: "web.tab",
	name: "close",
	description: "Close a tab",
	params: schemas.TabCloseParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const tabId = typeof params === "number" ? params : extractTabId(params);
		if (tabId === null) {
			throw makeError("tab_close requires a tabId", "E_MISSING_PARAM");
		}
		return unwrapResult(await dispatchTool("chrome_tabs_remove", [tabId]));
	},
	paramTypes: [
		{
			name: "tabId",
			type: "number",
			required: false,
			description: "Tab ID to close (literal)",
		},
	],
	returnDoc: "null",
	errorCode: "E_MISSING_PARAM",
	example: "web.tab.close(123)",
});

registerJsCall({
	action: "tab_execute_script",
	namespace: "web.tab",
	name: "execute_script",
	description: "Execute script in a tab",
	params: schemas.TabExecuteScriptParamsSchema,
	returns: schemas.ChromeScriptResultSchema,
	owner: "main-thread",
	handler: async (params, _ctx) => {
		return unwrapResult(
			await dispatchTool("chrome_scripting_executeScript", [params]),
		);
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: false, description: "Tab ID (literal)" },
		{
			name: "script",
			type: "string",
			required: false,
			description: "Script to execute (literal)",
		},
	],
	returnDoc: "Script result",
	errorCode: "E_NO_TAB",
	example: "web.tab.execute_script({ tabId: 123, script: \"document.title\" })",
});

registerContentScriptJsCall({
	action: "tab_click",
	namespace: "web.tab",
	name: "click",
	description: "Click in a tab",
	params: schemas.TabClickParamsSchema,
	returns: schemas.PageActionResultSchema,
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID (literal)" },
		{
			name: "refId",
			type: "string",
			required: false,
			description: "Element reference ID (refId)",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label (label)",
		},
	],
	returnDoc: "Click result",
	errorCode: "E_NO_TAB",
	example: "web.tab.click({ tabId: 123, refId: \"e2\" })",
});

registerContentScriptJsCall({
	action: "tab_fill",
	namespace: "web.tab",
	name: "fill",
	description: "Fill in a tab",
	params: schemas.TabFillParamsSchema,
	returns: schemas.PageActionResultSchema,
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID (literal)" },
		{
			name: "refId",
			type: "string",
			required: false,
			description: "Element reference ID (refId)",
		},
		{
			name: "value",
			type: "string",
			required: false,
			description: "Value to fill (literal)",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label (label)",
		},
	],
	returnDoc: "Fill result",
	errorCode: "E_NO_TAB",
	example: "web.tab.fill({ tabId: 123, refId: \"e2\", value: \"hello\" })",
});

registerContentScriptJsCall({
	action: "tab_scroll_to",
	namespace: "web.tab",
	name: "scroll_to",
	description: "Scroll to position in a tab",
	params: schemas.TabScrollToParamsSchema,
	returns: schemas.PageActionResultSchema,
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID (literal)" },
		{ name: "x", type: "number", required: false, description: "X coordinate (literal)" },
		{ name: "y", type: "number", required: false, description: "Y coordinate (literal)" },
		{
			name: "refId",
			type: "string",
			required: false,
			description: "Element reference ID (refId)",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label (label)",
		},
	],
	returnDoc: "Scroll to result",
	errorCode: "E_NO_TAB",
	example: "web.tab.scroll_to({ tabId: 123, refId: \"e2\" })",
});

registerContentScriptJsCall({
	action: "tab_type",
	namespace: "web.tab",
	name: "type",
	description: "Type in a tab",
	params: schemas.TabTypeParamsSchema,
	returns: schemas.PageActionResultSchema,
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID (literal)" },
		{
			name: "refId",
			type: "string",
			required: false,
			description: "Element reference ID (refId)",
		},
		{
			name: "text",
			type: "string",
			required: false,
			description: "Text to type (literal)",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label (label)",
		},
	],
	returnDoc: "Type result",
	errorCode: "E_NO_TAB",
	example: "web.tab.type({ tabId: 123, refId: \"e2\", text: \"hello\" })",
});

registerContentScriptJsCall({
	action: "tab_press",
	namespace: "web.tab",
	name: "press",
	description: "Press a key in a tab",
	params: schemas.TabPressParamsSchema,
	returns: schemas.PageActionResultSchema,
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID (literal)" },
		{
			name: "key",
			type: "string",
			required: false,
			description: "Key to press (literal)",
		},
	],
	returnDoc: "Press result",
	errorCode: "E_NO_TAB",
	example: "web.tab.press({ tabId: 123, key: \"Enter\" })",
});

registerContentScriptJsCall({
	action: "tab_select",
	namespace: "web.tab",
	name: "select",
	description: "Select an option in a tab",
	params: schemas.TabSelectParamsSchema,
	returns: schemas.PageActionResultSchema,
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID (literal)" },
		{
			name: "refId",
			type: "string",
			required: false,
			description: "Element reference ID (refId)",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label (label)",
		},
		{
			name: "value",
			type: "string",
			required: false,
			description: "Option value to select (literal)",
		},
	],
	returnDoc: "Select result",
	errorCode: "E_NO_TAB",
	example: "web.tab.select({ tabId: 123, refId: \"e2\", value: \"option1\" })",
});

registerContentScriptJsCall({
	action: "tab_check",
	namespace: "web.tab",
	name: "check",
	description: "Check/uncheck in a tab",
	params: schemas.TabCheckParamsSchema,
	returns: schemas.PageActionResultSchema,
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID (literal)" },
		{
			name: "refId",
			type: "string",
			required: false,
			description: "Element reference ID (refId)",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label (label)",
		},
		{
			name: "checked",
			type: "boolean",
			required: false,
			description: "Whether to check or uncheck (literal)",
		},
	],
	returnDoc: "Check result",
	errorCode: "E_NO_TAB",
	example: "web.tab.check({ tabId: 123, refId: \"e2\", checked: true })",
});

registerContentScriptJsCall({
	action: "tab_hover",
	namespace: "web.tab",
	name: "hover",
	description: "Hover in a tab",
	params: schemas.TabHoverParamsSchema,
	returns: schemas.PageActionResultSchema,
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID (literal)" },
		{
			name: "refId",
			type: "string",
			required: false,
			description: "Element reference ID (refId)",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label (label)",
		},
	],
	returnDoc: "Hover result",
	errorCode: "E_NO_TAB",
	example: "web.tab.hover({ tabId: 123, refId: \"e2\" })",
});

registerContentScriptJsCall({
	action: "tab_unhover",
	namespace: "web.tab",
	name: "unhover",
	description: "Unhover in a tab",
	params: schemas.TabUnhoverParamsSchema,
	returns: schemas.PageActionResultSchema,
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID (literal)" },
	],
	returnDoc: "Unhover result",
	errorCode: "E_NO_TAB",
	example: "web.tab.unhover({ tabId: 123 })",
});

registerContentScriptJsCall({
	action: "tab_scroll",
	namespace: "web.tab",
	name: "scroll",
	description: "Scroll in a tab",
	params: schemas.TabScrollParamsSchema,
	returns: schemas.PageActionResultSchema,
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID (literal)" },
		{
			name: "direction",
			type: "string",
			required: false,
			description: "Scroll direction (up or down) (literal)",
		},
		{
			name: "amount",
			type: "number",
			required: false,
			description: "Scroll amount in pixels (literal)",
		},
	],
	returnDoc: "Scroll result",
	errorCode: "E_NO_TAB",
	example: "web.tab.scroll({ tabId: 123, direction: \"down\", amount: 500 })",
});

registerContentScriptJsCall({
	action: "tab_dblclick",
	namespace: "web.tab",
	name: "dblclick",
	description: "Double-click in a tab",
	params: schemas.TabDblClickParamsSchema,
	returns: schemas.PageActionResultSchema,
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID (literal)" },
		{
			name: "refId",
			type: "string",
			required: false,
			description: "Element reference ID (refId)",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label (label)",
		},
	],
	returnDoc: "Double-click result",
	errorCode: "E_NO_TAB",
	example: "web.tab.dblclick({ tabId: 123, refId: \"e2\" })",
});

registerJsCall({
	action: "tab_evaluate",
	namespace: "web.tab",
	name: "evaluate",
	description: "Evaluate script in a tab",
	params: schemas.TabEvaluateParamsSchema,
	returns: z.unknown(), // eval result can be any JS value
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const obj = asRecord(params);
		const tabId = extractTabId(params);
		const script = obj.script ?? obj.code ?? obj.js ?? "";
		return unwrapResult(
			await executeInTab(
				tabId,
				(code: unknown) => {
					try {
						return eval(String(code));
					} catch (e) {
						return { error: String(e) };
					}
				},
				[script],
			),
		);
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID (literal)" },
		{
			name: "script",
			type: "string",
			required: false,
			description: "Script to evaluate (literal)",
		},
		{
			name: "code",
			type: "string",
			required: false,
			description: "Alternative script code (literal)",
		},
		{
			name: "js",
			type: "string",
			required: false,
			description: "Alternative JS code (literal)",
		},
	],
	returnDoc: "Evaluation result",
	errorCode: "E_NO_TAB",
	example: "web.tab.evaluate({ tabId: 123, script: \"document.title\" })",
});

registerContentScriptJsCall({
	action: "tab_back",
	namespace: "web.tab",
	name: "back",
	description: "Go back in a tab",
	params: schemas.TabBackParamsSchema,
	returns: schemas.PageActionResultSchema,
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID (literal)" },
	],
	returnDoc: "Back result",
	errorCode: "E_NO_TAB",
	example: "web.tab.back({ tabId: 123 })",
});

registerJsCall({
	action: "tab_wait_for_load",
	namespace: "web.tab",
	name: "wait_for_load",
	description: "Wait for tab to load",
	params: schemas.TabWaitForLoadParamsSchema,
	returns: z.boolean(),
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const obj = asRecord(params);
		const tabId = extractTabId(params);
		const timeout = typeof obj.timeout === "number" ? obj.timeout : 30000;
		return unwrapResult(await waitForTabLoad(tabId, timeout));
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID (literal)" },
		{
			name: "timeout",
			type: "number",
			required: false,
			description: "Timeout in milliseconds (literal)",
		},
	],
	returnDoc: "true",
	errorCode: "E_NO_TAB",
	example: "web.tab.wait_for_load({ tabId: 123, timeout: 5000 })",
});

registerJsCall({
	action: "tab_fetch",
	namespace: "web.tab",
	name: "fetch",
	description: "Fetch from a tab",
	params: schemas.TabFetchParamsSchema,
	returns: schemas.FetchValueSchema,
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const obj = asRecord(params);
		const tabId = extractTabId(params);
		const url = obj.url ?? "";
		const options = obj.options ?? {};
		return unwrapResult(
			await executeInTab(
				tabId,
				(u: unknown, opts: unknown) => {
					return fetch(String(u), opts as RequestInit).then(async (resp) => {
						const text = await resp.text();
						return {
							status: resp.status,
							ok: resp.ok,
							headers: Object.fromEntries(resp.headers.entries()),
							body: text,
						};
					});
				},
				[url, options],
			),
		);
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID (literal)" },
		{
			name: "url",
			type: "string",
			required: false,
			description: "URL to fetch (url)",
		},
		{
			name: "options",
			type: "object",
			required: false,
			description: "Fetch options (literal)",
		},
	],
	returnDoc: "DTO with `{ body, headers, ok, status }` — not a native Response object",
	errorCode: "E_NO_TAB",
	example: "web.tab.fetch({ tabId: 123, url: \"https://api.example.com/data\" })",
});

registerJsCall({
	action: "tab_snapshot",
	namespace: "web.tab",
	name: "snapshot",
	description: "Get tab snapshot",
	params: schemas.TabSnapshotParamsSchema,
	returns: z.string(),
	fields: ["tabId"],
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const val = await runTabSnapshot(params, "tab.snapshot");
		if (typeof val.text === "string") {
			return val.text;
		}
		const tabId = extractTabId(params);
		throw makeError(
			`tab.snapshot returned no text for tab ${tabId}`,
			"E_SNAPSHOT",
		);
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID (literal)" },
		{
			name: "max_nodes",
			type: "number",
			required: false,
			description: "Maximum nodes to include (literal)",
		},
		{
			name: "options",
			type: "object",
			required: false,
			description: "Snapshot options (literal)",
		},
	],
	returnDoc: "Snapshot text",
	errorCode: "E_SNAPSHOT",
	example: "web.tab.snapshot({ tabId: 123 })",
});

registerJsCall({
	action: "tab_snapshot_text",
	namespace: "web.tab",
	name: "snapshot_text",
	description: "Get tab snapshot text",
	params: schemas.TabSnapshotTextParamsSchema,
	returns: z.string(),
	fields: ["tabId"],
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const val = await runTabSnapshot(params, "tab.snapshot_text");
		if (typeof val.text === "string") {
			return val.text;
		}
		const tabId = extractTabId(params);
		throw makeError(
			`tab.snapshot_text returned no text for tab ${tabId}`,
			"E_SNAPSHOT",
		);
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID (literal)" },
		{
			name: "max_nodes",
			type: "number",
			required: false,
			description: "Maximum nodes to include (literal)",
		},
		{
			name: "options",
			type: "object",
			required: false,
			description: "Snapshot options (literal)",
		},
	],
	returnDoc: "Snapshot text",
	errorCode: "E_SNAPSHOT",
	example: "web.tab.snapshot_text({ tabId: 123 })",
});

registerJsCall({
	action: "tab_snapshot_data",
	namespace: "web.tab",
	name: "snapshot_data",
	description: "Get tab snapshot data",
	params: schemas.TabSnapshotDataParamsSchema,
	returns: schemas.SnapshotResultSchema,
	fields: ["tabId"],
	owner: "main-thread",
	handler: async (params, _ctx) => {
		return runTabSnapshot(params, "tab.snapshot_data");
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID (literal)" },
		{
			name: "max_nodes",
			type: "number",
			required: false,
			description: "Maximum nodes to include (literal)",
		},
		{
			name: "options",
			type: "object",
			required: false,
			description: "Snapshot options (literal)",
		},
	],
	returnDoc: "Snapshot data",
	errorCode: "E_SNAPSHOT",
	example: "web.tab.snapshot_data({ tabId: 123 })",
});
