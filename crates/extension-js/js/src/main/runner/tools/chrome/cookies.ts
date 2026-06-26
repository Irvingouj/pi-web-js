/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/cross/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";

registerChromePassthrough(
	"chrome_cookies_get",
	"chrome",
	"Get a cookie",
	["cookies"],
	schemas.ChromeCookieSchema,
	"ECHROME",
	"extension",
	[],
	'chrome.cookies.get({ url: "https://example.com", name: "session" })',
);
registerChromePassthrough(
	"chrome_cookies_set",
	"chrome",
	"Set a cookie",
	["cookies"],
	schemas.ChromeCookieSchema,
	"ECHROME",
	"extension",
	[],
	'chrome.cookies.set({ url: "https://example.com", name: "session", value: "abc" })',
);
registerChromePassthrough(
	"chrome_cookies_remove",
	"chrome",
	"Remove a cookie",
	["cookies"],
	z.record(z.unknown()),
	"ECHROME",
	"extension",
	[],
	'chrome.cookies.remove({ url: "https://example.com", name: "session" })',
);
registerChromePassthrough(
	"chrome_cookies_getAll",
	"chrome",
	"Get all cookies",
	["cookies"],
	schemas.ChromeCookieArraySchema,
	"ECHROME",
	"extension",
	[],
	'chrome.cookies.getAll({ url: "https://example.com" })',
);
