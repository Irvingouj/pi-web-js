/// <reference types="chrome" />
import { regChrome } from "./register-helpers.js";

regChrome(
	"chrome_desktopCapture_chooseDesktopMedia",
	["desktopCapture"],
	"Choose desktop media",
);
regChrome(
	"chrome_desktopCapture_cancelChooseDesktopMedia",
	["desktopCapture"],
	"Cancel desktop media picker",
);
