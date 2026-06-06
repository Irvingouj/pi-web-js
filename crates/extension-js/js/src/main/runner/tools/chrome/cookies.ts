/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";

registerChromePassthrough(
	"chrome_cookies_get",
	"chrome",
	"Get a cookie",
	["cookies"],
	schemas.ChromeCookiesGetParamsSchema,
	schemas.ChromeCookieSchema,
	"ECHROME",
	"extension",
	[
		{ name: "url", type: "string", required: false, description: "Cookie URL" },
		{
			name: "name",
			type: "string",
			required: false,
			description: "Cookie name",
		},
	],
);
registerChromePassthrough(
	"chrome_cookies_set",
	"chrome",
	"Set a cookie",
	["cookies"],
	schemas.ChromeCookiesSetParamsSchema,
	schemas.ChromeCookieSchema,
	"ECHROME",
	"extension",
	[
		{ name: "url", type: "string", required: false, description: "Cookie URL" },
		{
			name: "name",
			type: "string",
			required: false,
			description: "Cookie name",
		},
		{
			name: "value",
			type: "string",
			required: false,
			description: "Cookie value",
		},
	],
);
registerChromePassthrough(
	"chrome_cookies_remove",
	"chrome",
	"Remove a cookie",
	["cookies"],
	schemas.ChromeCookiesRemoveParamsSchema,
	z.record(z.unknown()),
	"ECHROME",
	"extension",
	[
		{ name: "url", type: "string", required: false, description: "Cookie URL" },
		{
			name: "name",
			type: "string",
			required: false,
			description: "Cookie name",
		},
	],
);
registerChromePassthrough(
	"chrome_cookies_getAll",
	"chrome",
	"Get all cookies",
	["cookies"],
	schemas.ChromeCookiesGetAllParamsSchema,
	schemas.ChromeCookieArraySchema,
	"ECHROME",
	"extension",
	[{ name: "url", type: "string", required: false, description: "Cookie URL" }],
);
