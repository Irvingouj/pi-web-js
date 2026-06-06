/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";

registerChromePassthrough(
	"chrome_runtime_sendMessage",
	"chrome",
	"Send a runtime message",
	["runtime"],
	schemas.ChromeRuntimeSendMessageParamsSchema,
	z.unknown(),
	"ECHROME",
	"extension",
	[
		{
			name: "message",
			type: "object",
			required: false,
			description: "Message to send",
		},
	],
);
