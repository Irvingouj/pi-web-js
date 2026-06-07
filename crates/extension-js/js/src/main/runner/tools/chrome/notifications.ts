/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";

registerChromePassthrough(
	"chrome_notifications_create",
	"chrome",
	"Create a notification",
	["notifications"],
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
	]
);
registerChromePassthrough(
	"chrome_notifications_clear",
	"chrome",
	"Clear a notification",
	["notifications"],
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
	]
);
registerChromePassthrough(
	"chrome_notifications_getAll",
	"chrome",
	"Get all notifications",
	["notifications"],
	z.record(z.unknown()),
	"ECHROME",
	"extension"
);
registerChromePassthrough(
	"chrome_notifications_update",
	"chrome",
	"Update a notification",
	["notifications"],
	z.boolean(),
	"ECHROME",
	"extension"
);
