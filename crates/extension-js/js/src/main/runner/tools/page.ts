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
	resolveActiveTabId,
	executeInTab,
	waitForTabLoad,
	pingTabContentScript,
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
	CONTENT_SCRIPT_GRACE_MS,
	DEFAULT_MAX_NODES,
	DEFAULT_SCROLL_AMOUNT,
	DEFAULT_POLL_INTERVAL_MS,
} from "../runtime.js";

// ─── Page actions ────────────────────────────────────────────────

registerContentScriptJsCall({
	action: "page_url",
	namespace: "page",
	name: "url",
	description: "Get the URL of the active tab",
	params: schemas.PageUrlParamsSchema,
	returns: z.string(),
	paramTypes: [],
	returnDoc: "URL string",
	errorCode: "E_NO_TAB",
	example: "page.url()",
});

registerContentScriptJsCall({
	action: "page_title",
	namespace: "page",
	name: "title",
	description: "Get the title of the active tab",
	params: schemas.PageTitleParamsSchema,
	returns: z.string(),
	paramTypes: [],
	returnDoc: "Title string",
	errorCode: "E_NO_TAB",
	example: "page.title()",
});

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
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
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

registerContentScriptJsCall({
	action: "page_back",
	namespace: "page",
	name: "back",
	description: "Go back in the active tab",
	params: schemas.PageBackParamsSchema,
	returns: z.boolean(),
	paramTypes: [],
	returnDoc: "Navigation result",
	errorCode: "E_NO_TAB",
	example: "page.back()",
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
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
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
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
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

registerContentScriptJsCall({
	action: "page_click",
	namespace: "page",
	name: "click",
	description: "Click an element in the active tab",
	params: schemas.PageClickParamsSchema,
	returns: z.null(),
	paramTypes: [
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
			description: "Element label to click (label)",
		},
	],
	returnDoc: "Click result",
	errorCode: "E_MISSING_PARAM",
	example: "page.click({ refId: \"e2\" })",
});

registerContentScriptJsCall({
	action: "page_fill",
	namespace: "page",
	name: "fill",
	description: "Fill an element in the active tab",
	params: schemas.PageFillParamsSchema,
	returns: z.null(),
	paramTypes: [
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
	errorCode: "E_MISSING_PARAM",
	example: "page.fill({ refId: \"e2\", value: \"hello\" })",
});

registerContentScriptJsCall({
	action: "page_type",
	namespace: "page",
	name: "type",
	description: "Type into an element in the active tab",
	params: schemas.PageTypeParamsSchema,
	returns: z.null(),
	paramTypes: [
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
	errorCode: "E_MISSING_PARAM",
	example: "page.type({ refId: \"e2\", text: \"hello\" })",
});

registerContentScriptJsCall({
	action: "page_append",
	namespace: "page",
	name: "append",
	description: "Append text to an element in the active tab",
	params: schemas.PageAppendParamsSchema,
	returns: z.null(),
	paramTypes: [
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
			description: "Text to append (literal)",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label (label)",
		},
	],
	returnDoc: "Append result",
	errorCode: "E_MISSING_PARAM",
	example: "page.append({ refId: \"e2\", text: \" world\" })",
});

registerContentScriptJsCall({
	action: "page_press",
	namespace: "page",
	name: "press",
	description: "Press a key in the active tab",
	params: schemas.PagePressParamsSchema,
	returns: z.null(),
	fields: ["key"],
	paramTypes: [
		{
			name: "key",
			type: "string",
			required: true,
			description: "Key to press (literal)",
		},
	],
	returnDoc: "Press result",
	errorCode: "E_NO_TAB",
	example: "page.press(\"Enter\")",
});

registerContentScriptJsCall({
	action: "page_select",
	namespace: "page",
	name: "select",
	description: "Select an option in the active tab",
	params: schemas.PageSelectParamsSchema,
	returns: z.null(),
	paramTypes: [
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
	errorCode: "E_MISSING_PARAM",
	example: "page.select({ refId: \"e2\", value: \"option1\" })",
});

registerContentScriptJsCall({
	action: "page_check",
	namespace: "page",
	name: "check",
	description: "Check/uncheck an element in the active tab",
	params: schemas.PageCheckParamsSchema,
	returns: z.null(),
	paramTypes: [
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
	errorCode: "E_MISSING_PARAM",
	example: "page.check({ refId: \"e2\", checked: true })",
});

registerContentScriptJsCall({
	action: "page_hover",
	namespace: "page",
	name: "hover",
	description: "Hover over an element in the active tab",
	params: schemas.PageHoverParamsSchema,
	returns: z.null(),
	paramTypes: [
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
	errorCode: "E_MISSING_PARAM",
	example: "page.hover({ refId: \"e2\" })",
});

registerContentScriptJsCall({
	action: "page_unhover",
	namespace: "page",
	name: "unhover",
	description: "Unhover in the active tab",
	params: schemas.PageUnhoverParamsSchema,
	returns: z.null(),
	paramTypes: [],
	returnDoc: "Unhover result",
	errorCode: "E_NO_TAB",
	example: "page.unhover()",
});

registerContentScriptJsCall({
	action: "page_scroll",
	namespace: "page",
	name: "scroll",
	description: "Scroll the active tab",
	params: schemas.PageScrollParamsSchema,
	returns: z.boolean(),
	fields: ["direction", "amount"],
	paramTypes: [
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
	example: "page.scroll(\"down\", 500)",
});

registerContentScriptJsCall({
	action: "page_scroll_to",
	namespace: "page",
	name: "scroll_to",
	description: "Scroll to an element in the active tab",
	params: schemas.PageScrollToParamsSchema,
	returns: z.boolean(),
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: false,
			description: "Element reference ID to scroll to (refId)",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label to scroll to (label)",
		},
	],
	returnDoc: "Scroll to result",
	errorCode: "E_MISSING_PARAM",
	example: "page.scroll_to({ refId: \"e2\" })",
});

registerContentScriptJsCall({
	action: "page_dblclick",
	namespace: "page",
	name: "dblclick",
	description: "Double-click an element in the active tab",
	params: schemas.PageDblClickParamsSchema,
	returns: z.null(),
	paramTypes: [
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
	errorCode: "E_MISSING_PARAM",
	example: "page.dblclick({ refId: \"e2\" })",
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
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
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
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
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
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
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
	returns: schemas.ChromeTabArraySchema,
	owner: "main-thread",
	handler: async (_params, _ctx) => {
		return unwrapResult(
			await dispatchTool("chrome_tabs_query", [
				{ active: true, currentWindow: true },
			]),
		);
	},
	paramTypes: [],
	returnDoc: "Tab query result",
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
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
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
