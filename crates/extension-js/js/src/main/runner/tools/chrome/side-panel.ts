/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";
import { zChromeVoid } from "./register-helpers.js";

registerChromePassthrough(
	"chrome_sidePanel_setOptions",
	"chrome",
	"Set sidepanel options",
	["sidePanel"],
	zChromeVoid,
	"ECHROME",
	"extension"
);
registerChromePassthrough(
	"chrome_sidePanel_setPanelBehavior",
	"chrome",
	"Set sidepanel behavior",
	["sidePanel"],
	zChromeVoid,
	"ECHROME",
	"extension"
);
