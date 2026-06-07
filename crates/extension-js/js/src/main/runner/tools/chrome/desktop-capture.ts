/// <reference types="chrome" />
import { regChrome, zChromeAny } from "./register-helpers.js";

regChrome(
	"chrome_desktopCapture_chooseDesktopMedia",
	["desktopCapture"],
	"Choose desktop media",
	zChromeAny,
	"chrome.desktopCapture.chooseDesktopMedia([\"screen\"], (id) => id)",
);
regChrome(
	"chrome_desktopCapture_cancelChooseDesktopMedia",
	["desktopCapture"],
	"Cancel desktop media picker",
	zChromeAny,
	"chrome.desktopCapture.cancelChooseDesktopMedia(123)",
);
