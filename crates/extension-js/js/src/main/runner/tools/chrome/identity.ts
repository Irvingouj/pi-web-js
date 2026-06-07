/// <reference types="chrome" />
import { regChrome } from "./register-helpers.js";

regChrome("chrome_identity_getAuthToken", ["identity"], "Get OAuth auth token");
regChrome(
	"chrome_identity_getProfileUserInfo",
	["identity"],
	"Get profile user info",
);
regChrome(
	"chrome_identity_launchWebAuthFlow",
	["identity"],
	"Launch web auth flow",
);
