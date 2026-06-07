/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";

registerChromePassthrough(
	"chrome_tabGroups_query",
	"chrome",
	"Query tab groups",
	["tabGroups"],
	schemas.ChromeTabGroupArraySchema,
	"ECHROME",
	"extension"
);
registerChromePassthrough(
	"chrome_tabGroups_get",
	"chrome",
	"Get a tab group",
	["tabGroups"],
	schemas.ChromeTabGroupSchema,
	"ECHROME",
	"extension"
);
registerChromePassthrough(
	"chrome_tabGroups_update",
	"chrome",
	"Update a tab group",
	["tabGroups"],
	schemas.ChromeTabGroupSchema,
	"ECHROME",
	"extension"
);
registerChromePassthrough(
	"chrome_tabGroups_move",
	"chrome",
	"Move a tab group",
	["tabGroups"],
	schemas.ChromeTabGroupSchema,
	"ECHROME",
	"extension"
);
