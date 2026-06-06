/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";

registerChromePassthrough(
	"chrome_history_search",
	"chrome",
	"Search history",
	["history"],
	schemas.ChromeHistorySearchParamsSchema,
	schemas.ChromeHistoryArraySchema,
	"ECHROME",
	"extension",
	[
		{
			name: "text",
			type: "string",
			required: false,
			description: "Search text",
		},
		{
			name: "maxResults",
			type: "number",
			required: false,
			description: "Maximum results",
		},
	],
);
registerChromePassthrough(
	"chrome_history_deleteUrl",
	"chrome",
	"Delete a URL from history",
	["history"],
	schemas.ChromeHistoryDeleteUrlParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "url",
			type: "string",
			required: false,
			description: "URL to delete from history",
		},
	],
	["url"],
);
