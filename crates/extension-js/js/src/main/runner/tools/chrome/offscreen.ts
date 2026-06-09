/// <reference types="chrome" />
import { regChrome, zChromeAny, zChromeNull } from "./register-helpers.js";

regChrome(
	"chrome_offscreen_closeDocument",
	["offscreen"],
	"Close offscreen document",
	zChromeNull,
	"chrome.offscreen.closeDocument()",
	"null",
);
regChrome(
	"chrome_offscreen_createDocument",
	["offscreen"],
	"Create offscreen document",
	zChromeAny,
	"chrome.offscreen.createDocument({ url: \"offscreen.html\", reasons: [\"WORKERS\"] })",
	"null",
);
