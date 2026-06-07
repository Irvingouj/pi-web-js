/// <reference types="chrome" />
import { regChrome, zChromeNull } from "./register-helpers.js";

regChrome("chrome_management_get", ["management"], "Get extension info");
regChrome("chrome_management_getAll", ["management"], "Get all extensions");
regChrome(
	"chrome_management_setEnabled",
	["management"],
	"Enable or disable extension",
	zChromeNull,
);
regChrome(
	"chrome_management_uninstall",
	["management"],
	"Uninstall extension",
	zChromeNull,
);
