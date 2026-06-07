/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";
import { zChromeVoid } from "./register-helpers.js";

registerChromePassthrough(
	"chrome_history_search",
	"chrome",
	"Search history",
	["history"],
	schemas.ChromeHistoryArraySchema,
	"ECHROME",
	"extension"
);
registerChromePassthrough(
	"chrome_history_deleteUrl",
	"chrome",
	"Delete a URL from history",
	["history"],
	zChromeVoid,
	"ECHROME",
	"extension",
	[
		{
			name: "url",
			type: "string",
			required: false,
			description: "URL to delete from history",
		},
	]
);
registerChromePassthrough(
	"chrome_history_addUrl",
	"chrome",
	"Add URL to history",
	["history"],
	zChromeVoid,
	"ECHROME",
	"extension"
);
registerChromePassthrough(
	"chrome_history_deleteAll",
	"chrome",
	"Delete all history",
	["history"],
	zChromeVoid,
	"ECHROME",
	"extension"
);
registerChromePassthrough(
	"chrome_history_deleteRange",
	"chrome",
	"Delete history in range",
	["history"],
	zChromeVoid,
	"ECHROME",
	"extension"
);
registerChromePassthrough(
	"chrome_history_getVisits",
	"chrome",
	"Get visits for URL",
	["history"],
	schemas.ChromeHistoryArraySchema,
	"ECHROME",
	"extension"
);
