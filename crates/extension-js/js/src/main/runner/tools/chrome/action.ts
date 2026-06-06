/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";

registerChromePassthrough(
	"chrome_action_setBadgeText",
	"chrome",
	"Set badge text",
	["action"],
	schemas.ChromeActionSetBadgeTextParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "text",
			type: "string",
			required: false,
			description: "Badge text",
		},
		{ name: "tabId", type: "number", required: false, description: "Tab ID" },
	],
);
registerChromePassthrough(
	"chrome_action_setBadgeBackgroundColor",
	"chrome",
	"Set badge background color",
	["action"],
	schemas.ChromeActionSetBadgeBackgroundColorParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "color",
			type: "string",
			required: false,
			description: "Badge color",
		},
		{ name: "tabId", type: "number", required: false, description: "Tab ID" },
	],
);
registerChromePassthrough(
	"chrome_action_setTitle",
	"chrome",
	"Set action title",
	["action"],
	schemas.ChromeActionSetTitleParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "title",
			type: "string",
			required: false,
			description: "Action title",
		},
		{ name: "tabId", type: "number", required: false, description: "Tab ID" },
	],
);
registerChromePassthrough(
	"chrome_action_setIcon",
	"chrome",
	"Set action icon",
	["action"],
	schemas.ChromeActionSetIconParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{ name: "path", type: "string", required: false, description: "Icon path" },
		{ name: "tabId", type: "number", required: false, description: "Tab ID" },
	],
);
