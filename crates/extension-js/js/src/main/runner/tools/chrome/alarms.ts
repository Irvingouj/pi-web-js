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
			description: "Alarm name",
		},
		{
			name: "alarmInfo",
			type: "object",
			required: false,
			description: "Alarm info",
		},
	]
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
			description: "Alarm name to clear",
		},
	]
);
registerChromePassthrough(
	"chrome_alarms_clearAll",
	"chrome",
	"Clear all alarms",
	["alarms"],
	zChromeVoid,
	"ECHROME",
	"extension"
);
registerChromePassthrough(
	"chrome_alarms_getAll",
	"chrome",
	"Get all alarms",
	["alarms"],
	z.array(z.record(z.unknown())),
	"ECHROME",
	"extension"
);
