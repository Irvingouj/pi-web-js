/**
 * page.* content-script tool specs — tools operating on the active tab.
 * Extracted from content-script-tools.ts by namespace.
 */
import { z } from "zod";
import * as schemas from "./schemas.js";
import type { JsCallSpec } from "./manifest.js";

export const AWAIT_PROMISE_NOTE =
	"Returns a Promise; await before reading the result. For a cell's last line, use `page.snapshot()` without a leading await so the cell returns the settled value.";

export type ContentScriptToolSpec<P = unknown, R = unknown> = Omit<
	JsCallSpec<P, R>,
	"owner" | "handler"
> & {
	handlerKey: string;
};

export const PAGE_TOOL_SPECS: readonly ContentScriptToolSpec[] = [
	{
		action: "page_back",
		namespace: "page",
		name: "back",
		description: "Go back in the active tab",
		params: schemas.PageBackParamsSchema,
		returns: schemas.PageActionResultSchema,
		paramTypes: [],
		returnDoc: "Navigation result",
		errorCode: "E_NO_TAB",
		example: "page.back()",
		handlerKey: "back",
	},
	{
		action: "page_click",
		namespace: "page",
		name: "click",
		description: "Click an element in the active tab",
		params: schemas.PageClickParamsSchema,
		returns: schemas.PageActionResultSchema,
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
		returnDoc: "{ ok: true, action: 'click', refId? }",
		errorCode: "E_MISSING_PARAM",
		example: 'page.click({ refId: "e2" })',
		agentMeta: {
			prerequisites: [
				"Ensure the target tab is active and the content script is ready before mutating",
			],
			notes: [
				AWAIT_PROMISE_NOTE,
				"Same content-script path as web.tab.*",
				"Always operates on the active tab; use web.tab.* if you need to target a specific tabId",
			],
			tags: ["mutation", "write"],
			relatedApis: ["web.tab.click"],
		},
		handlerKey: "click",
	},
	{
		action: "page_fill",
		namespace: "page",
		name: "fill",
		description: "Fill an element in the active tab",
		params: schemas.PageFillParamsSchema,
		returns: schemas.PageActionResultSchema,
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
		returnDoc: "{ ok: true, action: 'fill', refId?, value? }",
		errorCode: "E_MISSING_PARAM",
		example: 'page.fill({ refId: "e2", value: "hello" })',
		agentMeta: {
			prerequisites: [
				"Ensure the target tab is active and the content script is ready before mutating",
			],
			notes: [
				AWAIT_PROMISE_NOTE,
				"Same content-script path as web.tab.*",
				"Always operates on the active tab; use web.tab.* if you need to target a specific tabId",
			],
			tags: ["mutation", "write"],
			relatedApis: ["web.tab.fill"],
		},
		handlerKey: "fill",
	},
	{
		action: "page_set_files",
		namespace: "page",
		name: "setFiles",
		description: "Attach files to a file input in the active tab",
		params: schemas.PageSetFilesParamsSchema,
		returns: schemas.PageActionResultSchema,
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
				name: "files",
				type: "{ name?: string, url?: string, path?: string, handle?: string, mimeType?: string }[]",
				required: true,
				description:
					"Each entry uses exactly one of url, path (vfs), or handle (from page.fetch store:true)",
			},
		],
		returnDoc:
			"{ ok: true, action: 'setFiles', refId?, fileCount?, fileNames? }",
		errorCode: "E_MISSING_PARAM",
		example:
			'page.setFiles({ refId: "e3", files: [{ url: "https://example.com/photo.jpg", name: "photo.jpg" }] })',
		agentMeta: {
			prerequisites: [
				"Ensure the target tab is active and the content script is ready before mutating",
			],
			notes: [
				AWAIT_PROMISE_NOTE,
				"Target must be input[type=file]; prefer url, vfs path, or fetch handle — bytes are not passed through QuickJS",
				"Use page.fetch({ url, store: true }) then setFiles({ files: [{ handle }] }) for downloaded binaries",
				"Same content-script path as web.tab.*",
				"Always operates on the active tab; use web.tab.* if you need to target a specific tabId",
			],
			tags: ["mutation", "write"],
			relatedApis: ["web.tab.setFiles", "page.fetch", "fs.writeBase64"],
		},
		handlerKey: "set_files",
	},
	{
		action: "page_type",
		namespace: "page",
		name: "type",
		description: "Type into an element in the active tab",
		params: schemas.PageTypeParamsSchema,
		returns: schemas.PageActionResultSchema,
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
		returnDoc: "{ ok: true, action: 'type', refId?, value? }",
		errorCode: "E_MISSING_PARAM",
		example: 'page.type({ refId: "e2", text: "hello" })',
		agentMeta: {
			prerequisites: [
				"Ensure the target tab is active and the content script is ready before mutating",
			],
			notes: [
				AWAIT_PROMISE_NOTE,
				"Same content-script path as web.tab.*",
				"Always operates on the active tab; use web.tab.* if you need to target a specific tabId",
			],
			tags: ["mutation", "write"],
			relatedApis: ["web.tab.type"],
		},
		handlerKey: "type",
	},
	{
		action: "page_append",
		namespace: "page",
		name: "append",
		description: "Append text to an element in the active tab",
		params: schemas.PageAppendParamsSchema,
		returns: schemas.PageActionResultSchema,
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
		returnDoc: "{ ok: true, action: 'append', refId?, value? }",
		errorCode: "E_MISSING_PARAM",
		example: 'page.append({ refId: "e2", text: " world" })',
		agentMeta: {
			prerequisites: [
				"Ensure the target tab is active and the content script is ready before mutating",
			],
			notes: [
				"Same content-script path as web.tab.*",
				"Always operates on the active tab; use web.tab.* if you need to target a specific tabId",
			],
			tags: ["mutation", "write"],
		},
		handlerKey: "append",
	},
	{
		action: "page_press",
		namespace: "page",
		name: "press",
		description: "Press a key in the active tab",
		params: schemas.PagePressParamsSchema,
		returns: schemas.PageActionResultSchema,
		fields: ["key"],
		paramTypes: [
			{
				name: "key",
				type: "string",
				required: true,
				description: "Key to press (literal)",
			},
		],
		returnDoc: "{ ok: true, action: 'press', key? }",
		errorCode: "E_NO_TAB",
		example: 'page.press("Enter")',
		agentMeta: {
			prerequisites: [
				"Ensure the target tab is active and the content script is ready before mutating",
			],
			notes: [
				"Same content-script path as web.tab.*",
				"Always operates on the active tab; use web.tab.* if you need to target a specific tabId",
			],
			tags: ["mutation", "write"],
			relatedApis: ["web.tab.press"],
		},
		handlerKey: "press",
	},
	{
		action: "page_select",
		namespace: "page",
		name: "select",
		description: "Select an option in the active tab",
		params: schemas.PageSelectParamsSchema,
		returns: schemas.PageActionResultSchema,
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
		returnDoc: "{ ok: true, action: 'select', refId?, value? }",
		errorCode: "E_MISSING_PARAM",
		example: 'page.select({ refId: "e2", value: "option1" })',
		agentMeta: {
			prerequisites: [
				"Ensure the target tab is active and the content script is ready before mutating",
			],
			notes: [
				"Same content-script path as web.tab.*",
				"Always operates on the active tab; use web.tab.* if you need to target a specific tabId",
			],
			tags: ["mutation", "write"],
			relatedApis: ["web.tab.select"],
		},
		handlerKey: "select",
	},
	{
		action: "page_select_option",
		namespace: "page",
		name: "select_option",
		description:
			"Select a value from a dropdown/combobox (native select, react-select, ARIA listbox) by clicking the option whose visible text matches value",
		params: schemas.PageSelectOptionParamsSchema,
		returns: schemas.PageActionResultSchema,
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
				description:
					"Visible text of the option to select (matched case-insensitively)",
			},
		],
		returnDoc: "{ ok: true, action: 'select_option', refId?, value? }",
		errorCode: "E_NOT_FOUND",
		example: 'page.select_option({ refId: degree.refId, value: "Bachelor\'s Degree" })',
		agentMeta: {
			prerequisites: [
				"Ensure the target tab is active and the content script is ready before mutating",
			],
			notes: [
				"Same content-script path as web.tab.*",
				"Always operates on the active tab; use web.tab.* if you need to target a specific tabId",
				"RULE: every dropdown (combobox/select/listbox) MUST use page.select_option({refId, value}). NEVER page.fill, page.type, or page.click on a dropdown control or its validation-proxy input.",
				"Use this for snapshot nodes printed as dropdown or nodes with controlType='dropdown'; do not use page.fill/type on those controls",
				"Drives react-select and other ARIA combobox patterns: clicks the control to open, follows the controlled listbox where available, then clicks the matching [role='option']",
			],
			tags: ["mutation", "write"],
			relatedApis: ["web.tab.select_option"],
		},
		handlerKey: "select_option",
	},
	{
		action: "page_check",
		namespace: "page",
		name: "check",
		description: "Check/uncheck an element in the active tab",
		params: schemas.PageCheckParamsSchema,
		returns: schemas.PageActionResultSchema,
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
		returnDoc: "{ ok: true, action: 'check', refId?, checked? }",
		errorCode: "E_MISSING_PARAM",
		example: 'page.check({ refId: "e2", checked: true })',
		agentMeta: {
			prerequisites: [
				"Ensure the target tab is active and the content script is ready before mutating",
			],
			notes: [
				"Same content-script path as web.tab.*",
				"Always operates on the active tab; use web.tab.* if you need to target a specific tabId",
			],
			tags: ["mutation", "write"],
			relatedApis: ["web.tab.check"],
		},
		handlerKey: "check",
	},
	{
		action: "page_hover",
		namespace: "page",
		name: "hover",
		description: "Hover over an element in the active tab",
		params: schemas.PageHoverParamsSchema,
		returns: schemas.PageActionResultSchema,
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
		returnDoc: "{ ok: true, action: 'hover', refId? }",
		errorCode: "E_MISSING_PARAM",
		example: 'page.hover({ refId: "e2" })',
		agentMeta: {
			prerequisites: [
				"Ensure the target tab is active and the content script is ready before mutating",
			],
			notes: [
				"Same content-script path as web.tab.*",
				"Always operates on the active tab; use web.tab.* if you need to target a specific tabId",
			],
			tags: ["mutation", "write"],
			relatedApis: ["web.tab.hover"],
		},
		handlerKey: "hover",
	},
	{
		action: "page_unhover",
		namespace: "page",
		name: "unhover",
		description: "Unhover in the active tab",
		params: schemas.PageUnhoverParamsSchema,
		returns: schemas.PageActionResultSchema,
		paramTypes: [],
		returnDoc: "{ ok: true, action: 'unhover' }",
		errorCode: "E_NO_TAB",
		example: "page.unhover()",
		agentMeta: {
			prerequisites: [
				"Ensure the target tab is active and the content script is ready before mutating",
			],
			notes: [
				"Same content-script path as web.tab.*",
				"Always operates on the active tab; use web.tab.* if you need to target a specific tabId",
			],
			tags: ["mutation", "write"],
			relatedApis: ["web.tab.unhover"],
		},
		handlerKey: "unhover",
	},
	{
		action: "page_submit",
		namespace: "page",
		name: "submit",
		description: "Submit a form in the active tab (calls form.requestSubmit())",
		params: schemas.PageSubmitParamsSchema,
		returns: schemas.PageActionResultSchema,
		paramTypes: [
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
		errorCode: "E_MISSING_PARAM",
		example: 'page.submit({ refId: "e2" })',
		agentMeta: {
			prerequisites: [
				"Ensure the target tab is active and the content script is ready before mutating",
			],
			notes: [
				"Target a <form> element or any descendant; resolves to the owning form",
				"Uses form.requestSubmit() so submit event listeners fire and validation runs",
				"Same content-script path as web.tab.*",
			],
			tags: ["mutation", "write"],
			relatedApis: ["web.tab.submit", "page.click"],
		},
		handlerKey: "submit",
	},
	{
		action: "page_check_radio",
		namespace: "page",
		name: "checkRadio",
		description:
			"Check a radio option by group name and value in the active tab",
		params: schemas.PageCheckRadioParamsSchema,
		returns: schemas.PageActionResultSchema,
		paramTypes: [
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
		errorCode: "E_MISSING_PARAM",
		example: 'page.checkRadio({ name: "radio-grp", value: "opt2" })',
		agentMeta: {
			prerequisites: [
				"Ensure the target tab is active and the content script is ready before mutating",
			],
			notes: [
				"Picks a radio by group name + value — no refId needed",
				"Use page.snapshot_data to discover radio values from the DOM",
				"Same content-script path as web.tab.*",
			],
			tags: ["mutation", "write"],
			relatedApis: ["web.tab.checkRadio", "page.check", "page.snapshot_data"],
		},
		handlerKey: "check_radio",
	},
	{
		action: "page_scroll",
		namespace: "page",
		name: "scroll",
		description: "Scroll the active tab",
		params: schemas.PageScrollParamsSchema,
		returns: schemas.PageActionResultSchema,
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
		example: 'page.scroll("down", 500)',
		handlerKey: "scroll",
	},
	{
		action: "page_scroll_to",
		namespace: "page",
		name: "scroll_to",
		description: "Scroll to an element in the active tab",
		params: schemas.PageScrollToParamsSchema,
		returns: schemas.PageActionResultSchema,
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
		example: 'page.scroll_to({ refId: "e2" })',
		handlerKey: "scroll_to",
	},
	{
		action: "page_dblclick",
		namespace: "page",
		name: "dblclick",
		description: "Double-click an element in the active tab",
		params: schemas.PageDblClickParamsSchema,
		returns: schemas.PageActionResultSchema,
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
		returnDoc: "{ ok: true, action: 'dblclick', refId? }",
		errorCode: "E_MISSING_PARAM",
		example: 'page.dblclick({ refId: "e2" })',
		agentMeta: {
			prerequisites: [
				"Ensure the target tab is active and the content script is ready before mutating",
			],
			notes: [
				"Same content-script path as web.tab.*",
				"Always operates on the active tab; use web.tab.* if you need to target a specific tabId",
			],
			tags: ["mutation", "write"],
			relatedApis: ["web.tab.dblclick"],
		},
		handlerKey: "dblclick",
	},
	{
		action: "page_forward",
		namespace: "page",
		name: "forward",
		description: "Go forward in the active tab",
		params: schemas.PageForwardParamsSchema,
		returns: schemas.PageActionResultSchema,
		paramTypes: [],
		returnDoc: "Navigation result",
		errorCode: "E_NO_TAB",
		example: "page.forward()",
		handlerKey: "forward",
	},
	{
		action: "page_snapshot",
		namespace: "page",
		name: "snapshot",
		description:
			"Capture a broad, text-first page snapshot. Default behavior is intentionally generous: visible text, form values, required/invalid state, and linked field error text are included with actionable refIds where possible.",
		params: schemas.PageSnapshotParamsSchema,
		returns: z.string(),
		paramTypes: [
			{
				name: "max_nodes",
				type: "number",
				required: false,
				description:
					"Maximum nodes to include (literal). Defaults high; lower it only when you intentionally want a smaller snapshot.",
			},
			{
				name: "options",
				type: "{ max_nodes?: number }",
				required: false,
				description:
					"Snapshot options (literal). Use max_nodes only to opt into less output.",
			},
		],
		returnDoc: "Snapshot text",
		errorCode: "E_SNAPSHOT",
		example: "page.snapshot()",
		agentMeta: {
			notes: [
				AWAIT_PROMISE_NOTE,
				"Content-script path; same refIds as mutations",
				"Do not assume accessibility-only output: snapshot includes visible text and validation/error text even when it is not interactive",
				"If the needed data, options, hidden input, or attributes are still missing, call page.dom({ selector, depth, includeHidden: true }) directly",
			],
			tags: ["snapshot", "read"],
			relatedApis: ["page.snapshot_data", "page.dom", "web.tab.snapshot"],
		},
		handlerKey: "snapshot_text",
	},
	{
		action: "page_snapshot_text",
		namespace: "page",
		name: "snapshot_text",
		description:
			"Capture a broad text-first DOM snapshot and return only its text representation",
		params: schemas.PageSnapshotTextParamsSchema,
		returns: z.string(),
		paramTypes: [
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
		example: "page.snapshot_text()",
		handlerKey: "snapshot_text",
	},
	{
		action: "page_snapshot_data",
		namespace: "page",
		name: "snapshot_data",
		description:
			"Get broad page snapshot data. Includes visible text, form values, required/invalid state, linked error text, and actionable refIds where possible.",
		params: schemas.PageSnapshotDataParamsSchema,
		returns: schemas.SnapshotResultSchema,
		paramTypes: [
			{
				name: "max_nodes",
				type: "number",
				required: false,
				description:
					"Maximum nodes to include (literal). Defaults high; lower it only when intentionally limiting output.",
			},
		],
		returnDoc: "{ text, nodes, url, title, viewport }",
		errorCode: "E_SNAPSHOT",
		example: "page.snapshot_data()",
		agentMeta: {
			notes: [
				AWAIT_PROMISE_NOTE,
				"Content-script path; nodes include refId for targeting when an element can be acted on",
				"Snapshot is text-first and broad by default; filtering/limiting is opt-in via snapshot_query or max_nodes",
				"After mutations, call snapshot_data() again to verify state",
				"If a widget's raw attributes or hidden nodes matter, inspect them with page.dom({ selector, depth, includeHidden: true })",
			],
			tags: ["snapshot", "read"],
			relatedApis: ["page.click", "page.dom", "web.tab.snapshot_data"],
		},
		handlerKey: "snapshot",
	},
	{
		action: "page_snapshot_query",
		namespace: "page",
		name: "snapshot_query",
		description:
			"Opt-in filtered snapshot query by role, tag, text, name, etc. Use this only when you intentionally want less than the default broad snapshot.",
		params: schemas.PageSnapshotQueryParamsSchema,
		returns: schemas.SnapshotResultSchema,
		paramTypes: [
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
		example: 'page.snapshot_query({ filter: { role: "button" } })',
		agentMeta: {
			notes: [
				AWAIT_PROMISE_NOTE,
				"Content-script path; filters nodes by role, tag, text, name, interactiveOnly, href, src",
				"More efficient than page.snapshot_data() when only specific elements are needed, but it can hide useful text by design",
				"If filtering hides the data you need, use page.snapshot_data() or page.dom({ selector, depth, includeHidden: true })",
			],
			tags: ["snapshot", "read"],
			relatedApis: ["page.snapshot_data", "page.dom", "page.find"],
		},
		handlerKey: "snapshot_query",
	},
	{
		action: "page_find",
		namespace: "page",
		name: "find",
		description: "Find elements in the active tab using a CSS selector",
		params: schemas.PageFindParamsSchema,
		returns: z.array(
			z.object({
				refId: schemas.refIdString(),
				role: z.string(),
				tag: z.string(),
				name: z.string().optional(),
				text: z.string().optional(),
				value: z.string().optional(),
				checked: z.boolean().optional(),
				disabled: z.boolean().optional(),
				readOnly: z.boolean().optional(),
				href: z.string().optional(),
				src: z.string().optional(),
				alt: z.string().optional(),
				title: z.string().optional(),
				parentRefId: schemas.refIdString().optional(),
			}),
		),
		aliases: [{ namespace: "page", name: "query" }],
		fields: ["selector"],
		paramTypes: [
			{
				name: "selector",
				type: "string",
				required: true,
				description: "CSS selector to find elements (selector)",
			},
		],
		returnDoc:
			"Array of elements with refId, role, name, href/src, alt, and parentRefId",
		errorCode: "E_NO_TAB",
		example: 'page.find("h1")',
		agentMeta: {
			notes: [
				"Assigns data-ref-id on matched elements when missing so results include actionable refIds",
				"Returned refIds are immediately actionable — call page.click/fill/select_option on them without an intermediate snapshot_data",
				"For dropdowns found via find, use page.select_option — not fill/type",
			],
			tags: ["read"],
		},
		handlerKey: "find",
	},
	{
		action: "page_dom",
		namespace: "page",
		name: "dom",
		description:
			"Introspect raw DOM subtree by CSS selector. Read-only. Use this whenever snapshot/find do not expose enough data: hidden inputs, validation shims, raw attributes, dropdown/listbox ownership, shadowed widgets, aria-hidden regions, or exact DOM structure.",
		params: schemas.PageDomParamsSchema,
		returns: schemas.PageDomResultSchema,
		paramTypes: [
			{
				name: "selector",
				type: "string",
				required: true,
				description: "CSS selector for root element(s)",
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
		example: 'page.dom({ selector: "input[type=file]", depth: 0 })',
		agentMeta: {
			prerequisites: ["Active tab with content script ready"],
			notes: [
				AWAIT_PROMISE_NOTE,
				"Read-only: returns DOM structure, never executes code or mutates the page",
				"Bypasses snapshot filtering and can include hidden nodes by default",
				"Assigns refIds to returned elements so subsequent page.setFiles/click/fill can target them",
				"Use page.dom immediately when struggling to find data in snapshot output; do not keep guessing selectors from the accessibility tree",
				"If a dom node is a dropdown (role=combobox/tag=select/controlType=dropdown), use page.select_option on its refId",
			],
			tags: ["read"],
			relatedApis: ["page.find", "page.snapshot_data", "page.setFiles"],
		},
		handlerKey: "dom",
	},
	{
		action: "page_wait_for",
		namespace: "page",
		name: "wait_for",
		description: "Wait for a selector in the active tab",
		params: schemas.PageWaitForParamsSchema,
		returns: z.boolean(),
		fields: ["selector", "timeout"],
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
		example: 'page.wait_for("#submit", 5000)',
		agentMeta: {
			notes: [AWAIT_PROMISE_NOTE],
			tags: ["read"],
		},
		handlerKey: "wait_for",
	},
	{
		action: "page_extract",
		namespace: "page",
		name: "extract",
		description: "Extract data from the active tab",
		params: schemas.PageExtractParamsSchema,
		returns: z
			.object({
				title: z.string().optional(),
				url: z.string().optional(),
				headings: z
					.array(z.object({ tag: z.string(), text: z.string() }))
					.optional(),
				links: z
					.array(z.object({ href: z.string().nullable(), text: z.string() }))
					.optional(),
				text: z.string().optional(),
			})
			.passthrough(),
		fields: ["fields"],
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
		example: 'page.extract(["title", "url"])',
		agentMeta: {
			notes: [AWAIT_PROMISE_NOTE],
			tags: ["read"],
		},
		handlerKey: "extract",
	},
	{
		action: "page_fetch",
		namespace: "page",
		name: "fetch",
		description: "Fetch in the active tab",
		params: schemas.FetchParamsSchema,
		returns: schemas.FetchValueSchema,
		fields: ["url", "options"],
		paramTypes: [
			{
				name: "url",
				type: "string",
				required: false,
				description: "URL to fetch (url)",
			},
			{
				name: "options",
				type: "{ method?: string, headers?: { [key: string]: string }, body?: string }",
				required: false,
				description: "Fetch options (literal)",
			},
		],
		returnDoc: "DTO with `{ body, headers, ok, status }`",
		errorCode: "E_NO_TAB",
		example: 'page.fetch({ url: "https://api.example.com/data" })',
		agentMeta: {
			notes: [
				AWAIT_PROMISE_NOTE,
				"Runtime binary globals available: Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, atob, btoa",
				"For binary responses bodyEncoding is 'base64'; use atob() or fs.writeBase64 to handle bytes",
			],
			tags: ["read"],
		},
		handlerKey: "fetch",
	},
] as const;
