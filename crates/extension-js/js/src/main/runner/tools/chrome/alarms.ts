/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";

registerChromePassthrough(
	"chrome_alarms_create",
	"chrome",
	"Create an alarm",
	["alarms"],
	schemas.ChromeAlarmsCreateParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "name",
			type: "string",
			required: false,
			description: "Alarm name",
		},
		{
			name: "alarmInfo",
			type: "object",
			required: false,
			description: "Alarm info",
		},
	],
	["name", "alarmInfo"],
);
registerChromePassthrough(
	"chrome_alarms_clear",
	"chrome",
	"Clear an alarm",
	["alarms"],
	schemas.ChromeAlarmsClearParamsSchema,
	schemas.ChromeAlarmsClearSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "name",
			type: "string",
			required: false,
			description: "Alarm name to clear",
		},
	],
	["name"],
);
