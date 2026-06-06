/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";

registerChromePassthrough(
	"chrome_tabs_query",
	"chrome",
	"Query tabs",
	["tabs"],
	schemas.ChromeTabsQueryParamsSchema,
	schemas.ChromeTabArraySchema,
	"ECHROME",
	"extension",
	[
		{
			name: "query",
			type: "object",
			required: false,
			description: "Tab query object",
		},
	],
);
registerChromePassthrough(
	"chrome_tabs_create",
	"chrome",
	"Create a tab",
	["tabs"],
	schemas.ChromeTabsCreateParamsSchema,
	schemas.ChromeTabSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "url",
			type: "string",
			required: false,
			description: "URL to open",
		},
		{
			name: "active",
			type: "boolean",
			required: false,
			description: "Whether to focus the new tab",
		},
	],
);
registerChromePassthrough(
	"chrome_tabs_update",
	"chrome",
	"Update a tab",
	["tabs"],
	schemas.ChromeTabsUpdateParamsSchema,
	schemas.ChromeTabSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "tabId",
			type: "number",
			required: false,
			description: "Tab ID to update",
		},
		{
			name: "update",
			type: "object",
			required: false,
			description: "Update properties",
		},
	],
);
registerChromePassthrough(
	"chrome_tabs_remove",
	"chrome",
	"Remove a tab",
	["tabs"],
	schemas.ChromeTabsRemoveParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "tabId",
			type: "number",
			required: false,
			description: "Tab ID to remove",
		},
	],
	["tabIds"],
);
registerChromePassthrough(
	"chrome_tabs_get",
	"chrome",
	"Get a tab",
	["tabs"],
	schemas.ChromeTabsGetParamsSchema,
	schemas.ChromeTabSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "tabId",
			type: "number",
			required: false,
			description: "Tab ID to get",
		},
	],
	["tabId"],
);
registerChromePassthrough(
	"chrome_tabs_reload",
	"chrome",
	"Reload a tab",
	["tabs"],
	schemas.ChromeTabsReloadParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "tabId",
			type: "number",
			required: false,
			description: "Tab ID to reload",
		},
	],
	["tabId"],
);
registerChromePassthrough(
	"chrome_tabs_sendMessage",
	"chrome",
	"Send a message to a tab",
	["tabs"],
	schemas.ChromeTabsSendMessageParamsSchema,
	z.unknown(),
	"ECHROME",
	"extension",
	[
		{ name: "tabId", type: "number", required: false, description: "Tab ID" },
		{
			name: "message",
			type: "object",
			required: false,
			description: "Message to send",
		},
	],
	["tabId", "message", "options"],
);
registerChromePassthrough(
	"chrome_tabs_group",
	"chrome",
	"Group tabs",
	["tabs"],
	schemas.ChromeTabsGroupParamsSchema,
	z.number(),
	"ECHROME",
	"extension",
	[
		{
			name: "tabIds",
			type: "array",
			required: false,
			description: "Tab IDs to group",
		},
		{
			name: "groupId",
			type: "number",
			required: false,
			description: "Group ID",
		},
	],
);
registerChromePassthrough(
	"chrome_tabs_ungroup",
	"chrome",
	"Ungroup tabs",
	["tabs"],
	schemas.ChromeTabsUngroupParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "tabIds",
			type: "number",
			required: false,
			description: "Tab ID to ungroup",
		},
	],
);
