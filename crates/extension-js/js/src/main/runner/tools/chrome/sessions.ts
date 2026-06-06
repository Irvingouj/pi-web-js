/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";

registerChromePassthrough(
	"chrome_sessions_getRecentlyClosed",
	"chrome",
	"Get recently closed sessions",
	["sessions"],
	schemas.ChromeSessionsGetRecentlyClosedParamsSchema,
	schemas.ChromeSessionArraySchema,
	"ECHROME",
	"extension",
	[
		{
			name: "filter",
			type: "object",
			required: false,
			description: "Session filter",
		},
	],
);
registerChromePassthrough(
	"chrome_sessions_restore",
	"chrome",
	"Restore a session",
	["sessions"],
	schemas.ChromeSessionsRestoreParamsSchema,
	schemas.ChromeSessionArraySchema,
	"ECHROME",
	"extension",
	[
		{
			name: "sessionId",
			type: "string",
			required: false,
			description: "Session ID",
		},
	],
	["sessionId"],
);
registerChromePassthrough(
	"chrome_sessions_getDevices",
	"chrome",
	"Get synced devices",
	["sessions"],
	schemas.ChromeSessionsGetDevicesParamsSchema,
	schemas.ChromeDeviceArraySchema,
	"ECHROME",
	"extension",
	[
		{
			name: "filter",
			type: "object",
			required: false,
			description: "Device filter",
		},
	],
);
