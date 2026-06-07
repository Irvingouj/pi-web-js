/// <reference types="chrome" />
import { regChrome, zChromeAny } from "./register-helpers.js";

regChrome(
	"chrome_pageCapture_saveAsMHTML",
	["pageCapture"],
	"Save page as MHTML",
	zChromeAny,
	"chrome.pageCapture.saveAsMHTML({ tabId: 123 })",
);
