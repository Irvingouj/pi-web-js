/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";

registerChromePassthrough(
	"chrome_tabGroups_query",
	"chrome",
	"Query tab groups",
	["tabGroups"],
	schemas.ChromeTabGroupsQueryParamsSchema,
	schemas.ChromeTabGroupArraySchema,
	"ECHROME",
	"extension",
	[
		{
			name: "query",
			type: "object",
			required: false,
			description: "Tab group query",
		},
	],
);
registerChromePassthrough(
	"chrome_tabGroups_get",
	"chrome",
	"Get a tab group",
	["tabGroups"],
	schemas.ChromeTabGroupsGetParamsSchema,
	schemas.ChromeTabGroupSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "groupId",
			type: "number",
			required: false,
			description: "Tab group ID",
		},
	],
);
registerChromePassthrough(
	"chrome_tabGroups_update",
	"chrome",
	"Update a tab group",
	["tabGroups"],
	schemas.ChromeTabGroupsUpdateParamsSchema,
	schemas.ChromeTabGroupSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "groupId",
			type: "number",
			required: false,
			description: "Tab group ID",
		},
		{
			name: "update",
			type: "object",
			required: false,
			description: "Update properties",
		},
	],
);
