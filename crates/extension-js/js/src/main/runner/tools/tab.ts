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
	clearNetworkEntries,
	getNetworkEntry,
	listNetworkEntries,
} from "../lib/network-log-store.js";
import {
	asRecord,
	DEFAULT_TIMEOUT_MS,
	extractTabId,
	makeError,
	navigateTab,
	pingTabContentScript,
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
	handler: async (params, ctx) => {
		const result = unwrapResult(
			await dispatchTool("chrome_tabs_query", [params], ctx),
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
	handler: async (_params, ctx) => {
		// Isolation safety: a session-scoped call (windowId bound) MUST use the
		// session tracker resolver; the bare module-global queries `{active:true}`
		// unscoped and could resolve a foreign window's tab. Fallback only when
		// windowId is absent (bare dispatchTool / tests / demo).
		if (!ctx.resolveActiveTab && ctx.windowId !== undefined && ctx.windowId !== null) {
			throw new Error(
				"tab.current: session-scoped call is missing ctx.resolveActiveTab (per-session TabTracker resolver); refusing to fall back to the unscoped module-global.",
			);
		}
		const resolve = ctx.resolveActiveTab ?? resolveActiveTabId;
		const tabId = await resolve();
		if (tabId === null) {
			throw new Error("No active tab available");
		}
		const tab = unwrapResult(
			await dispatchTool("chrome_tabs_get", [tabId], ctx),
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
	handler: async (params, ctx) => {
		const tabId = extractTabId(asRecord(params));
		return unwrapResult(await dispatchTool("chrome_tabs_get", [tabId], ctx));
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
	action: "tab_url",
	namespace: "web.tab",
	name: "url",
	description: "Get the URL of a tab by id",
	params: schemas.TabUrlParamsSchema,
	returns: z.string(),
	fields: ["tabId"],
	aliases: [{ namespace: "tab", name: "url", fields: ["tabId"] }],
	owner: "main-thread",
	handler: async (params, ctx) => {
		const tabId = extractTabId(asRecord(params));
		const tab = unwrapResult(await dispatchTool("chrome_tabs_get", [tabId], ctx));
		return (tab as { url?: string }).url ?? "";
	},
	paramTypes: [
		{
			name: "tabId",
			type: "number",
			required: true,
			description: "Tab ID to get the URL for (literal)",
		},
	],
	returnDoc: "Tab URL string",
	errorCode: "ECHROME",
	errorCategory: "extension",
	example: "web.tab.url(123)",
});

registerJsCall({
	action: "tab_title",
	namespace: "web.tab",
	name: "title",
	description: "Get the title of a tab by id",
	params: schemas.TabTitleParamsSchema,
	returns: z.string(),
	fields: ["tabId"],
	aliases: [{ namespace: "tab", name: "title", fields: ["tabId"] }],
	owner: "main-thread",
	handler: async (params, ctx) => {
		const tabId = extractTabId(asRecord(params));
		const tab = unwrapResult(await dispatchTool("chrome_tabs_get", [tabId], ctx));
		return (tab as { title?: string }).title ?? "";
	},
	paramTypes: [
		{
			name: "tabId",
			type: "number",
			required: true,
			description: "Tab ID to get the title for (literal)",
		},
	],
	returnDoc: "Tab title string",
	errorCode: "ECHROME",
	errorCategory: "extension",
	example: "web.tab.title(123)",
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
	handler: async (params, ctx) => {
		return unwrapResult(await dispatchTool("chrome_tabs_query", [params], ctx));
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
	handler: async (_params, ctx) => {
		return unwrapResult(await dispatchTool("chrome_tabs_query", [{}], ctx));
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
	handler: async (params, ctx) => {
		const createParams = params as z.infer<
			typeof schemas.TabCreateParamsSchema
		>;
		const { waitForReady: _waitForReady, ...chromeCreateParams } = createParams;
		const created = unwrapResult(
			await dispatchTool("chrome_tabs_create", [chromeCreateParams], ctx),
		) as z.infer<typeof schemas.ChromeTabSchema>;
		const tabId = created.tabId ?? created.id;
		if (
			typeof tabId === "number" &&
			createParams.url &&
			createParams.waitForReady !== false &&
			(createParams.url.startsWith("http:") ||
				createParams.url.startsWith("https:"))
		) {
			return navigateTab({
				tabId,
				url: createParams.url,
				preNavigationUrl: created.url,
				timeoutMs: DEFAULT_TIMEOUT_MS,
				traceId: ctx.runId ?? "?",
				logPrefix: "tab_create",
				signal: ctx.signal,
			});
		}
		return created;
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
		{
			name: "waitForReady",
			type: "boolean",
			required: false,
			description:
				"Wait for page load and content-script readiness before returning. Defaults to true for http(s) URLs; set false for raw immediate tab creation.",
		},
	],
	returnDoc: "Created tab",
	errorCode: "ECHROME",
	errorCategory: "extension",
	example: 'web.tab.create("https://example.com")',
	agentMeta: {
		notes: [
			"For http(s) URLs, web.tab.create waits for page load/content-script readiness by default. Set waitForReady: false for raw immediate tab creation; call web.tab.goto({ tabId, url }) before snapshot/click/fill if Chrome has not committed the inactive tab URL.",
		],
		relatedApis: ["web.tab.goto", "web.tab.wait_for_load", "web.tab.snapshot"],
	},
});

registerJsCall({
	action: "tab_activate",
	namespace: "web.tab",
	name: "activate",
	description: "Activate a tab",
	params: schemas.TabActivateParamsSchema,
	returns: schemas.ChromeTabSchema,
	owner: "main-thread",
	handler: async (params, ctx) => {
		const tabId = typeof params === "number" ? params : extractTabId(params);
		if (tabId === null) {
			throw makeError("tab_activate requires a tabId", "E_MISSING_PARAM");
		}
		return unwrapResult(
			await dispatchTool("chrome_tabs_update", [tabId, { active: true }], ctx),
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
	handler: async (params, ctx) => {
		const tabId = typeof params === "number" ? params : extractTabId(params);
		if (tabId === null) {
			throw makeError("tab_close requires a tabId", "E_MISSING_PARAM");
		}
		return unwrapResult(await dispatchTool("chrome_tabs_remove", [tabId], ctx));
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
	handler: async (params, ctx) => {
		const obj = asRecord(params);
		const tabId = extractTabId(params);
		const timeout = typeof obj.timeout === "number" ? obj.timeout : 30000;
		if (tabId === null) {
			throw makeError("tab_wait_for_load requires a tabId", "E_MISSING_PARAM");
		}
		unwrapResult(await waitForTabLoad(tabId, timeout, { signal: ctx.signal }));
		unwrapResult(await pingTabContentScript(tabId, timeout, ctx.signal));
		return true;
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

const TabNetworkListParamsSchema = z.object({
	tabId: z.number().describe("Target tab ID"),
	all: z
		.boolean()
		.optional()
		.describe("Include every captured request type, not just backend calls"),
});

const TabNetworkGetParamsSchema = z.object({
	tabId: z.number().describe("Target tab ID"),
	id: z.string().min(1).describe("Network log entry id from list()"),
});

const TabNetworkClearParamsSchema = z.object({
	tabId: z.number().describe("Target tab ID"),
});

registerJsCall({
	action: "tab_network_list",
	namespace: "web.tab.network",
	name: "list",
	description:
		"List captured network requests for a tab. Defaults to backend-looking requests; pass { all: true } for all captured page-tab traffic.",
	params: TabNetworkListParamsSchema,
	returns: z.array(z.record(z.unknown())),
	returnType: "NetworkSummary[]",
	owner: "main-thread",
	handler: async (params, _ctx) => {
		return listNetworkEntries(params.tabId, params);
	},
	paramTypes: [
		{
			name: "tabId",
			type: "number",
			required: true,
			description: "Target tab ID",
		},
		{
			name: "all",
			type: "boolean",
			required: false,
			description: "Include static/document requests as well as backend calls",
		},
	],
	returnDoc: "Compact network request summaries",
	errorCode: "E_NO_TAB",
	example: "web.tab.network.list({ tabId: 123, all: true })",
});

registerJsCall({
	action: "tab_network_get",
	namespace: "web.tab.network",
	name: "get",
	description: "Get the full raw captured network entry for a tab",
	params: TabNetworkGetParamsSchema,
	returns: z.unknown(),
	returnType: "NetworkEntry",
	owner: "main-thread",
	handler: async (params, ctx) => {
		const entry = getNetworkEntry(params.tabId, params.id);
		if (!entry) {
			throw makeError(
				`Network entry not found for tab ${params.tabId}: ${params.id}`,
				"E_NOT_FOUND",
				"network",
			);
		}
		return entry;
	},
	paramTypes: [
		{
			name: "tabId",
			type: "number",
			required: true,
			description: "Target tab ID",
		},
		{
			name: "id",
			type: "string",
			required: true,
			description: "Network log entry id from web.tab.network.list()",
		},
	],
	returnDoc: "Full raw network request entry",
	errorCode: "E_NOT_FOUND",
	errorCategory: "network",
	example: 'web.tab.network.get({ tabId: 123, id: "n1" })',
});

registerJsCall({
	action: "tab_network_clear",
	namespace: "web.tab.network",
	name: "clear",
	description: "Clear captured network requests for a tab",
	params: TabNetworkClearParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (params, ctx) => {
		clearNetworkEntries(params.tabId);
		return null;
	},
	paramTypes: [
		{
			name: "tabId",
			type: "number",
			required: true,
			description: "Target tab ID",
		},
	],
	returnDoc: "null",
	errorCode: "E_NO_TAB",
	example: "web.tab.network.clear({ tabId: 123 })",
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

		const preNavResult = await dispatchTool("chrome_tabs_get", [tabId], ctx);
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
			signal: ctx.signal,
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
