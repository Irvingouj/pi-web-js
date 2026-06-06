/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";

registerChromePassthrough(
	"chrome_contextMenus_create",
	"chrome",
	"Create a context menu",
	["contextMenus"],
	schemas.ChromeContextMenusCreateParamsSchema,
	schemas.ChromeMenuItemIdSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "createProperties",
			type: "object",
			required: false,
			description: "Menu properties",
		},
	],
);
registerChromePassthrough(
	"chrome_contextMenus_remove",
	"chrome",
	"Remove a context menu",
	["contextMenus"],
	schemas.ChromeContextMenusRemoveParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "menuItemId",
			type: "string",
			required: false,
			description: "Menu item ID to remove",
		},
	],
	["menuItemId"],
);
