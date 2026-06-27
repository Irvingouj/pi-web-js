/// <reference types="chrome" />
import { z } from "zod";
import { CONTENT_SCRIPT_TOOL_SPECS } from "../../../shared/cross/content-script-tools.js";
import * as schemas from "../../../shared/cross/schemas.js";
import { defineContentScriptTool } from "../../../shared/main/define-content-script-tool.js";
import { logger } from "../../../shared/main/logger.js";
import {
	dispatchTool,
	registerJsCall,
} from "../../../shared/main/tool-registry.js";
import {
	asRecord,
	DEFAULT_TIMEOUT_MS,
	extractTabId,
	makeError,
	navigateTab,
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

registerJsCall({
	action: "tab_goto",
	namespace: "web.tab",
	name: "goto",
	description:
		"Navigate a specific tab to a URL (tab-scoped; avoids active-tab global state)",
	params: schemas.TabGotoParamsSchema,
	returns: schemas.ChromeTabSchema,
	fields: ["url"],
	owner: "main-thread",
	handler: async (params, ctx) => {
		const tabId = extractTabId(asRecord(params));
		if (tabId === null) {
			throw makeError("tab_goto requires a tabId", "E_MISSING_PARAM");
		}
		const traceId = ctx.runId ?? "?";
		logger.debug("tab_goto_start", {
			traceId,
			tabId,
			url: params.url,
			waitUntil: params.waitUntil ?? "load",
			timeoutMs: Number(params.timeout) || DEFAULT_TIMEOUT_MS,
		});

		if (!params.url.startsWith("http:") && !params.url.startsWith("https:")) {
			throw makeError(
				`Navigation blocked: URL scheme not supported (${params.url})`,
				"E_NAVIGATION",
				"navigation",
			);
		}

		const preNavResult = await dispatchTool("chrome_tabs_get", [tabId]);
		if (!preNavResult.ok || !preNavResult.value) {
			throw makeError(
				`tab_goto: tab ${tabId} not found`,
				"E_NO_TAB",
				"extension",
			);
		}
		const preNavTab = schemas.ChromeTabSchema.safeParse(preNavResult.value);
		if (!preNavTab.success) {
			throw makeError(
				`tab_goto: tab ${tabId} failed schema validation`,
				"E_UNKNOWN",
				"extension",
			);
		}
		const preNavigationUrl = preNavTab.data.url;

		if (
			preNavigationUrl &&
			(preNavigationUrl.startsWith("chrome-extension://") ||
				preNavigationUrl.startsWith("chrome://"))
		) {
			throw makeError(
				`Refusing to navigate tab ${tabId} (${preNavigationUrl}) — it is a chrome-extension:// or chrome:// page. Use web.tab.list() to find an http(s) tab.`,
				"E_PERMISSION",
				"navigation",
			);
		}

		const timeoutMs = Number(params.timeout) || DEFAULT_TIMEOUT_MS;
		return navigateTab({
			tabId,
			url: params.url,
			preNavigationUrl,
			waitUntil: params.waitUntil,
			timeoutMs,
			traceId,
			logPrefix: "tab_goto",
		});
	},
	paramTypes: [
		{
			name: "tabId",
			type: "number",
			required: true,
			description: "Tab ID to navigate (literal)",
		},
		{
			name: "url",
			type: "string",
			required: true,
			description: "URL to navigate to (url)",
		},
		{
			name: "waitUntil",
			type: '"load" | "networkidle"',
			required: false,
			description:
				"When to consider navigation complete. 'load' waits for tab status complete (default). 'networkidle' waits until no in-flight requests for 500ms.",
		},
	],
	returnDoc: "Updated tab",
	errorCode: "E_NAVIGATION",
	errorCategory: "navigation",
	example: 'web.tab.goto({ tabId: 42, url: "https://example.com" })',
});
