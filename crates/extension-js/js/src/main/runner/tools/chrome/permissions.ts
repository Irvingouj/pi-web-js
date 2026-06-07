/// <reference types="chrome" />
import { regChrome, zChromeNull } from "./register-helpers.js";

regChrome("chrome_permissions_contains", ["permissions"], "Check permission");
regChrome("chrome_permissions_getAll", ["permissions"], "Get all permissions");
regChrome(
	"chrome_permissions_remove",
	["permissions"],
	"Remove permissions",
	zChromeNull,
);
regChrome(
	"chrome_permissions_request",
	["permissions"],
	"Request permissions",
	zChromeNull,
);
