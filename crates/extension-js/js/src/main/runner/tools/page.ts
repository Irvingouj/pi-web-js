/// <reference types="chrome" />
import { z } from "zod";
import { CONTENT_SCRIPT_TOOL_SPECS } from "../../../shared/cross/content-script-tools.js";
import type { CallContext } from "../../../shared/cross/manifest.js";
import {
	contentScriptMissingError,
	noTabError,
} from "../../../shared/cross/normalize-agent-error.js";
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
	CS_FAST_PING_MS,
	DEFAULT_TIMEOUT_MS,
	extractTabId,
	makeError,
	navigateTab,
	pingTabContentScript,
	preflightDomTab,
	resolveActiveTabId,
	throwAgentError,
	unwrapResult,
} from "../runtime.js";

async function requireActiveTab(
	action: string,
	ctx: CallContext,
): Promise<number> {
	// Per-session resolver (Plan B): the owning ExtensionSession's TabTracker,
	// injected via ctx as `resolveActiveTab`.
	//
	// Isolation safety: when `ctx.windowId` is bound (i.e. this call IS
	// session-scoped — ownership is in scope), the resolver MUST come from the
	// session tracker. The bare module-global `resolveActiveTabId` queries
	// `{active:true}` with no windowId filter, so it could resolve a tab in a
	// DIFFERENT window and silently break per-window isolation. We therefore
	// refuse it whenever windowId is known. The fallback is only合法 when
	// windowId is absent — direct dispatchTool calls with no session (tests,
	// low-level API, web-js demo with no Chrome window).
	if (
		!ctx.resolveActiveTab &&
		ctx.windowId !== undefined &&
		ctx.windowId !== null
	) {
		throwAgentError(
			makeError(
				`${action}: session-scoped call (windowId=${ctx.windowId}) is missing ctx.resolveActiveTab — the per-session TabTracker must inject the active-tab resolver. Falling back to the unscoped module-global would risk resolving a foreign window's tab.`,
				"E_NO_RESOLVER",
				"unknown",
			),
		);
	}
	const resolve = ctx.resolveActiveTab ?? resolveActiveTabId;
	const tabId = await resolve();
	if (tabId === null) {
		throwAgentError(noTabError(action));
	}
	return tabId;
}

// ─── Page actions ────────────────────────────────────────────────

registerJsCall({
	action: "page_url",
	namespace: "page",
	name: "url",
	description: "Get the URL of the active tab",
	params: schemas.PageUrlParamsSchema,
	returns: z.string(),
	owner: "main-thread",
	handler: async (_params, ctx) => {
		const activeTab = await requireActiveTab("page.url()", ctx);
		const tab = unwrapResult(
			await dispatchTool("chrome_tabs_get", [activeTab], ctx),
		) as { url?: string };
		return tab.url ?? "";
	},
	paramTypes: [],
	returnDoc: "URL string",
	errorCode: "E_NO_TAB",
	example: "page.url()",
});

registerJsCall({
	action: "page_title",
	namespace: "page",
	name: "title",
	description: "Get the title of the active tab",
	params: schemas.PageTitleParamsSchema,
	returns: z.string(),
	owner: "main-thread",
	handler: async (_params, ctx) => {
		const activeTab = await requireActiveTab("page.title()", ctx);
		const tab = unwrapResult(
			await dispatchTool("chrome_tabs_get", [activeTab], ctx),
		) as { title?: string };
		return tab.title ?? "";
	},
	paramTypes: [],
	returnDoc: "Title string",
	errorCode: "E_NO_TAB",
	example: "page.title()",
});

for (const spec of CONTENT_SCRIPT_TOOL_SPECS.filter(
	(s) => s.namespace === "page",
)) {
	defineContentScriptTool(spec);
}

registerJsCall({
	action: "page_goto",
	namespace: "page",
	name: "goto",
	description: "Navigate the active tab to a URL",
	params: schemas.PageGotoParamsSchema,
	returns: schemas.ChromeTabSchema,
	fields: ["url"],
	owner: "main-thread",
	handler: async (params, ctx) => {
		const activeTab = await requireActiveTab("page.goto()", ctx);
		const traceId = ctx.runId ?? "?";
		logger.debug("page_goto_start", {
			traceId,
			url: params.url,
			waitUntil: params.waitUntil ?? "load",
			timeoutMs: Number(params.timeout) || 30_000,
		});
		if (!params.url.startsWith("http:") && !params.url.startsWith("https:")) {
			throw makeError(
				`Navigation blocked: URL scheme not supported (${params.url})`,
				"E_NAVIGATION",
				"navigation",
			);
		}
		const preNavResult = await dispatchTool(
			"chrome_tabs_get",
			[activeTab],
			ctx,
		);
		const preNavTab =
			preNavResult.ok && preNavResult.value
				? schemas.ChromeTabSchema.safeParse(preNavResult.value)
				: undefined;
		const preNavigationUrl = preNavTab?.success
			? preNavTab.data.url
			: undefined;
		// Never navigate the Browsergent side panel or other chrome-extension:// pages.
		// page.goto targets the runner's active tab, which in side-panel contexts is
		// the extension page itself — navigating it destroys the UI and breaks the
		// worker relay permanently.
		if (
			preNavigationUrl &&
			(preNavigationUrl.startsWith("chrome-extension://") ||
				preNavigationUrl.startsWith("chrome://"))
		) {
			throw makeError(
				`Refusing to navigate the active tab (${preNavigationUrl}) — it is a chrome-extension:// or chrome:// page. Use web.tab.list() to find an http(s) tab, then web.tab.activate(tabId) before calling page.goto().`,
				"E_PERMISSION",
				"navigation",
			);
		}
		const timeoutMs = Number(params.timeout) || DEFAULT_TIMEOUT_MS;
		return navigateTab({
			tabId: activeTab,
			url: params.url,
			preNavigationUrl,
			waitUntil: params.waitUntil,
			timeoutMs,
			traceId,
			logPrefix: "page_goto",
			signal: ctx.signal,
		});
	},
	paramTypes: [
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
	returnDoc: "Tab update result",
	errorCode: "E_NAVIGATION",
	errorCategory: "navigation",
	example: 'page.goto("https://example.com", { waitUntil: "networkidle" })',
});

registerJsCall({
	action: "page_health",
	namespace: "page",
	name: "health",
	description: "Report tab readiness for mutations vs read-only snapshot APIs",
	params: schemas.PageHealthParamsSchema,
	returns: schemas.PageHealthResultSchema,
	owner: "main-thread",
	handler: async (_params, ctx) => {
		const tabId = await requireActiveTab("page.health()", ctx);
		const tab = unwrapResult(
			await dispatchTool("chrome_tabs_get", [tabId], ctx),
		) as { url?: string; title?: string };
		const url = tab.url ?? "";
		const title = tab.title ?? "";
		const urlPreflight = await preflightDomTab(tabId, ctx.signal);
		const domApis = urlPreflight && !urlPreflight.ok ? "blocked" : "ok";
		const pingResult = await pingTabContentScript(
			tabId,
			CS_FAST_PING_MS,
			ctx.signal,
		);
		const contentScript = pingResult.ok ? "connected" : "missing";
		const mutationsReady = domApis === "ok" && contentScript === "connected";
		const health: z.infer<typeof schemas.PageHealthResultSchema> = {
			tabId,
			url,
			title,
			contentScript,
			domApis,
			mutationsReady,
		};
		if (!mutationsReady) {
			if (domApis === "blocked") {
				health.hint =
					"This tab URL does not support DOM APIs. Only http(s) pages support page.* and web.tab.* DOM operations.";
				health.recovery = [
					"Navigate to an http(s) URL with await page.goto(url)",
				];
			} else {
				const guidance = contentScriptMissingError(tabId, url);
				health.hint = guidance.hint;
				health.recovery = guidance.recovery;
			}
		}
		return health;
	},
	paramTypes: [],
	returnDoc:
		"Tab health: contentScript connection and http(s) domApis readiness",
	errorCode: "E_NO_TAB",
	example: "page.health()",
});

const PageNetworkListParamsSchema = z
	.object({
		all: z
			.boolean()
			.optional()
			.describe("Include every captured request type, not just backend calls"),
	})
	.optional()
	.default({});

const PageNetworkGetParamsSchema = z.preprocess(
	(val) => (typeof val === "string" ? { id: val } : val),
	z.object({
		id: z.string().min(1).describe("Network log entry id from list()"),
	}),
);

registerJsCall({
	action: "page_network_list",
	namespace: "page.network",
	name: "list",
	description:
		"List captured network requests for the active tab. Defaults to backend-looking requests; pass { all: true } for all captured page-tab traffic.",
	params: PageNetworkListParamsSchema,
	returns: z.array(z.record(z.unknown())),
	returnType: "NetworkSummary[]",
	owner: "main-thread",
	handler: async (params, ctx) => {
		const activeTab = await requireActiveTab("page.network.list()", ctx);
		return listNetworkEntries(activeTab, params);
	},
	paramTypes: [
		{
			name: "all",
			type: "boolean",
			required: false,
			description: "Include static/document requests as well as backend calls",
		},
	],
	returnDoc: "Compact network request summaries",
	errorCode: "E_NO_TAB",
	example: "page.network.list({ all: true })",
});

registerJsCall({
	action: "page_network_get",
	namespace: "page.network",
	name: "get",
	description: "Get the full raw captured network entry for the active tab",
	params: PageNetworkGetParamsSchema,
	returns: z.unknown(),
	returnType: "NetworkEntry",
	fields: ["id"],
	owner: "main-thread",
	handler: async (params, ctx) => {
		const activeTab = await requireActiveTab("page.network.get()", ctx);
		const { id } = params as { id: string };
		const entry = getNetworkEntry(activeTab, id);
		if (!entry) {
			throw makeError(
				`Network entry not found for active tab: ${id}`,
				"E_NOT_FOUND",
				"network",
			);
		}
		return entry;
	},
	paramTypes: [
		{
			name: "id",
			type: "string",
			required: true,
			description: "Network log entry id from page.network.list()",
		},
	],
	returnDoc: "Full raw network request entry",
	errorCode: "E_NOT_FOUND",
	errorCategory: "network",
	example: 'page.network.get("n1")',
});

registerJsCall({
	action: "page_network_clear",
	namespace: "page.network",
	name: "clear",
	description: "Clear captured network requests for the active tab",
	params: z.object({}),
	returns: z.null(),
	owner: "main-thread",
	handler: async (_params, ctx) => {
		const activeTab = await requireActiveTab("page.network.clear()", ctx);
		clearNetworkEntries(activeTab);
		return null;
	},
	paramTypes: [],
	returnDoc: "null",
	errorCode: "E_NO_TAB",
	example: "page.network.clear()",
});

registerJsCall({
	action: "page_reload",
	namespace: "page",
	name: "reload",
	description: "Reload the active tab",
	params: schemas.PageReloadParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (_params, ctx) => {
		const activeTab = await requireActiveTab("page.reload()", ctx);
		return unwrapResult(
			await dispatchTool("chrome_tabs_reload", [activeTab], ctx),
		);
	},
	paramTypes: [],
	returnDoc: "null",
	errorCode: "E_NO_TAB",
	example: "page.reload()",
});

registerJsCall({
	action: "page_wait",
	namespace: "page",
	name: "wait",
	description: "Wait for a duration",
	params: schemas.PageWaitParamsSchema,
	returns: z.boolean(),
	fields: ["duration"],
	owner: "main-thread",
	handler: async (params, ctx) => {
		await new Promise((resolve) =>
			setTimeout(resolve, Number(params.duration)),
		);
		return true;
	},
	paramTypes: [
		{
			name: "duration",
			type: "number",
			required: false,
			description: "Duration to wait in milliseconds (literal)",
		},
	],
	returnDoc: "true",
	errorCode: "E_UNKNOWN",
	example: "page.wait(1000)",
});

registerJsCall({
	action: "page_close",
	namespace: "page",
	name: "close",
	description: "Close a tab",
	params: schemas.PageCloseParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (params, ctx) => {
		const tabId = typeof params === "number" ? params : extractTabId(params);
		if (tabId === null) {
			throw makeError("page_close requires a tabId", "E_MISSING_PARAM");
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
	example: "page.close(123)",
});

registerJsCall({
	action: "page_tabs",
	namespace: "page",
	name: "tabs",
	description: "Query tabs",
	params: schemas.TabQueryParamsSchema,
	returns: schemas.ChromeTabArraySchema,
	owner: "main-thread",
	handler: async (params, ctx) => {
		const tabs = unwrapResult(
			await dispatchTool("chrome_tabs_query", [params], ctx),
		);
		return (Array.isArray(tabs) ? tabs : []).map((t) => ({
			...t,
			tabId: t?.id,
		}));
	},
	paramTypes: [
		{
			name: "params",
			type: "{ active?: boolean, currentWindow?: boolean, url?: string }",
			required: false,
			description:
				"Tab query filter (e.g. { active: true, currentWindow: true }) (literal)",
		},
	],
	returnDoc: "Tab array",
	errorCode: "ECHROME",
	errorCategory: "extension",
	example: "page.tabs({ active: true })",
});

registerJsCall({
	action: "page_switch",
	namespace: "page",
	name: "switch",
	description: "Switch to a tab",
	params: schemas.TabActivateParamsSchema,
	returns: schemas.ChromeTabSchema,
	owner: "main-thread",
	handler: async (params, ctx) => {
		const tabId = typeof params === "number" ? params : extractTabId(params);
		if (tabId === null) {
			throw makeError("page_switch requires a tabId", "E_MISSING_PARAM");
		}
		return unwrapResult(
			await dispatchTool("chrome_tabs_update", [tabId, { active: true }], ctx),
		);
	},
	paramTypes: [
		{
			name: "tabId",
			type: "number",
			required: true,
			description:
				"Tab ID to activate (can also be passed as a plain number or as { tabId: number }) (literal)",
		},
	],
	returnDoc: "Updated tab",
	errorCode: "E_MISSING_PARAM",
	example: "page.switch(123)",
});

registerJsCall({
	action: "page_new_tab",
	namespace: "page",
	name: "new_tab",
	description: "Open a new tab",
	params: schemas.TabCreateParamsSchema,
	returns: schemas.ChromeTabSchema,
	fields: ["url"],
	owner: "main-thread",
	handler: async (params, ctx) => {
		return unwrapResult(
			await dispatchTool("chrome_tabs_create", [params], ctx),
		);
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
	example: 'page.new_tab("https://example.com")',
});

registerJsCall({
	action: "page_active_tab",
	namespace: "page",
	name: "active_tab",
	description: "Get the active tab",
	params: schemas.PageActiveTabParamsSchema,
	returns: schemas.ChromeTabSchema,
	owner: "main-thread",
	handler: async (_params, ctx) => {
		const tabId = await requireActiveTab("page.active_tab()", ctx);
		const tab = unwrapResult(
			await dispatchTool("chrome_tabs_get", [tabId], ctx),
		) as Record<string, unknown>;
		return { ...tab, tabId: typeof tab.id === "number" ? tab.id : tabId };
	},
	paramTypes: [],
	returnDoc: "Active tab object with tabId",
	errorCode: "E_NO_TAB",
	example: "page.active_tab()",
});
