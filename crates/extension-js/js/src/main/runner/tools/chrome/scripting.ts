/// <reference types="chrome" />
import * as schemas from "../../../../shared/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";
import { zChromeAny } from "./register-helpers.js";

registerChromePassthrough(
	"chrome_scripting_executeScript",
	"chrome",
	"Execute a script",
	["scripting"],
	schemas.ChromeScriptResultSchema,
	"ECHROME",
	"extension"
);
registerChromePassthrough(
	"chrome_scripting_insertCSS",
	"chrome",
	"Insert CSS into a tab",
	["scripting"],
	zChromeAny,
	"ECHROME",
	"extension"
);
registerChromePassthrough(
	"chrome_scripting_removeCSS",
	"chrome",
	"Remove CSS from a tab",
	["scripting"],
	zChromeAny,
	"ECHROME",
	"extension"
);
