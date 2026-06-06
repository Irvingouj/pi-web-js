/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";

registerChromePassthrough(
	"chrome_scripting_executeScript",
	"chrome",
	"Execute a script",
	["scripting"],
	schemas.ChromeScriptingExecuteScriptParamsSchema,
	schemas.ChromeScriptResultSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "target",
			type: "object",
			required: false,
			description: "Script target",
		},
		{
			name: "func",
			type: "string",
			required: false,
			description: "Function to execute",
		},
		{
			name: "args",
			type: "array",
			required: false,
			description: "Function arguments",
		},
	],
);
