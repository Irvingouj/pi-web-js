/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";
import { zChromeVoid } from "./register-helpers.js";

registerChromePassthrough(
	"chrome_alarms_create",
	"chrome",
	"Create an alarm",
	["alarms"],
	zChromeVoid,
	"ECHROME",
	"extension",
	[
		{
			name: "name",
			type: "string",
			required: false,
			description: "Alarm name (literal)",
		},
		{
			name: "alarmInfo",
			type: "{ when?: number, delayInMinutes?: number, periodInMinutes?: number }",
			required: false,
			description: "Alarm info (literal)",
		},
	],
	'chrome.alarms.create("myAlarm", { delayInMinutes: 5 })',
);
registerChromePassthrough(
	"chrome_alarms_clear",
	"chrome",
	"Clear an alarm",
	["alarms"],
	schemas.ChromeAlarmsClearSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "name",
			type: "string",
			required: false,
			description: "Alarm name to clear (literal)",
		},
	],
	'chrome.alarms.clear("myAlarm")',
);
registerChromePassthrough(
	"chrome_alarms_clearAll",
	"chrome",
	"Clear all alarms",
	["alarms"],
	zChromeVoid,
	"ECHROME",
	"extension",
	[],
	"chrome.alarms.clearAll()",
);
registerChromePassthrough(
	"chrome_alarms_getAll",
	"chrome",
	"Get all alarms",
	["alarms"],
	z.array(
		z
			.object({
				name: z.string().optional(),
				periodInMinutes: z.number().optional(),
				scheduledTime: z.number().optional(),
			})
			.passthrough(),
	),
	"ECHROME",
	"extension",
	[],
	"chrome.alarms.getAll()",
);
