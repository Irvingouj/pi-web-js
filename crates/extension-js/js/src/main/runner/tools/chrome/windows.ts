import * as schemas from "../../../../shared/cross/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";
import { zChromeVoid } from "./register-helpers.js";

registerChromePassthrough(
	"chrome_windows_getCurrent",
	"chrome",
	"Get the current window",
	["windows"],
	schemas.ChromeWindowSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "populate",
			type: "boolean",
			required: false,
			description: "Whether to populate tab info (literal)",
		},
	],
	"chrome.windows.getCurrent({ populate: true })",
);

registerChromePassthrough(
	"chrome_windows_getAll",
	"chrome",
	"Get all windows",
	["windows"],
	schemas.ChromeWindowArraySchema,
	"ECHROME",
	"extension",
	[],
	"chrome.windows.getAll({ populate: false })",
);
registerChromePassthrough(
	"chrome_windows_create",
	"chrome",
	"Create a window",
	["windows"],
	schemas.ChromeWindowSchema,
	"ECHROME",
	"extension",
	[],
	'chrome.windows.create({ url: "https://example.com" })',
);
registerChromePassthrough(
	"chrome_windows_update",
	"chrome",
	"Update a window",
	["windows"],
	schemas.ChromeWindowSchema,
	"ECHROME",
	"extension",
	[],
	"chrome.windows.update(1, { focused: true })",
);
registerChromePassthrough(
	"chrome_windows_remove",
	"chrome",
	"Remove a window",
	["windows"],
	zChromeVoid,
	"ECHROME",
	"extension",
	[
		{
			name: "windowId",
			type: "number",
			required: false,
			description: "Window ID to remove",
		},
	],
	"chrome.windows.remove(1)",
);
