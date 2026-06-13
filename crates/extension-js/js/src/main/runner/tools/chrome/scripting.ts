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
	"extension",
	[],
	"chrome.scripting.executeScript({ target: { tabId: 1 }, func: () => document.title })",
);
registerChromePassthrough(
	"chrome_scripting_insertCSS",
	"chrome",
	"Insert CSS into a tab",
	["scripting"],
	zChromeAny,
	"ECHROME",
	"extension",
	[],
	'chrome.scripting.insertCSS({ target: { tabId: 1 }, css: "body { color: red; }" })',
	"null",
);
registerChromePassthrough(
	"chrome_scripting_removeCSS",
	"chrome",
	"Remove CSS from a tab",
	["scripting"],
	zChromeAny,
	"ECHROME",
	"extension",
	[],
	'chrome.scripting.removeCSS({ target: { tabId: 1 }, css: "body { color: red; }" })',
	"null",
);
