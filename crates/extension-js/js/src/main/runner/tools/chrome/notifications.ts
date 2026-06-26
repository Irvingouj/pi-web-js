/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/cross/schemas.js";
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
			description: "Notification ID (literal)",
		},
		{
			name: "options",
			type: "{ type?: string, iconUrl?: string, title?: string, message?: string }",
			required: false,
			description: "Notification options (literal)",
		},
	],
	'chrome.notifications.create("notificationId", { type: "basic", title: "Hello", message: "World" })',
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
			description: "Notification ID to clear (literal)",
		},
	],
	'chrome.notifications.clear("notificationId")',
);
registerChromePassthrough(
	"chrome_notifications_getAll",
	"chrome",
	"Get all notifications",
	["notifications"],
	z.record(z.unknown()),
	"ECHROME",
	"extension",
	[],
	"chrome.notifications.getAll()",
	"{ [id: string]: NotificationOptions }",
);
registerChromePassthrough(
	"chrome_notifications_update",
	"chrome",
	"Update a notification",
	["notifications"],
	z.boolean(),
	"ECHROME",
	"extension",
	[],
	'chrome.notifications.update("notificationId", { title: "Updated" })',
);
