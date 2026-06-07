/// <reference types="chrome" />
import { regChrome, zChromeNull } from "./register-helpers.js";

regChrome(
	"chrome_offscreen_closeDocument",
	["offscreen"],
	"Close offscreen document",
	zChromeNull,
);
regChrome(
	"chrome_offscreen_createDocument",
	["offscreen"],
	"Create offscreen document",
);
