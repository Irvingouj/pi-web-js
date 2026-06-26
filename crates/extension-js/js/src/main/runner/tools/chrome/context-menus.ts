import * as schemas from "../../../../shared/cross/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";
import { zChromeVoid } from "./register-helpers.js";

registerChromePassthrough(
	"chrome_contextMenus_create",
	"chrome",
	"Create a context menu",
	["contextMenus"],
	schemas.ChromeMenuItemIdSchema,
	"ECHROME",
	"extension",
	[],
	'chrome.contextMenus.create({ id: "menuItemId", title: "My Menu", contexts: ["page"] })',
);
registerChromePassthrough(
	"chrome_contextMenus_remove",
	"chrome",
	"Remove a context menu",
	["contextMenus"],
	zChromeVoid,
	"ECHROME",
	"extension",
	[
		{
			name: "menuItemId",
			type: "string",
			required: false,
			description: "Menu item ID to remove (literal)",
		},
	],
	'chrome.contextMenus.remove("menuItemId")',
);
registerChromePassthrough(
	"chrome_contextMenus_removeAll",
	"chrome",
	"Remove all context menus",
	["contextMenus"],
	zChromeVoid,
	"ECHROME",
	"extension",
	[],
	"chrome.contextMenus.removeAll()",
);
registerChromePassthrough(
	"chrome_contextMenus_update",
	"chrome",
	"Update a context menu",
	["contextMenus"],
	zChromeVoid,
	"ECHROME",
	"extension",
	[],
	'chrome.contextMenus.update("menuItemId", { title: "Updated" })',
);
