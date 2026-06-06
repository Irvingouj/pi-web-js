/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";

registerChromePassthrough(
	"chrome_notifications_create",
	"chrome",
	"Create a notification",
	["notifications"],
	schemas.ChromeNotificationsCreateParamsSchema,
	schemas.ChromeNotificationIdSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "id",
			type: "string",
			required: false,
			description: "Notification ID",
		},
		{
			name: "options",
			type: "object",
			required: false,
			description: "Notification options",
		},
	],
	["id", "options"],
);
registerChromePassthrough(
	"chrome_notifications_clear",
	"chrome",
	"Clear a notification",
	["notifications"],
	schemas.ChromeNotificationsClearParamsSchema,
	schemas.ChromeNotificationClearSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "id",
			type: "string",
			required: false,
			description: "Notification ID to clear",
		},
	],
	["id"],
);
