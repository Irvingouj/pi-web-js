/// <reference types="chrome" />
import { regChrome, zChromeAny, zChromeNull } from "./register-helpers.js";

regChrome("chrome_management_get", ["management"], "Get extension info", zChromeAny, "chrome.management.get(\"extensionId\")");
regChrome("chrome_management_getAll", ["management"], "Get all extensions", zChromeAny, "chrome.management.getAll()");
regChrome(
	"chrome_management_setEnabled",
	["management"],
	"Enable or disable extension",
	zChromeNull,
	"chrome.management.setEnabled(\"extensionId\", true)",
);
regChrome(
	"chrome_management_uninstall",
	["management"],
	"Uninstall extension",
	zChromeNull,
	"chrome.management.uninstall(\"extensionId\")",
);
