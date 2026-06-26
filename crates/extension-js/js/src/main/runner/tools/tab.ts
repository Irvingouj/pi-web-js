/// <reference types="chrome" />
import { z } from "zod";
import { CONTENT_SCRIPT_TOOL_SPECS } from "../../../shared/cross/content-script-tools.js";
import { defineContentScriptTool } from "../../../shared/main/define-content-script-tool.js";
import * as schemas from "../../../shared/cross/schemas.js";
import { dispatchTool, registerJsCall } from "../../../shared/main/tool-registry.js";
import {
	asRecord,
	extractTabId,
	makeError,
	resolveActiveTabId,
	unwrapResult,
	waitForTabLoad,
} from "../runtime.js";

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
			type: "{ active?: boolean, currentWindow?: boolean, url?: string }",
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
		return { ...tab, tabId: typeof tab.id === "number" ? tab.id : tabId };
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
			type: "{ active?: boolean, currentWindow?: boolean, url?: string }",
			required: false,
			description: "Tab query object (literal)",
		},
	],
	returnDoc: "Matching tabs",
	errorCode: "ECHROME",
	errorCategory: "extension",
	example: 'web.tab.find({ url: "*://example.com/*" })',
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
	example: 'web.tab.create("https://example.com")',
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

for (const spec of CONTENT_SCRIPT_TOOL_SPECS.filter(
	(s) => s.namespace === "web.tab",
)) {
	defineContentScriptTool(spec);
}

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
		{
			name: "tabId",
			type: "number",
			required: true,
			description: "Tab ID (literal)",
		},
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
