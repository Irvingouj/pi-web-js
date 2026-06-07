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
	"extension",
	[],
	"chrome.tabs.query({})"
);
registerChromePassthrough(
	"chrome_tabs_create",
	"chrome",
	"Create a tab",
	["tabs"],
	schemas.ChromeTabSchema,
	"ECHROME",
	"extension",
	[],
	"chrome.tabs.create({ url: \"https://example.com\" })"
);
registerChromePassthrough(
	"chrome_tabs_update",
	"chrome",
	"Update a tab",
	["tabs"],
	schemas.ChromeTabSchema,
	"ECHROME",
	"extension",
	[],
	"chrome.tabs.update(1, { active: true })"
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
			description: "Tab ID to remove (literal)",
		},
	],
	"chrome.tabs.remove(1)"
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
			description: "Tab ID to get (literal)",
		},
	],
	"chrome.tabs.get(1)"
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
			description: "Tab ID to reload (literal)",
		},
	],
	"chrome.tabs.reload(1)"
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
		{ name: "tabId", type: "number", required: false, description: "Tab ID (literal)" },
		{
			name: "message",
			type: "object",
			required: false,
			description: "Message to send (literal)",
		},
	],
	"chrome.tabs.sendMessage(123, { greeting: \"hello\" })"
);
registerChromePassthrough(
	"chrome_tabs_connect",
	"chrome",
	"Connect to a tab",
	["tabs"],
	z.record(z.unknown()),
	"ECHROME",
	"extension",
	[],
	"chrome.tabs.connect(123, { name: \"myPort\" })"
);
registerChromePassthrough(
	"chrome_tabs_group",
	"chrome",
	"Group tabs",
	["tabs"],
	z.number(),
	"ECHROME",
	"extension",
	[],
	"chrome.tabs.group({ tabIds: [1, 2, 3] })"
);
registerChromePassthrough(
	"chrome_tabs_ungroup",
	"chrome",
	"Ungroup tabs",
	["tabs"],
	zChromeVoid,
	"ECHROME",
	"extension",
	[],
	"chrome.tabs.ungroup([1, 2, 3])"
);
