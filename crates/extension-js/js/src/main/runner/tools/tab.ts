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
	sendMessageToTab,
	getActiveTabId,
	resolveActiveTabId,
	executeInTab,
	waitForTabLoad,
	handleFetch,
	handleHostCallAction,
	registerChromePassthrough,
	getElementByRefId,
	extractRefId,
	handleDomSnapshot,
	handleDomFormat,
	ensureDomSnapshot,
	buildSnapshotInTab,
	throwIfAborted,
	DEFAULT_TIMEOUT_MS,
	DEFAULT_MAX_NODES,
	DEFAULT_SCROLL_AMOUNT,
	DEFAULT_POLL_INTERVAL_MS,
} from "../runtime.js";

// ─── Tab actions ─────────────────────────────────────────────────

registerJsCall({
	action: "tab_query",
	namespace: "tab",
	name: "query",
	description: "Query tabs",
	params: schemas.TabQueryParamsSchema,
	returns: schemas.ChromeTabArraySchema,
	owner: "main-thread",
	handler: async (params, _ctx) => {
		return unwrapResult(await dispatchTool("chrome_tabs_query", params));
	},
	paramTypes: [
		{
			name: "query",
			type: "object",
			required: false,
			description: "Tab query object",
		},
	],
	returnDoc: "Tab array",
	errorCode: "ECHROME",
	errorCategory: "extension",
});

registerJsCall({
	action: "tab_current",
	namespace: "tab",
	name: "current",
	description: "Get the active tab in the current window",
	params: z.object({}),
	returns: schemas.ChromeTabSchema,
	owner: "main-thread",
	handler: async (_params, _ctx) => {
		const tabId = await resolveActiveTabId();
		if (tabId === null) {
			throw new Error("No active tab available");
		}
		const tab = unwrapResult(
			await dispatchTool("chrome_tabs_get", { tabId }),
		) as Record<string, unknown>;
		return { ...tab, tabId: tab.id ?? tabId };
	},
	paramTypes: [],
	returnDoc: "Active tab object",
	errorCode: "E_TAB",
	errorCategory: "extension",
});

registerJsCall({
	action: "tab_get",
	namespace: "tab",
	name: "get",
	description: "Get a tab by id",
	params: schemas.ChromeTabsGetParamsSchema,
	returns: schemas.ChromeTabSchema,
	fields: ["tabId"],
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const tabId = extractTabId(asRecord(params));
		return unwrapResult(await dispatchTool("chrome_tabs_get", { tabId }));
	},
	paramTypes: [
		{
			name: "tabId",
			type: "number",
			required: true,
			description: "Tab ID to get",
		},
	],
	returnDoc: "Tab object",
	errorCode: "ECHROME",
	errorCategory: "extension",
});

registerJsCall({
	action: "tab_find",
	namespace: "tab",
	name: "find",
	description: "Find tabs matching a query",
	params: schemas.TabQueryParamsSchema,
	returns: schemas.ChromeTabArraySchema,
	owner: "main-thread",
	handler: async (params, _ctx) => {
		return unwrapResult(await dispatchTool("chrome_tabs_query", params));
	},
	paramTypes: [
		{
			name: "query",
			type: "object",
			required: false,
			description: "Tab query object",
		},
	],
	returnDoc: "Matching tabs",
	errorCode: "ECHROME",
	errorCategory: "extension",
});

registerJsCall({
	action: "tab_list",
	namespace: "tab",
	name: "list",
	description: "List all tabs",
	params: z.object({}),
	returns: schemas.ChromeTabArraySchema,
	owner: "main-thread",
	handler: async (_params, _ctx) => {
		return unwrapResult(await dispatchTool("chrome_tabs_query", {}));
	},
	paramTypes: [],
	returnDoc: "All tabs",
	errorCode: "ECHROME",
	errorCategory: "extension",
});

registerJsCall({
	action: "tab_create",
	namespace: "tab",
	name: "create",
	description: "Create a tab",
	params: schemas.TabCreateParamsSchema,
	returns: schemas.ChromeTabSchema,
	owner: "main-thread",
	handler: async (params, _ctx) => {
		return unwrapResult(await dispatchTool("chrome_tabs_create", params));
	},
	paramTypes: [
		{
			name: "url",
			type: "string",
			required: false,
			description: "URL to open in new tab",
		},
		{
			name: "active",
			type: "boolean",
			required: false,
			description: "Whether to focus the new tab",
		},
	],
	returnDoc: "Created tab",
	errorCode: "ECHROME",
	errorCategory: "extension",
});

registerJsCall({
	action: "tab_activate",
	namespace: "tab",
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
			await dispatchTool("chrome_tabs_update", {
				tabId,
				update: { active: true },
			}),
		);
	},
	paramTypes: [
		{
			name: "tabId",
			type: "number",
			required: false,
			description: "Tab ID to activate",
		},
	],
	returnDoc: "Updated tab",
	errorCode: "E_MISSING_PARAM",
});

registerJsCall({
	action: "tab_close",
	namespace: "tab",
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
		return unwrapResult(await dispatchTool("chrome_tabs_remove", { tabId }));
	},
	paramTypes: [
		{
			name: "tabId",
			type: "number",
			required: false,
			description: "Tab ID to close",
		},
	],
	returnDoc: "null",
	errorCode: "E_MISSING_PARAM",
});

registerJsCall({
	action: "tab_execute_script",
	namespace: "tab",
	name: "execute_script",
	description: "Execute script in a tab",
	params: schemas.TabExecuteScriptParamsSchema,
	returns: schemas.ChromeScriptResultSchema,
	owner: "main-thread",
	handler: async (params, _ctx) => {
		return unwrapResult(
			await dispatchTool("chrome_scripting_executeScript", params),
		);
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: false, description: "Tab ID" },
		{
			name: "script",
			type: "string",
			required: false,
			description: "Script to execute",
		},
	],
	returnDoc: "Script result",
	errorCode: "E_NO_TAB",
});

registerContentScriptJsCall({
	action: "tab_click",
	namespace: "tab",
	name: "click",
	description: "Click in a tab",
	params: schemas.TabClickParamsSchema,
	returns: z.null(),
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label",
		},
	],
	returnDoc: "Click result",
	errorCode: "E_NO_TAB",
});

registerContentScriptJsCall({
	action: "tab_fill",
	namespace: "tab",
	name: "fill",
	description: "Fill in a tab",
	params: schemas.TabFillParamsSchema,
	returns: z.null(),
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
		{
			name: "value",
			type: "string",
			required: false,
			description: "Value to fill",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label",
		},
	],
	returnDoc: "Fill result",
	errorCode: "E_NO_TAB",
});

registerContentScriptJsCall({
	action: "tab_scroll_to",
	namespace: "tab",
	name: "scroll_to",
	description: "Scroll to position in a tab",
	params: schemas.TabScrollToParamsSchema,
	returns: z.boolean(),
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{ name: "x", type: "number", required: false, description: "X coordinate" },
		{ name: "y", type: "number", required: false, description: "Y coordinate" },
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
	],
	returnDoc: "Scroll to result",
	errorCode: "E_NO_TAB",
});

registerContentScriptJsCall({
	action: "tab_type",
	namespace: "tab",
	name: "type",
	description: "Type in a tab",
	params: schemas.TabTypeParamsSchema,
	returns: z.null(),
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
		{
			name: "text",
			type: "string",
			required: false,
			description: "Text to type",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label",
		},
	],
	returnDoc: "Type result",
	errorCode: "E_NO_TAB",
});

registerContentScriptJsCall({
	action: "tab_press",
	namespace: "tab",
	name: "press",
	description: "Press a key in a tab",
	params: schemas.TabPressParamsSchema,
	returns: z.null(),
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "key",
			type: "string",
			required: false,
			description: "Key to press",
		},
	],
	returnDoc: "Press result",
	errorCode: "E_NO_TAB",
});

registerContentScriptJsCall({
	action: "tab_select",
	namespace: "tab",
	name: "select",
	description: "Select an option in a tab",
	params: schemas.TabSelectParamsSchema,
	returns: z.null(),
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
		{
			name: "value",
			type: "string",
			required: false,
			description: "Option value to select",
		},
	],
	returnDoc: "Select result",
	errorCode: "E_NO_TAB",
});

registerContentScriptJsCall({
	action: "tab_check",
	namespace: "tab",
	name: "check",
	description: "Check/uncheck in a tab",
	params: schemas.TabCheckParamsSchema,
	returns: z.null(),
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
		{
			name: "checked",
			type: "boolean",
			required: false,
			description: "Whether to check or uncheck",
		},
	],
	returnDoc: "Check result",
	errorCode: "E_NO_TAB",
});

registerContentScriptJsCall({
	action: "tab_hover",
	namespace: "tab",
	name: "hover",
	description: "Hover in a tab",
	params: schemas.TabHoverParamsSchema,
	returns: z.null(),
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
	],
	returnDoc: "Hover result",
	errorCode: "E_NO_TAB",
});

registerContentScriptJsCall({
	action: "tab_unhover",
	namespace: "tab",
	name: "unhover",
	description: "Unhover in a tab",
	params: schemas.TabUnhoverParamsSchema,
	returns: z.null(),
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
	],
	returnDoc: "Unhover result",
	errorCode: "E_NO_TAB",
});

registerContentScriptJsCall({
	action: "tab_scroll",
	namespace: "tab",
	name: "scroll",
	description: "Scroll in a tab",
	params: schemas.TabScrollParamsSchema,
	returns: z.boolean(),
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "direction",
			type: "string",
			required: false,
			description: "Scroll direction (up or down)",
		},
		{
			name: "amount",
			type: "number",
			required: false,
			description: "Scroll amount in pixels",
		},
	],
	returnDoc: "Scroll result",
	errorCode: "E_NO_TAB",
});

registerContentScriptJsCall({
	action: "tab_dblclick",
	namespace: "tab",
	name: "dblclick",
	description: "Double-click in a tab",
	params: schemas.TabDblClickParamsSchema,
	returns: z.null(),
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
	],
	returnDoc: "Double-click result",
	errorCode: "E_NO_TAB",
});

registerJsCall({
	action: "tab_evaluate",
	namespace: "tab",
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
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "script",
			type: "string",
			required: false,
			description: "Script to evaluate",
		},
		{
			name: "code",
			type: "string",
			required: false,
			description: "Alternative script code",
		},
		{
			name: "js",
			type: "string",
			required: false,
			description: "Alternative JS code",
		},
	],
	returnDoc: "Evaluation result",
	errorCode: "E_NO_TAB",
});

registerContentScriptJsCall({
	action: "tab_back",
	namespace: "tab",
	name: "back",
	description: "Go back in a tab",
	params: schemas.TabBackParamsSchema,
	returns: z.boolean(),
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
	],
	returnDoc: "Back result",
	errorCode: "E_NO_TAB",
});

registerJsCall({
	action: "tab_wait_for_load",
	namespace: "tab",
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
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "timeout",
			type: "number",
			required: false,
			description: "Timeout in milliseconds",
		},
	],
	returnDoc: "true",
	errorCode: "E_NO_TAB",
});

registerJsCall({
	action: "tab_fetch",
	namespace: "tab",
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
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "url",
			type: "string",
			required: false,
			description: "URL to fetch",
		},
		{
			name: "options",
			type: "object",
			required: false,
			description: "Fetch options",
		},
	],
	returnDoc: "Response object",
	errorCode: "E_NO_TAB",
});

registerJsCall({
	action: "tab_snapshot",
	namespace: "tab",
	name: "snapshot",
	description: "Get tab snapshot",
	params: schemas.TabSnapshotParamsSchema,
	returns: z.string(),
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
		const obj = asRecord(params);
		const opts = asRecord(obj.options ?? obj);
		const maxNodes =
			typeof opts.max_nodes === "number" ? opts.max_nodes : DEFAULT_MAX_NODES;
		const result = await executeInTab(activeTab, buildSnapshotInTab, [
			maxNodes,
		]);
		if (!result.ok) {
			throw makeError(
				result.error.message,
				result.error.code,
				result.error.category,
			);
		}
		if (result.value && typeof result.value === "object") {
			const val = result.value as Record<string, unknown>;
			return val.text as string;
		}
		throw makeError("Failed to get tab snapshot", "E_SNAPSHOT");
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "max_nodes",
			type: "number",
			required: false,
			description: "Maximum nodes to include",
		},
		{
			name: "options",
			type: "object",
			required: false,
			description: "Snapshot options",
		},
	],
	returnDoc: "Snapshot text",
	errorCode: "E_SNAPSHOT",
});

registerJsCall({
	action: "tab_snapshot_text",
	namespace: "tab",
	name: "snapshot_text",
	description: "Get tab snapshot text",
	params: schemas.TabSnapshotTextParamsSchema,
	returns: z.string(),
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
		const obj = asRecord(params);
		const opts = asRecord(obj.options ?? obj);
		const maxNodes =
			typeof opts.max_nodes === "number" ? opts.max_nodes : DEFAULT_MAX_NODES;
		const result = await executeInTab(activeTab, buildSnapshotInTab, [
			maxNodes,
		]);
		if (!result.ok) {
			throw makeError(
				result.error.message,
				result.error.code,
				result.error.category,
			);
		}
		if (result.value && typeof result.value === "object") {
			const val = result.value as Record<string, unknown>;
			return val.text as string;
		}
		throw makeError("Failed to get tab snapshot", "E_SNAPSHOT");
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "max_nodes",
			type: "number",
			required: false,
			description: "Maximum nodes to include",
		},
		{
			name: "options",
			type: "object",
			required: false,
			description: "Snapshot options",
		},
	],
	returnDoc: "Snapshot text",
	errorCode: "E_SNAPSHOT",
});

registerJsCall({
	action: "tab_snapshot_data",
	namespace: "tab",
	name: "snapshot_data",
	description: "Get tab snapshot data",
	params: schemas.TabSnapshotDataParamsSchema,
	returns: schemas.SnapshotResultSchema,
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
		const obj = asRecord(params);
		const opts = asRecord(obj.options ?? obj);
		const maxNodes =
			typeof opts.max_nodes === "number" ? opts.max_nodes : DEFAULT_MAX_NODES;
		const result = await executeInTab(activeTab, buildSnapshotInTab, [
			maxNodes,
		]);
		if (!result.ok) {
			throw makeError(
				result.error.message,
				result.error.code,
				result.error.category,
			);
		}
		if (result.value && typeof result.value === "object") {
			return result.value;
		}
		throw makeError("Failed to get tab snapshot", "E_SNAPSHOT");
	},
	paramTypes: [
		{ name: "tabId", type: "number", required: true, description: "Tab ID" },
		{
			name: "max_nodes",
			type: "number",
			required: false,
			description: "Maximum nodes to include",
		},
		{
			name: "options",
			type: "object",
			required: false,
			description: "Snapshot options",
		},
	],
	returnDoc: "Snapshot data",
	errorCode: "E_SNAPSHOT",
});
