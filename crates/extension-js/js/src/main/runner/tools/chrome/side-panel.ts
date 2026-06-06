/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";

registerChromePassthrough(
	"chrome_sidePanel_setOptions",
	"chrome",
	"Set sidepanel options",
	["sidePanel"],
	schemas.ChromeSidePanelSetOptionsParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "path",
			type: "string",
			required: false,
			description: "Panel path",
		},
		{
			name: "enabled",
			type: "boolean",
			required: false,
			description: "Whether enabled",
		},
	],
);
