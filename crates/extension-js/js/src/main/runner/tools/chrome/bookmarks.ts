/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";
import { zChromeVoid } from "./register-helpers.js";

registerChromePassthrough(
	"chrome_bookmarks_search",
	"chrome",
	"Search bookmarks",
	["bookmarks"],
	schemas.ChromeBookmarkArraySchema,
	"ECHROME",
	"extension"
);
registerChromePassthrough(
	"chrome_bookmarks_create",
	"chrome",
	"Create a bookmark",
	["bookmarks"],
	z.record(z.unknown()),
	"ECHROME",
	"extension"
);
registerChromePassthrough(
	"chrome_bookmarks_remove",
	"chrome",
	"Remove a bookmark",
	["bookmarks"],
	zChromeVoid,
	"ECHROME",
	"extension",
	[
		{
			name: "id",
			type: "string",
			required: false,
			description: "Bookmark ID to remove",
		},
	]
);
registerChromePassthrough(
	"chrome_bookmarks_get",
	"chrome",
	"Get bookmarks by ID",
	["bookmarks"],
	schemas.ChromeBookmarkArraySchema,
	"ECHROME",
	"extension"
);
registerChromePassthrough(
	"chrome_bookmarks_getChildren",
	"chrome",
	"Get bookmark children",
	["bookmarks"],
	schemas.ChromeBookmarkArraySchema,
	"ECHROME",
	"extension"
);
registerChromePassthrough(
	"chrome_bookmarks_getTree",
	"chrome",
	"Get bookmark tree",
	["bookmarks"],
	schemas.ChromeBookmarkArraySchema,
	"ECHROME",
	"extension"
);
registerChromePassthrough(
	"chrome_bookmarks_move",
	"chrome",
	"Move a bookmark",
	["bookmarks"],
	z.record(z.unknown()),
	"ECHROME",
	"extension"
);
registerChromePassthrough(
	"chrome_bookmarks_removeTree",
	"chrome",
	"Remove a bookmark tree",
	["bookmarks"],
	zChromeVoid,
	"ECHROME",
	"extension"
);
registerChromePassthrough(
	"chrome_bookmarks_update",
	"chrome",
	"Update a bookmark",
	["bookmarks"],
	z.record(z.unknown()),
	"ECHROME",
	"extension"
);
