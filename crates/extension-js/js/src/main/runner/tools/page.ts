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
		const result = await dispatchTool("chrome_tabs_update", [
			activeTab,
			{ url: params.url },
		]);
		return unwrapResult(result);
	},
	paramTypes: [
		{
			name: "url",
			type: "string",
			required: true,
			description: "URL to navigate to",
		},
	],
	returnDoc: "Tab update result",
	errorCode: "E_NO_TAB",
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
			description: "Duration to wait in milliseconds",
		},
	],
	returnDoc: "true",
	errorCode: "E_UNKNOWN",
});

registerContentScriptJsCall({
	action: "page_click",
	namespace: "page",
	name: "click",
	description: "Click an element in the active tab",
	params: schemas.PageClickParamsSchema,
	returns: z.null(),
	fields: ["refId"],
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: false,
			description: "Element reference ID",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label to click",
		},
	],
	returnDoc: "Click result",
	errorCode: "E_MISSING_PARAM",
});

registerContentScriptJsCall({
	action: "page_fill",
	namespace: "page",
	name: "fill",
	description: "Fill an element in the active tab",
	params: schemas.PageFillParamsSchema,
	returns: z.null(),
	fields: ["refId", "value"],
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: false,
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
	errorCode: "E_MISSING_PARAM",
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
	errorCode: "E_MISSING_PARAM",
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
			description: "Element reference ID",
		},
		{
			name: "text",
			type: "string",
			required: false,
			description: "Text to append",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label",
		},
	],
	returnDoc: "Append result",
	errorCode: "E_MISSING_PARAM",
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
			description: "Key to press",
		},
	],
	returnDoc: "Press result",
	errorCode: "E_NO_TAB",
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
	errorCode: "E_MISSING_PARAM",
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
	errorCode: "E_MISSING_PARAM",
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
			required: true,
			description: "Element reference ID",
		},
	],
	returnDoc: "Hover result",
	errorCode: "E_MISSING_PARAM",
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
			description: "Element reference ID to scroll to",
		},
	],
	returnDoc: "Scroll to result",
	errorCode: "E_MISSING_PARAM",
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
			required: true,
			description: "Element reference ID",
		},
	],
	returnDoc: "Double-click result",
	errorCode: "E_MISSING_PARAM",
});

registerJsCall({
	action: "page_find",
	namespace: "page",
	name: "find",
	description: "Find elements in the active tab",
	params: schemas.PageFindParamsSchema,
	returns: z.array(
		z.object({
			tag: z.string(),
			refId: z.string().nullable(),
			text: z.string(),
		}),
	),
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
			description: "CSS selector to find elements",
		},
	],
	returnDoc: "Array of elements",
	errorCode: "E_NO_TAB",
});

registerJsCall({
	action: "page_wait_for",
	namespace: "page",
	name: "wait_for",
	description: "Wait for a selector in the active tab",
	params: schemas.PageWaitForParamsSchema,
	returns: z.boolean(),
	fields: ["refId", "timeout"],
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
			description: "CSS selector to wait for",
		},
		{
			name: "timeout",
			type: "number",
			required: false,
			description: "Timeout in milliseconds",
		},
	],
	returnDoc: "true",
	errorCode: "E_TIMEOUT",
	errorCategory: "timeout",
});

registerJsCall({
	action: "page_extract",
	namespace: "page",
	name: "extract",
	description: "Extract data from the active tab",
	params: schemas.PageExtractParamsSchema,
	returns: z.record(z.unknown()),
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
				"Array of fields to extract (title, url, headings, links, text)",
		},
	],
	returnDoc: "Extracted data",
	errorCode: "E_NO_TAB",
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
			description: "Tab ID to close",
		},
	],
	returnDoc: "null",
	errorCode: "E_MISSING_PARAM",
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
