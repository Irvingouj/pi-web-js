/// <reference types="chrome" />
import { z } from "zod";
import { registerChromePassthrough } from "../../chrome/internals.js";
import { zChromeVoid } from "./register-helpers.js";

registerChromePassthrough(
	"chrome_action_setBadgeText",
	"chrome",
	"Set badge text",
	["action"],
	zChromeVoid,
	"ECHROME",
	"extension",
	[],
	"chrome.action.setBadgeText({ text: \"1\" })"
);
registerChromePassthrough(
	"chrome_action_setBadgeBackgroundColor",
	"chrome",
	"Set badge background color",
	["action"],
	zChromeVoid,
	"ECHROME",
	"extension",
	[],
	"chrome.action.setBadgeBackgroundColor({ color: \"#FF0000\" })"
);
registerChromePassthrough(
	"chrome_action_setTitle",
	"chrome",
	"Set action title",
	["action"],
	zChromeVoid,
	"ECHROME",
	"extension",
	[],
	"chrome.action.setTitle({ title: \"My Extension\" })"
);
registerChromePassthrough(
	"chrome_action_setIcon",
	"chrome",
	"Set action icon",
	["action"],
	zChromeVoid,
	"ECHROME",
	"extension",
	[],
	"chrome.action.setIcon({ path: \"icon.png\" })"
);
registerChromePassthrough(
	"chrome_action_getBadgeText",
	"chrome",
	"Get badge text",
	["action"],
	z.string(),
	"ECHROME",
	"extension",
	[],
	"chrome.action.getBadgeText({})"
);
registerChromePassthrough(
	"chrome_action_openPopup",
	"chrome",
	"Open action popup",
	["action"],
	zChromeVoid,
	"ECHROME",
	"extension",
	[],
	"chrome.action.openPopup()"
);
registerChromePassthrough(
	"chrome_action_setPopup",
	"chrome",
	"Set action popup",
	["action"],
	zChromeVoid,
	"ECHROME",
	"extension",
	[],
	"chrome.action.setPopup({ popup: \"popup.html\" })"
);
