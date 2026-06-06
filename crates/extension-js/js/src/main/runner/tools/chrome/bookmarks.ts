/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";

registerChromePassthrough(
	"chrome_bookmarks_search",
	"chrome",
	"Search bookmarks",
	["bookmarks"],
	schemas.ChromeBookmarksSearchParamsSchema,
	schemas.ChromeBookmarkArraySchema,
	"ECHROME",
	"extension",
	[
		{
			name: "query",
			type: "string",
			required: false,
			description: "Search query",
		},
	],
);
registerChromePassthrough(
	"chrome_bookmarks_create",
	"chrome",
	"Create a bookmark",
	["bookmarks"],
	schemas.ChromeBookmarksCreateParamsSchema,
	z.record(z.unknown()),
	"ECHROME",
	"extension",
	[
		{
			name: "parentId",
			type: "string",
			required: false,
			description: "Parent folder ID",
		},
		{
			name: "title",
			type: "string",
			required: false,
			description: "Bookmark title",
		},
		{
			name: "url",
			type: "string",
			required: false,
			description: "Bookmark URL",
		},
	],
);
registerChromePassthrough(
	"chrome_bookmarks_remove",
	"chrome",
	"Remove a bookmark",
	["bookmarks"],
	schemas.ChromeBookmarksRemoveParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "id",
			type: "string",
			required: false,
			description: "Bookmark ID to remove",
		},
	],
	["id"],
);
