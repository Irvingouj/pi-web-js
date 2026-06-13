/// <reference types="chrome" />
import { regChrome, zChromeAny } from "./register-helpers.js";

regChrome(
	"chrome_idle_queryState",
	["idle"],
	"Query idle state",
	zChromeAny,
	"chrome.idle.queryState(60)",
	'"active" | "idle" | "locked"',
);
