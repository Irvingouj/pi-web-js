/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/schemas.js";
import { registerJsCall } from "../../../../shared/tool-registry.js";
import { asRecord } from "../../lib/params.js";
import { makeError } from "../../lib/types.js";
import { registerChromePassthrough } from "../../chrome/internals.js";

registerJsCall({
	action: "chrome_windows_getCurrent",
	namespace: "chrome.windows",
	name: "getCurrent",
	description: "Get the current window",
	params: schemas.ChromeWindowsGetAllParamsSchema,
	returns: schemas.ChromeWindowSchema,
	owner: "main-thread",
	handler: async (params, _ctx) => {
		if (!chrome?.runtime?.id) {
			throw makeError(
				"chrome.windows.getCurrent is only available in a browser extension context",
				"E_NO_EXTENSION",
				"permission",
			);
		}
		const first = Array.isArray(params) ? params[0] : params;
		const query = asRecord(first ?? {});
		const window = await chrome.windows.getCurrent(
			query as chrome.windows.QueryOptions,
		);
		return { ...window } as Record<string, unknown>;
	},
	paramTypes: [
		{
			name: "populate",
			type: "boolean",
			required: false,
			description: "Whether to populate tab info",
		},
	],
	returnDoc: "Current window object",
	errorCode: "ECHROME",
	errorCategory: "extension",
});

registerChromePassthrough(
	"chrome_windows_getAll",
	"chrome",
	"Get all windows",
	["windows"],
	schemas.ChromeWindowsGetAllParamsSchema,
	schemas.ChromeWindowArraySchema,
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
	"chrome_windows_create",
	"chrome",
	"Create a window",
	["windows"],
	schemas.ChromeWindowsCreateParamsSchema,
	schemas.ChromeWindowSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "url",
			type: "string",
			required: false,
			description: "URL to open",
		},
		{
			name: "type",
			type: "string",
			required: false,
			description: "Window type",
		},
	],
);
registerChromePassthrough(
	"chrome_windows_update",
	"chrome",
	"Update a window",
	["windows"],
	schemas.ChromeWindowsUpdateParamsSchema,
	schemas.ChromeWindowSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "windowId",
			type: "number",
			required: false,
			description: "Window ID",
		},
		{
			name: "updateInfo",
			type: "object",
			required: false,
			description: "Update info",
		},
	],
);
registerChromePassthrough(
	"chrome_windows_remove",
	"chrome",
	"Remove a window",
	["windows"],
	schemas.ChromeWindowsRemoveParamsSchema,
	z.null(),
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
	["windowId"],
);
