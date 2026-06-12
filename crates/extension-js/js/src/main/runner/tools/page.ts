/// <reference types="chrome" />
import { z } from "zod";
import { logger } from "../../../shared/logger.js";
import * as schemas from "../../../shared/schemas.js";
import {
	dispatchTool,
	registerJsCall,
	type CallContext,
	type ToolDocParam,
} from "../../../shared/tool-registry.js";
import { CONTENT_SCRIPT_TOOL_SPECS } from "../../../shared/registry/content-script-tools.js";
import { defineContentScriptTool } from "../../../shared/registry/define-content-script-tool.js";
import type { DomFormatParams, DomSnapshotParams, FetchParams } from "../runtime.js";
import {
	makeError,
	throwAgentError,
	asRecord,
	extractTabId,
	unwrapResult,
	resolveActiveTabId,
	waitForTabLoad,
	pingTabContentScript,
	preflightDomTab,
	CONTENT_SCRIPT_GRACE_MS,
	CS_FAST_PING_MS,
	DEFAULT_TIMEOUT_MS,
	NETWORK_IDLE_QUIET_MS,
} from "../runtime.js";
import { NetworkTracker } from "../lib/network-tracker.js";
import { noTabError, contentScriptMissingError } from "../../../shared/registry/normalize-agent-error.js";

async function requireActiveTab(action: string): Promise<number> {
	const tabId = await resolveActiveTabId();
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
	handler: async (_params, _ctx) => {
		const activeTab = await requireActiveTab("page.url()");
		const tab = unwrapResult(
			await dispatchTool("chrome_tabs_get", [activeTab]),
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
	handler: async (_params, _ctx) => {
		const activeTab = await requireActiveTab("page.title()");
		const tab = unwrapResult(
			await dispatchTool("chrome_tabs_get", [activeTab]),
		) as { title?: string };
		return tab.title ?? "";
	},
	paramTypes: [],
	returnDoc: "Title string",
	errorCode: "E_NO_TAB",
	example: "page.title()",
});

for (const spec of CONTENT_SCRIPT_TOOL_SPECS.filter((s) => s.namespace === "page")) {
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
	handler: async (params, _ctx) => {
		const activeTab = await requireActiveTab("page.goto()");
		if (!params.url.startsWith("http:") && !params.url.startsWith("https:")) {
			throw makeError(
				`Navigation blocked: URL scheme not supported (${params.url})`,
				"E_NAVIGATION",
				"navigation",
			);
		}
		const preNavResult = await dispatchTool("chrome_tabs_get", [activeTab]);
		const preNavigationUrl =
			preNavResult.ok && preNavResult.value
				? (preNavResult.value as { url?: string }).url
				: undefined;
		const chromeApi = window.chrome;
		let navSawLoading = false;
		const navListener = (
			tabId: number,
			changeInfo: { status?: string },
		) => {
			if (tabId !== activeTab) return;
			if (changeInfo.status === "loading") {
				navSawLoading = true;
			}
		};
		const timeoutMs = Number(params.timeout) || DEFAULT_TIMEOUT_MS;
		chromeApi?.tabs?.onUpdated?.addListener(navListener);
		try {
			const updateResult = await dispatchTool("chrome_tabs_update", [
				activeTab,
				{ url: params.url },
			]);
			if (!updateResult.ok) {
				return unwrapResult(updateResult);
			}
			const loadResult = await waitForTabLoad(activeTab, timeoutMs, {
				preNavigationUrl,
				getNavSawLoading: () => navSawLoading,
			});
			if (!loadResult.ok) {
				return unwrapResult(loadResult);
			}
		} finally {
			chromeApi?.tabs?.onUpdated?.removeListener(navListener);
		}
		const tabCheck = await dispatchTool("chrome_tabs_get", [activeTab]);
		if (tabCheck.ok && tabCheck.value) {
			const tab = tabCheck.value as { url?: string; status?: string };
			const currentUrl = tab.url ?? "";
			if (
				currentUrl &&
				!currentUrl.startsWith("http:") &&
				!currentUrl.startsWith("https:")
			) {
				throw makeError(
					`Navigation blocked: cannot script ${currentUrl}`,
					"E_NAVIGATION",
					"navigation",
				);
			}
			if (
				preNavigationUrl &&
				tab.status === "complete" &&
				currentUrl === preNavigationUrl &&
				currentUrl !== params.url
			) {
				throw makeError(
					`Navigation did not start for ${params.url}`,
					"E_NAVIGATION",
					"navigation",
				);
			}
		}
		if (params.waitUntil === "networkidle") {
			const tracker = new NetworkTracker(activeTab);
			try {
				tracker.start();
				const networkTimeout = Math.max(
					NETWORK_IDLE_QUIET_MS * 2,
					timeoutMs,
				);
				await tracker.waitForIdle(networkTimeout);
			} catch (idleErr) {
				throw makeError(
					idleErr instanceof Error ? idleErr.message : String(idleErr),
					"E_NAVIGATION",
					"navigation",
				);
			} finally {
				tracker.dispose();
			}
		}
		const pingResult = await pingTabContentScript(activeTab, timeoutMs);
		if (!pingResult.ok) {
			return unwrapResult(pingResult);
		}
		await new Promise((resolve) =>
			setTimeout(resolve, CONTENT_SCRIPT_GRACE_MS),
		);
		const freshTab = await dispatchTool("chrome_tabs_get", [activeTab]);
		return unwrapResult(freshTab);
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
			description: "When to consider navigation complete. 'load' waits for tab status complete (default). 'networkidle' waits until no in-flight requests for 500ms.",
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
	handler: async (_params, _ctx) => {
		const tabId = await requireActiveTab("page.health()");
		const tab = unwrapResult(
			await dispatchTool("chrome_tabs_get", [tabId]),
		) as { url?: string; title?: string };
		const url = tab.url ?? "";
		const title = tab.title ?? "";
		const urlPreflight = await preflightDomTab(tabId);
		const domApis =
			urlPreflight && !urlPreflight.ok ? "blocked" : "ok";
		const pingResult = await pingTabContentScript(tabId, CS_FAST_PING_MS);
		const contentScript = pingResult.ok ? "connected" : "missing";
		const mutationsReady =
			domApis === "ok" && contentScript === "connected";
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
	returnDoc: "Tab health: contentScript connection and http(s) domApis readiness",
	errorCode: "E_NO_TAB",
	example: "page.health()",
});

registerJsCall({
	action: "page_reload",
	namespace: "page",
	name: "reload",
	description: "Reload the active tab",
	params: schemas.PageReloadParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (_params, _ctx) => {
		const activeTab = await requireActiveTab("page.reload()");
		return unwrapResult(
			await dispatchTool("chrome_tabs_reload", [activeTab]),
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
	handler: async (params, _ctx) => {
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
	handler: async (params, _ctx) => {
		const tabId = typeof params === "number" ? params : extractTabId(params);
		if (tabId === null) {
			throw makeError("page_close requires a tabId", "E_MISSING_PARAM");
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
	handler: async (params, _ctx) => {
		return unwrapResult(await dispatchTool("chrome_tabs_query", [params]));
	},
	paramTypes: [
		{
			name: "params",
			type: "{ active?: boolean, currentWindow?: boolean, url?: string }",
			required: false,
			description: "Tab query filter (e.g. { active: true, currentWindow: true }) (literal)",
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
	handler: async (params, _ctx) => {
		const tabId =
			typeof params === "number"
				? params
				: extractTabId(params);
		if (tabId === null) {
			throw makeError("page_switch requires a tabId", "E_MISSING_PARAM");
		}
		return unwrapResult(
			await dispatchTool("chrome_tabs_update", [tabId, { active: true }]),
		);
	},
	paramTypes: [
		{
			name: "tabId",
			type: "number",
			required: true,
			description: "Tab ID to activate (can also be passed as a plain number or as { tabId: number }) (literal)",
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
	example: "page.new_tab(\"https://example.com\")",
});

registerJsCall({
	action: "page_active_tab",
	namespace: "page",
	name: "active_tab",
	description: "Get the active tab",
	params: schemas.PageActiveTabParamsSchema,
	returns: schemas.ChromeTabSchema,
	owner: "main-thread",
	handler: async (_params, _ctx) => {
		const tabId = await requireActiveTab("page.active_tab()");
		const tab = unwrapResult(
			await dispatchTool("chrome_tabs_get", [tabId]),
		) as Record<string, unknown>;
		return { ...tab, tabId: (typeof tab.id === "number" ? tab.id : tabId) };
	},
	paramTypes: [],
	returnDoc: "Active tab object with tabId",
	errorCode: "E_NO_TAB",
	example: "page.active_tab()",
});

