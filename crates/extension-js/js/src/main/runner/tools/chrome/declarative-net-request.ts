/// <reference types="chrome" />
import { regChrome, zChromeAny } from "./register-helpers.js";

regChrome(
	"chrome_declarativeNetRequest_getDynamicRules",
	["declarativeNetRequest"],
	"Get dynamic DNR rules",
	zChromeAny,
	"chrome.declarativeNetRequest.getDynamicRules()",
	"Rule[]",
);
regChrome(
	"chrome_declarativeNetRequest_getEnabledRulesets",
	["declarativeNetRequest"],
	"Get enabled DNR rulesets",
	zChromeAny,
	"chrome.declarativeNetRequest.getEnabledRulesets()",
	"RulesetInfo[]",
);
regChrome(
	"chrome_declarativeNetRequest_getSessionRules",
	["declarativeNetRequest"],
	"Get session DNR rules",
	zChromeAny,
	"chrome.declarativeNetRequest.getSessionRules()",
	"Rule[]",
);
regChrome(
	"chrome_declarativeNetRequest_updateDynamicRules",
	["declarativeNetRequest"],
	"Update dynamic DNR rules",
	zChromeAny,
	"chrome.declarativeNetRequest.updateDynamicRules({ addRules: [] })",
	"null",
);
regChrome(
	"chrome_declarativeNetRequest_updateEnabledRulesets",
	["declarativeNetRequest"],
	"Update enabled DNR rulesets",
	zChromeAny,
	"chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: [] })",
	"null",
);
regChrome(
	"chrome_declarativeNetRequest_updateSessionRules",
	["declarativeNetRequest"],
	"Update session DNR rules",
	zChromeAny,
	"chrome.declarativeNetRequest.updateSessionRules({ addRules: [] })",
	"null",
);
