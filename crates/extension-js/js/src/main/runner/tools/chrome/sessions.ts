/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";

registerChromePassthrough(
	"chrome_sessions_getRecentlyClosed",
	"chrome",
	"Get recently closed sessions",
	["sessions"],
	schemas.ChromeSessionArraySchema,
	"ECHROME",
	"extension",
	[],
	"chrome.sessions.getRecentlyClosed()"
);
registerChromePassthrough(
	"chrome_sessions_restore",
	"chrome",
	"Restore a session",
	["sessions"],
	schemas.ChromeSessionArraySchema,
	"ECHROME",
	"extension",
	[
		{
			name: "sessionId",
			type: "string",
			required: false,
			description: "Session ID (literal)",
		},
	],
	"chrome.sessions.restore(\"sessionId\")"
);
registerChromePassthrough(
	"chrome_sessions_getDevices",
	"chrome",
	"Get synced devices",
	["sessions"],
	schemas.ChromeDeviceArraySchema,
	"ECHROME",
	"extension",
	[],
	"chrome.sessions.getDevices()"
);
