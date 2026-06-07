/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";
import { zChromeVoid } from "./register-helpers.js";

registerChromePassthrough(
	"chrome_tabs_query",
	"chrome",
	"Query tabs",
	["tabs"],
	schemas.ChromeTabArraySchema,
	"ECHROME",
	"extension"
);
registerChromePassthrough(
	"chrome_tabs_create",
	"chrome",
	"Create a tab",
	["tabs"],
	schemas.ChromeTabSchema,
	"ECHROME",
	"extension"
);
registerChromePassthrough(
	"chrome_tabs_update",
	"chrome",
	"Update a tab",
	["tabs"],
	schemas.ChromeTabSchema,
	"ECHROME",
	"extension"
);
registerChromePassthrough(
	"chrome_tabs_remove",
	"chrome",
	"Remove a tab",
	["tabs"],
	zChromeVoid,
	"ECHROME",
	"extension",
	[
		{
			name: "tabId",
			type: "number",
			required: false,
			description: "Tab ID to remove",
		},
	]
);
registerChromePassthrough(
	"chrome_tabs_get",
	"chrome",
	"Get a tab",
	["tabs"],
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
	]
);
registerChromePassthrough(
	"chrome_tabs_reload",
	"chrome",
	"Reload a tab",
	["tabs"],
	zChromeVoid,
	"ECHROME",
	"extension",
	[
		{
			name: "tabId",
			type: "number",
			required: false,
			description: "Tab ID to reload",
		},
	]
);
registerChromePassthrough(
	"chrome_tabs_sendMessage",
	"chrome",
	"Send a message to a tab",
	["tabs"],
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
	]
);
registerChromePassthrough(
	"chrome_tabs_connect",
	"chrome",
	"Connect to a tab",
	["tabs"],
	z.record(z.unknown()),
	"ECHROME",
	"extension"
);
registerChromePassthrough(
	"chrome_tabs_group",
	"chrome",
	"Group tabs",
	["tabs"],
	z.number(),
	"ECHROME",
	"extension"
);
registerChromePassthrough(
	"chrome_tabs_ungroup",
	"chrome",
	"Ungroup tabs",
	["tabs"],
	zChromeVoid,
	"ECHROME",
	"extension"
);
