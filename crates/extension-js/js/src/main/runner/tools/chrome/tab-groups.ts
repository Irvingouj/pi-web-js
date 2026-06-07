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
	"extension",
	[],
	"chrome.tabGroups.query({})"
);
registerChromePassthrough(
	"chrome_tabGroups_get",
	"chrome",
	"Get a tab group",
	["tabGroups"],
	schemas.ChromeTabGroupSchema,
	"ECHROME",
	"extension",
	[],
	"chrome.tabGroups.get(1)"
);
registerChromePassthrough(
	"chrome_tabGroups_update",
	"chrome",
	"Update a tab group",
	["tabGroups"],
	schemas.ChromeTabGroupSchema,
	"ECHROME",
	"extension",
	[],
	"chrome.tabGroups.update(1, { title: \"Work\" })"
);
registerChromePassthrough(
	"chrome_tabGroups_move",
	"chrome",
	"Move a tab group",
	["tabGroups"],
	schemas.ChromeTabGroupSchema,
	"ECHROME",
	"extension",
	[],
	"chrome.tabGroups.move(1, { index: 0 })"
);
