/// <reference types="chrome" />
import { regChrome, zChromeAny } from "./register-helpers.js";

regChrome("chrome_identity_getAuthToken", ["identity"], "Get OAuth auth token", zChromeAny, "chrome.identity.getAuthToken({ interactive: true })");
regChrome(
	"chrome_identity_getProfileUserInfo",
	["identity"],
	"Get profile user info",
	zChromeAny,
	"chrome.identity.getProfileUserInfo()",
);
regChrome(
	"chrome_identity_launchWebAuthFlow",
	["identity"],
	"Launch web auth flow",
	zChromeAny,
	"chrome.identity.launchWebAuthFlow({ url: \"https://example.com/auth\" })",
);
