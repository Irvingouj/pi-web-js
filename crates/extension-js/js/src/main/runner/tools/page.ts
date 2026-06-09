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
	executeInTab,
	waitForTabLoad,
	pingTabContentScript,
	preflightScriptableTab,
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
	CONTENT_SCRIPT_GRACE_MS,
	CS_FAST_PING_MS,
	DEFAULT_MAX_NODES,
	DEFAULT_SCROLL_AMOUNT,
	DEFAULT_POLL_INTERVAL_MS,
} from "../runtime.js";
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
	],
	returnDoc: "Tab update result",
	errorCode: "E_NAVIGATION",
	errorCategory: "navigation",
	example: "page.goto(\"https://example.com\")",
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
		const scriptingPreflight = await preflightScriptableTab(tabId);
		const scripting =
			scriptingPreflight && !scriptingPreflight.ok ? "blocked" : "ok";
		const pingResult = await pingTabContentScript(tabId, CS_FAST_PING_MS);
		const contentScript = pingResult.ok ? "connected" : "missing";
		const mutationsReady =
			scripting === "ok" && contentScript === "connected";
		const health: z.infer<typeof schemas.PageHealthResultSchema> = {
			tabId,
			url,
			title,
			contentScript,
			scripting,
			mutationsReady,
		};
		if (!mutationsReady) {
			if (scripting === "blocked") {
				health.hint =
					"This tab URL cannot be scripted. Only http(s) pages support mutations.";
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
	returnDoc: "Tab health with contentScript and mutationsReady flags",
	errorCode: "E_NO_TAB",
	example: "page.health()",
});

registerJsCall({
	action: "page_forward",
	namespace: "page",
	name: "forward",
	description: "Go forward in the active tab",
	params: schemas.PageForwardParamsSchema,
	returns: z.boolean(),
	owner: "main-thread",
	handler: async (_params, _ctx) => {
		const activeTab = await requireActiveTab("page.forward()");
		const preflight = await preflightScriptableTab(activeTab);
		if (preflight) {
			return unwrapResult(preflight);
		}
		return unwrapResult(
			await executeInTab(activeTab, () => {
				window.history.forward();
				return true;
			}, []),
		);
	},
	paramTypes: [],
	returnDoc: "true",
	errorCode: "E_NO_TAB",
	example: "page.forward()",
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
	action: "page_find",
	namespace: "page",
	name: "find",
	description: "Find elements in the active tab using a CSS selector",
	params: schemas.PageFindParamsSchema,
	returns: z.array(
		z.object({
			tag: z.string(),
			refId: z.string().nullable(),
			text: z.string(),
		}),
	),
	aliases: [{ namespace: "page", name: "query" }],
	fields: ["selector"],
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const activeTab = await requireActiveTab("page.find()");
		return unwrapResult(
			await executeInTab(
				activeTab,
				(sel: unknown) => {
					const elements = Array.from(document.querySelectorAll(String(sel)));
					return elements.map((el) => ({
						tag: el.tagName,
						refId: el.getAttribute("data-ref-id"),
						text: el.textContent?.slice(0, 100) || "",
					}));
				},
				[params.selector],
			),
		);
	},
	paramTypes: [
		{
			name: "selector",
			type: "string",
			required: true,
			description: "CSS selector to find elements (selector)",
		},
	],
	returnDoc: "Array of elements",
	errorCode: "E_NO_TAB",
	example: "page.find(\"h1\")",
});

registerJsCall({
	action: "page_wait_for",
	namespace: "page",
	name: "wait_for",
	description: "Wait for a selector in the active tab",
	params: schemas.PageWaitForParamsSchema,
	returns: z.boolean(),
	fields: ["selector", "timeout"],
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const activeTab = await requireActiveTab("page.wait_for()");
		const start = Date.now();
		const timeoutMs = Number(params.timeout) || DEFAULT_TIMEOUT_MS;
		while (true) {
			throwIfAborted();
			const result = await executeInTab(
				activeTab,
				(sel: unknown) => !!document.querySelector(String(sel)),
				[params.selector],
			);
			if (result.ok && result.value === true) {
				return true;
			}
			if (Date.now() - start >= timeoutMs) {
				const err = new Error(
					`Timeout waiting for selector: ${params.selector}`,
				);

				throw err;
			}
			await new Promise((resolve) =>
				setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS),
			);
		}
	},
	paramTypes: [
		{
			name: "selector",
			type: "string",
			required: true,
			description: "CSS selector to wait for (selector)",
		},
		{
			name: "timeout",
			type: "number",
			required: false,
			description: "Timeout in milliseconds (literal)",
		},
	],
	returnDoc: "true",
	errorCode: "E_TIMEOUT",
	errorCategory: "timeout",
	example: "page.wait_for(\"#submit\", 5000)",
});

registerJsCall({
	action: "page_extract",
	namespace: "page",
	name: "extract",
	description: "Extract data from the active tab",
	params: schemas.PageExtractParamsSchema,
	returns: z.record(z.unknown()),
	fields: ["fields"],
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const activeTab = await requireActiveTab("page.extract()");
		return unwrapResult(
			await executeInTab(
				activeTab,
				(fieldsArg: unknown) => {
					const fieldList = Array.isArray(fieldsArg) ? fieldsArg : [];
					const result: Record<string, unknown> = {};
					for (const field of fieldList) {
						if (field === "title") {
							result.title = document.title;
						} else if (field === "url") {
							result.url = window.location.href;
						} else if (field === "headings") {
							const headings = Array.from(
								document.querySelectorAll("h1, h2, h3, h4, h5, h6"),
							);
							result.headings = headings.map((el) => ({
								tag: el.tagName,
								text: el.textContent?.trim().slice(0, 200) || "",
							}));
						} else if (field === "links") {
							const links = Array.from(document.querySelectorAll("a[href]"));
							result.links = links.map((el) => ({
								href: el.getAttribute("href"),
								text: el.textContent?.trim().slice(0, 100) || "",
							}));
						} else if (field === "text") {
							result.text =
								document.body?.textContent?.trim().slice(0, 500) || "";
						}
					}
					return result;
				},
				[params.fields],
			),
		);
	},
	paramTypes: [
		{
			name: "fields",
			type: "array",
			required: true,
			description:
				"Array of fields to extract (title, url, headings, links, text) (literal)",
		},
	],
	returnDoc: "Extracted data",
	errorCode: "E_NO_TAB",
	example: "page.extract([\"title\", \"url\"])",
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
			type: "object",
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
		return { ...tab, tabId: tab.id ?? tabId };
	},
	paramTypes: [],
	returnDoc: "Active tab object with tabId",
	errorCode: "E_NO_TAB",
	example: "page.active_tab()",
});

registerJsCall({
	action: "page_fetch",
	namespace: "page",
	name: "fetch",
	description: "Fetch in the active tab",
	params: z.record(z.unknown()),
	returns: schemas.FetchValueSchema,
	fields: ["url", "options"],
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const activeTab = await requireActiveTab("page.fetch()");
		const obj = asRecord(params);
		const url = obj.url ?? "";
		const options = obj.options ?? {};
		return unwrapResult(
			await executeInTab(
				activeTab,
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
	example: "page.fetch(\"https://api.example.com/data\")",
});
