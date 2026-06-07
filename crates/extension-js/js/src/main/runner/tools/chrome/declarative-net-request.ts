/// <reference types="chrome" />
import { regChrome } from "./register-helpers.js";

regChrome(
	"chrome_declarativeNetRequest_getDynamicRules",
	["declarativeNetRequest"],
	"Get dynamic DNR rules",
);
regChrome(
	"chrome_declarativeNetRequest_getEnabledRulesets",
	["declarativeNetRequest"],
	"Get enabled DNR rulesets",
);
regChrome(
	"chrome_declarativeNetRequest_getSessionRules",
	["declarativeNetRequest"],
	"Get session DNR rules",
);
regChrome(
	"chrome_declarativeNetRequest_updateDynamicRules",
	["declarativeNetRequest"],
	"Update dynamic DNR rules",
);
regChrome(
	"chrome_declarativeNetRequest_updateEnabledRulesets",
	["declarativeNetRequest"],
	"Update enabled DNR rulesets",
);
regChrome(
	"chrome_declarativeNetRequest_updateSessionRules",
	["declarativeNetRequest"],
	"Update session DNR rules",
);
