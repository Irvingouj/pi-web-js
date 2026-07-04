/**
 * web.tab.* content-script tool specs — tools targeting a specific tabId.
 * Extracted from content-script-tools.ts by namespace.
 */
import { z } from "zod";
import { AWAIT_PROMISE_NOTE } from "./page-specs.js";
import * as schemas from "./schemas.js";

export type { ContentScriptToolSpec } from "./page-specs.js";

import type { ContentScriptToolSpec } from "./page-specs.js";

export const TAB_TOOL_SPECS: readonly ContentScriptToolSpec[] = [
	{
		action: "tab_click",
		namespace: "web.tab",
		name: "click",
		description: "Click in a tab",
		params: schemas.TabClickParamsSchema,
		returns: schemas.PageActionResultSchema,
		paramTypes: [
			{
				name: "tabId",
				type: "number",
				required: true,
				description: "Tab ID (literal)",
			},
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
		returnDoc: "{ ok: true, action: 'click', refId? }",
		errorCode: "E_NO_TAB",
		example: 'web.tab.click({ tabId: 123, refId: "e2" })',
		agentMeta: {
			prerequisites: [
				"Ensure the target tab exists and the content script is ready before mutating",
			],
			notes: ["Explicit tabId required; same handlers as page.*"],
			tags: ["mutation", "write"],
			relatedApis: ["page.click"],
		},
		handlerKey: "click",
	},
	{
		action: "tab_fill",
		namespace: "web.tab",
		name: "fill",
		description: "Fill in a tab",
		params: schemas.TabFillParamsSchema,
		returns: schemas.PageActionResultSchema,
		paramTypes: [
			{
				name: "tabId",
				type: "number",
				required: true,
				description: "Tab ID (literal)",
			},
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
		returnDoc: "{ ok: true, action: 'fill', refId?, value? }",
		errorCode: "E_NO_TAB",
		example: 'web.tab.fill({ tabId: 123, refId: "e2", value: "hello" })',
		agentMeta: {
			prerequisites: [
				"Ensure the target tab exists and the content script is ready before mutating",
			],
			notes: ["Explicit tabId required; same handlers as page.*"],
			tags: ["mutation", "write"],
			relatedApis: ["page.fill"],
		},
		handlerKey: "fill",
	},
	{
		action: "tab_set_files",
		namespace: "web.tab",
		name: "setFiles",
		description: "Attach files to a file input in a tab",
		params: schemas.TabSetFilesParamsSchema,
		returns: schemas.PageActionResultSchema,
		paramTypes: [
			{
				name: "tabId",
				type: "number",
				required: true,
				description: "Tab ID (literal)",
			},
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
				name: "files",
				type: "{ name?: string, url?: string, path?: string, handle?: string, mimeType?: string }[]",
				required: true,
				description:
					"Each entry uses exactly one of url, path (vfs), or handle",
			},
		],
		returnDoc:
			"{ ok: true, action: 'setFiles', refId?, fileCount?, fileNames? }",
		errorCode: "E_NO_TAB",
		example:
			'web.tab.setFiles({ tabId: 123, refId: "e3", files: [{ url: "https://example.com/photo.jpg" }] })',
		agentMeta: {
			prerequisites: [
				"Ensure the target tab exists and the content script is ready before mutating",
			],
			notes: ["Explicit tabId required; same handlers as page.*"],
			tags: ["mutation", "write"],
			relatedApis: ["page.setFiles"],
		},
		handlerKey: "set_files",
	},
	{
		action: "tab_scroll_to",
		namespace: "web.tab",
		name: "scroll_to",
		description: "Scroll to position in a tab",
		params: schemas.TabScrollToParamsSchema,
		returns: schemas.PageActionResultSchema,
		paramTypes: [
			{
				name: "tabId",
				type: "number",
				required: true,
				description: "Tab ID (literal)",
			},
			{
				name: "x",
				type: "number",
				required: false,
				description: "X coordinate (literal)",
			},
			{
				name: "y",
				type: "number",
				required: false,
				description: "Y coordinate (literal)",
			},
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
		example: 'web.tab.scroll_to({ tabId: 123, refId: "e2" })',
		handlerKey: "scroll_to",
	},
	{
		action: "tab_type",
		namespace: "web.tab",
		name: "type",
		description: "Type in a tab",
		params: schemas.TabTypeParamsSchema,
		returns: schemas.PageActionResultSchema,
		paramTypes: [
			{
				name: "tabId",
				type: "number",
				required: true,
				description: "Tab ID (literal)",
			},
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
		returnDoc: "{ ok: true, action: 'type', refId?, value? }",
		errorCode: "E_NO_TAB",
		example: 'web.tab.type({ tabId: 123, refId: "e2", text: "hello" })',
		agentMeta: {
			prerequisites: [
				"Ensure the target tab exists and the content script is ready before mutating",
			],
			notes: ["Explicit tabId required; same handlers as page.*"],
			tags: ["mutation", "write"],
			relatedApis: ["page.type"],
		},
		handlerKey: "type",
	},
	{
		action: "tab_press",
		namespace: "web.tab",
		name: "press",
		description: "Press a key in a tab",
		params: schemas.TabPressParamsSchema,
		returns: schemas.PageActionResultSchema,
		paramTypes: [
			{
				name: "tabId",
				type: "number",
				required: true,
				description: "Tab ID (literal)",
			},
			{
				name: "key",
				type: "string",
				required: false,
				description: "Key to press (literal)",
			},
		],
		returnDoc: "{ ok: true, action: 'press', key? }",
		errorCode: "E_NO_TAB",
		example: 'web.tab.press({ tabId: 123, key: "Enter" })',
		agentMeta: {
			prerequisites: [
				"Ensure the target tab exists and the content script is ready before mutating",
			],
			notes: ["Explicit tabId required; same handlers as page.*"],
			tags: ["mutation", "write"],
			relatedApis: ["page.press"],
		},
		handlerKey: "press",
	},
	{
		action: "tab_select",
		namespace: "web.tab",
		name: "select",
		description: "Select an option in a tab",
		params: schemas.TabSelectParamsSchema,
		returns: schemas.PageActionResultSchema,
		paramTypes: [
			{
				name: "tabId",
				type: "number",
				required: true,
				description: "Tab ID (literal)",
			},
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
		returnDoc: "{ ok: true, action: 'select', refId?, value? }",
		errorCode: "E_NO_TAB",
		example: 'web.tab.select({ tabId: 123, refId: "e2", value: "option1" })',
		agentMeta: {
			prerequisites: [
				"Ensure the target tab exists and the content script is ready before mutating",
			],
			notes: ["Explicit tabId required; same handlers as page.*"],
			tags: ["mutation", "write"],
			relatedApis: ["page.select"],
		},
		handlerKey: "select",
	},
	{
		action: "tab_select_option",
		namespace: "web.tab",
		name: "select_option",
		description:
			"Open a combobox (react-select/listbox) in a tab and click the option whose text matches value",
		params: schemas.TabSelectOptionParamsSchema,
		returns: schemas.PageActionResultSchema,
		paramTypes: [
			{
				name: "tabId",
				type: "number",
				required: true,
				description: "Tab ID (literal)",
			},
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
				description:
					"Visible text of the option to select (matched case-insensitively)",
			},
		],
		returnDoc: "{ ok: true, action: 'select_option', refId?, value? }",
		errorCode: "E_NO_TAB",
		example:
			'web.tab.select_option({ tabId: 123, refId: "e2", value: "Canada" })',
		agentMeta: {
			prerequisites: [
				"Ensure the target tab exists and the content script is ready before mutating",
			],
			notes: [
				"Explicit tabId required; same handlers as page.*",
				"Drives react-select and other ARIA combobox patterns: clicks the control to open, then clicks the matching [role='option']",
			],
			tags: ["mutation", "write"],
			relatedApis: ["page.select_option"],
		},
		handlerKey: "select_option",
	},
	{
		action: "tab_check",
		namespace: "web.tab",
		name: "check",
		description: "Check/uncheck in a tab",
		params: schemas.TabCheckParamsSchema,
		returns: schemas.PageActionResultSchema,
		paramTypes: [
			{
				name: "tabId",
				type: "number",
				required: true,
				description: "Tab ID (literal)",
			},
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
		returnDoc: "{ ok: true, action: 'check', refId?, checked? }",
		errorCode: "E_NO_TAB",
		example: 'web.tab.check({ tabId: 123, refId: "e2", checked: true })',
		agentMeta: {
			prerequisites: [
				"Ensure the target tab exists and the content script is ready before mutating",
			],
			notes: ["Explicit tabId required; same handlers as page.*"],
			tags: ["mutation", "write"],
			relatedApis: ["page.check"],
		},
		handlerKey: "check",
	},
	{
		action: "tab_submit",
		namespace: "web.tab",
		name: "submit",
		description: "Submit a form in a tab (calls form.requestSubmit())",
		params: schemas.TabSubmitParamsSchema,
		returns: schemas.PageActionResultSchema,
		paramTypes: [
			{
				name: "tabId",
				type: "number",
				required: true,
				description: "Tab ID (literal)",
			},
			{
				name: "refId",
				type: "string",
				required: false,
				description:
					"Element reference ID of the form or any element inside it (refId)",
			},
			{
				name: "label",
				type: "string",
				required: false,
				description: "Element label (label)",
			},
		],
		returnDoc: "{ ok: true, action: 'submit', refId?, dispatched: true }",
		errorCode: "E_NO_TAB",
		example: 'web.tab.submit({ tabId: 123, refId: "e2" })',
		agentMeta: {
			prerequisites: [
				"Ensure the target tab exists and the content script is ready before mutating",
			],
			notes: ["Explicit tabId required; same handler as page.submit"],
			tags: ["mutation", "write"],
			relatedApis: ["page.submit"],
		},
		handlerKey: "submit",
	},
	{
		action: "tab_check_radio",
		namespace: "web.tab",
		name: "checkRadio",
		description: "Check a radio option by group name and value in a tab",
		params: schemas.TabCheckRadioParamsSchema,
		returns: schemas.PageActionResultSchema,
		paramTypes: [
			{
				name: "tabId",
				type: "number",
				required: true,
				description: "Tab ID (literal)",
			},
			{
				name: "name",
				type: "string",
				required: true,
				description: "The name attribute of the radio group",
			},
			{
				name: "value",
				type: "string",
				required: true,
				description: "The value of the radio option to check",
			},
		],
		returnDoc:
			"{ ok: true, action: 'check_radio', refId?, checked: true, value }",
		errorCode: "E_NO_TAB",
		example:
			'web.tab.checkRadio({ tabId: 123, name: "radio-grp", value: "opt2" })',
		agentMeta: {
			prerequisites: [
				"Ensure the target tab exists and the content script is ready before mutating",
			],
			notes: ["Explicit tabId required; same handler as page.checkRadio"],
			tags: ["mutation", "write"],
			relatedApis: ["page.checkRadio"],
		},
		handlerKey: "check_radio",
	},
	{
		action: "tab_hover",
		namespace: "web.tab",
		name: "hover",
		description: "Hover in a tab",
		params: schemas.TabHoverParamsSchema,
		returns: schemas.PageActionResultSchema,
		paramTypes: [
			{
				name: "tabId",
				type: "number",
				required: true,
				description: "Tab ID (literal)",
			},
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
		returnDoc: "{ ok: true, action: 'hover', refId? }",
		errorCode: "E_NO_TAB",
		example: 'web.tab.hover({ tabId: 123, refId: "e2" })',
		agentMeta: {
			prerequisites: [
				"Ensure the target tab exists and the content script is ready before mutating",
			],
			notes: ["Explicit tabId required; same handlers as page.*"],
			tags: ["mutation", "write"],
			relatedApis: ["page.hover"],
		},
		handlerKey: "hover",
	},
	{
		action: "tab_unhover",
		namespace: "web.tab",
		name: "unhover",
		description: "Unhover in a tab",
		params: schemas.TabUnhoverParamsSchema,
		returns: schemas.PageActionResultSchema,
		paramTypes: [
			{
				name: "tabId",
				type: "number",
				required: true,
				description: "Tab ID (literal)",
			},
		],
		returnDoc: "{ ok: true, action: 'unhover' }",
		errorCode: "E_NO_TAB",
		example: "web.tab.unhover({ tabId: 123 })",
		agentMeta: {
			prerequisites: [
				"Ensure the target tab exists and the content script is ready before mutating",
			],
			notes: ["Explicit tabId required; same handlers as page.*"],
			tags: ["mutation", "write"],
			relatedApis: ["page.unhover"],
		},
		handlerKey: "unhover",
	},
	{
		action: "tab_scroll",
		namespace: "web.tab",
		name: "scroll",
		description: "Scroll in a tab",
		params: schemas.TabScrollParamsSchema,
		returns: schemas.PageActionResultSchema,
		paramTypes: [
			{
				name: "tabId",
				type: "number",
				required: true,
				description: "Tab ID (literal)",
			},
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
		example: 'web.tab.scroll({ tabId: 123, direction: "down", amount: 500 })',
		handlerKey: "scroll",
	},
	{
		action: "tab_dblclick",
		namespace: "web.tab",
		name: "dblclick",
		description: "Double-click in a tab",
		params: schemas.TabDblClickParamsSchema,
		returns: schemas.PageActionResultSchema,
		paramTypes: [
			{
				name: "tabId",
				type: "number",
				required: true,
				description: "Tab ID (literal)",
			},
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
		returnDoc: "{ ok: true, action: 'dblclick', refId? }",
		errorCode: "E_NO_TAB",
		example: 'web.tab.dblclick({ tabId: 123, refId: "e2" })',
		agentMeta: {
			prerequisites: [
				"Ensure the target tab exists and the content script is ready before mutating",
			],
			notes: ["Explicit tabId required; same handlers as page.*"],
			tags: ["mutation", "write"],
			relatedApis: ["page.dblclick"],
		},
		handlerKey: "dblclick",
	},
	{
		action: "tab_back",
		namespace: "web.tab",
		name: "back",
		description: "Go back in a tab",
		params: schemas.TabBackParamsSchema,
		returns: schemas.PageActionResultSchema,
		paramTypes: [
			{
				name: "tabId",
				type: "number",
				required: true,
				description: "Tab ID (literal)",
			},
		],
		returnDoc: "Back result",
		errorCode: "E_NO_TAB",
		example: "web.tab.back({ tabId: 123 })",
		handlerKey: "back",
	},
	{
		action: "tab_forward",
		namespace: "web.tab",
		name: "forward",
		description: "Go forward in a tab",
		params: schemas.TabForwardParamsSchema,
		returns: schemas.PageActionResultSchema,
		paramTypes: [
			{
				name: "tabId",
				type: "number",
				required: true,
				description: "Tab ID (literal)",
			},
		],
		returnDoc: "Forward result",
		errorCode: "E_NO_TAB",
		example: "web.tab.forward({ tabId: 123 })",
		handlerKey: "forward",
	},
	{
		action: "tab_snapshot",
		namespace: "web.tab",
		name: "snapshot",
		description:
			"Get a broad, text-first tab snapshot. Includes visible text, form values, validation/error text, and actionable refIds where possible.",
		params: schemas.TabSnapshotParamsSchema,
		returns: z.string(),
		fields: ["tabId"],
		paramTypes: [
			{
				name: "tabId",
				type: "number",
				required: true,
				description: "Tab ID (literal)",
			},
			{
				name: "max_nodes",
				type: "number",
				required: false,
				description:
					"Maximum nodes to include (literal). Defaults high; lower it only when intentionally limiting output.",
			},
		],
		returnDoc: "Snapshot text",
		errorCode: "E_SNAPSHOT",
		example: "web.tab.snapshot({ tabId: 123 })",
		agentMeta: {
			notes: [
				AWAIT_PROMISE_NOTE,
				"Use web.tab.dom or page.dom if raw attributes, hidden nodes, or exact dropdown ownership are missing",
			],
			tags: ["snapshot", "read"],
			relatedApis: ["web.tab.snapshot_data", "page.dom"],
		},
		handlerKey: "snapshot_text",
	},
	{
		action: "tab_snapshot_text",
		namespace: "web.tab",
		name: "snapshot_text",
		description: "Get broad, text-first tab snapshot text",
		params: schemas.TabSnapshotTextParamsSchema,
		returns: z.string(),
		fields: ["tabId"],
		paramTypes: [
			{
				name: "tabId",
				type: "number",
				required: true,
				description: "Tab ID (literal)",
			},
		],
		returnDoc: "Snapshot text",
		errorCode: "E_SNAPSHOT",
		example: "web.tab.snapshot_text({ tabId: 123 })",
		handlerKey: "snapshot_text",
	},
	{
		action: "tab_snapshot_data",
		namespace: "web.tab",
		name: "snapshot_data",
		description:
			"Get broad tab snapshot data. Includes visible text, form values, validation/error text, and actionable refIds where possible.",
		params: schemas.TabSnapshotDataParamsSchema,
		returns: schemas.SnapshotResultSchema,
		fields: ["tabId"],
		paramTypes: [
			{
				name: "tabId",
				type: "number",
				required: true,
				description: "Tab ID (literal)",
			},
		],
		returnDoc: "Snapshot data",
		errorCode: "E_SNAPSHOT",
		example: "web.tab.snapshot_data({ tabId: 123 })",
		agentMeta: {
			notes: [
				AWAIT_PROMISE_NOTE,
				"Filtering/limiting is opt-in; this broad snapshot is the default",
				"Use page.dom({ selector, depth, includeHidden: true }) when raw DOM attributes or hidden nodes matter",
			],
			tags: ["snapshot", "read"],
			relatedApis: ["web.tab.snapshot", "page.dom"],
		},
		handlerKey: "snapshot",
	},
	{
		action: "tab_snapshot_query",
		namespace: "web.tab",
		name: "snapshot_query",
		description:
			"Query tab snapshot with semantic filtering by role, tag, text, name, etc.",
		params: schemas.TabSnapshotQueryParamsSchema,
		returns: schemas.SnapshotResultSchema,
		fields: ["tabId"],
		paramTypes: [
			{
				name: "tabId",
				type: "number",
				required: true,
				description: "Tab ID (literal)",
			},
			{
				name: "filter",
				type: "{ role?: string | string[], tag?: string | string[], text?: string, name?: string, interactiveOnly?: boolean, href?: string, src?: string, limit?: number }",
				required: false,
				description: "Semantic filter criteria (literal)",
			},
			{
				name: "max_nodes",
				type: "number",
				required: false,
				description: "Maximum nodes to collect before filtering (literal)",
			},
		],
		returnDoc: "{ text, nodes (filtered), url, title, viewport }",
		errorCode: "E_SNAPSHOT",
		example:
			'web.tab.snapshot_query({ tabId: 123, filter: { role: "button" } })',
		agentMeta: {
			notes: [
				"Explicit tabId required; same handler as page.snapshot_query",
				"Filters nodes by role, tag, text, name, interactiveOnly, href, src",
			],
			tags: ["snapshot", "read"],
			relatedApis: ["page.snapshot_query"],
		},
		handlerKey: "snapshot_query",
	},
	{
		action: "tab_fetch",
		namespace: "web.tab",
		name: "fetch",
		description: "Fetch in a tab",
		params: schemas.TabFetchParamsSchema,
		returns: schemas.FetchValueSchema,
		fields: ["tabId", "url", "options"],
		paramTypes: [
			{
				name: "tabId",
				type: "number",
				required: true,
				description: "Tab ID (literal)",
			},
			{
				name: "url",
				type: "string",
				required: false,
				description: "URL to fetch",
			},
		],
		returnDoc: "Fetch result DTO",
		errorCode: "E_NO_TAB",
		example:
			'web.tab.fetch({ tabId: 123, url: "https://api.example.com/data" })',
		agentMeta: {
			notes: [
				"Only fetchable URLs can be saved to OPFS via fetch + fs.writeBase64. chrome.downloads entries do not expose bytes, and blob: URLs are only fetchable in the document context that created them.",
			],
			tags: ["read"],
			relatedApis: ["page.fetch", "fs.writeBase64", "chrome.downloads"],
		},
		handlerKey: "fetch",
	},
	{
		action: "tab_evaluate",
		namespace: "web.tab",
		name: "evaluate",
		description: "Evaluate script in a tab (content-script context)",
		params: schemas.TabEvaluateParamsSchema,
		returns: schemas.TabEvaluateResultSchema,
		fields: ["tabId", "script"],
		paramTypes: [
			{
				name: "tabId",
				type: "number",
				required: true,
				description: "Tab ID (literal)",
			},
			{
				name: "script",
				type: "string",
				required: false,
				description: "Script to evaluate (literal)",
			},
		],
		returnDoc: "Evaluation result",
		errorCode: "E_NO_TAB",
		example: 'web.tab.evaluate({ tabId: 123, script: "document.title" })',
		agentMeta: {
			notes: [
				"Runs in content-script isolated world, not MAIN-world injection",
				"For MAIN-world access use chrome.scripting.executeScript from a cell",
			],
			tags: ["read"],
		},
		handlerKey: "evaluate",
	},
	{
		action: "tab_dom",
		namespace: "web.tab",
		name: "dom",
		description:
			"Introspect raw DOM subtree of a specific tab by CSS selector. Read-only. Same semantics as page.dom but targets an explicit tabId. Use this when snapshot/find do not expose enough data: hidden inputs, validation shims, raw attributes, dropdown/listbox ownership, shadowed widgets, aria-hidden regions, or exact DOM structure.",
		params: schemas.TabDomParamsSchema,
		returns: schemas.PageDomResultSchema,
		fields: ["tabId", "selector"],
		paramTypes: [
			{
				name: "tabId",
				type: "number",
				required: true,
				description: "Target tab ID (literal)",
			},
			{
				name: "selector",
				type: "string",
				required: true,
				description: "CSS selector for the root element(s) to introspect",
			},
			{
				name: "depth",
				type: "number",
				required: false,
				description: "Descendant levels (default 2, max 10)",
			},
			{
				name: "includeHidden",
				type: "boolean",
				required: false,
				description: "Include hidden elements (default true)",
			},
		],
		returnDoc:
			"{ nodes: [{ refId?, tag, role?, name?, attributes?, hidden?, hiddenReason?, accept?, filesCount?, children? }], url, title }",
		errorCode: "E_NO_TAB",
		example:
			'web.tab.dom({ tabId: 123, selector: "input[type=file]", depth: 0 })',
		agentMeta: {
			prerequisites: ["Target tab exists with content script ready"],
			notes: [
				"Read-only: returns DOM structure, never executes code or mutates the page",
				"Bypasses snapshot filtering and can include hidden nodes by default",
				"Assigns refIds to returned elements; those refIds are immediately actionable by web.tab.click/fill in the same cell",
				"Use web.tab.dom immediately when struggling to find data in snapshot output",
			],
			tags: ["read"],
			relatedApis: ["page.dom", "web.tab.snapshot", "web.tab.find"],
		},
		handlerKey: "dom",
	},
] as const;
