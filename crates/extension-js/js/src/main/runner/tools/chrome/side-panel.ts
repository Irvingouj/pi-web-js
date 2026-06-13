import { registerChromePassthrough } from "../../chrome/internals.js";
import { zChromeVoid } from "./register-helpers.js";

registerChromePassthrough(
	"chrome_sidePanel_setOptions",
	"chrome",
	"Set sidepanel options",
	["sidePanel"],
	zChromeVoid,
	"ECHROME",
	"extension",
	[],
	'chrome.sidePanel.setOptions({ path: "sidepanel.html" })',
);
registerChromePassthrough(
	"chrome_sidePanel_setPanelBehavior",
	"chrome",
	"Set sidepanel behavior",
	["sidePanel"],
	zChromeVoid,
	"ECHROME",
	"extension",
	[],
	"chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })",
);
