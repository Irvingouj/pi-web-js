/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/schemas.js";
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
			description: "Whether to populate tab info",
		},
	],
);

registerChromePassthrough(
	"chrome_windows_getAll",
	"chrome",
	"Get all windows",
	["windows"],
	schemas.ChromeWindowArraySchema,
	"ECHROME",
	"extension"
);
registerChromePassthrough(
	"chrome_windows_create",
	"chrome",
	"Create a window",
	["windows"],
	schemas.ChromeWindowSchema,
	"ECHROME",
	"extension"
);
registerChromePassthrough(
	"chrome_windows_update",
	"chrome",
	"Update a window",
	["windows"],
	schemas.ChromeWindowSchema,
	"ECHROME",
	"extension"
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
	]
);
