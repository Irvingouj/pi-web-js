/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";

registerChromePassthrough(
	"chrome_runtime_sendMessage",
	"chrome",
	"Send a runtime message",
	["runtime"],
	z.unknown(),
	"ECHROME",
	"extension",
	[],
	"chrome.runtime.sendMessage({ greeting: \"hello\" })",
	"message response",
);
registerChromePassthrough(
	"chrome_runtime_connect",
	"chrome",
	"Connect to extension runtime",
	["runtime"],
	z.record(z.unknown()),
	"ECHROME",
	"extension",
	[],
	"chrome.runtime.connect({ name: \"myPort\" })",
	"Port",
);
registerChromePassthrough(
	"chrome_runtime_getURL",
	"chrome",
	"Get extension resource URL",
	["runtime"],
	z.string(),
	"ECHROME",
	"extension",
	[],
	"chrome.runtime.getURL(\"page.html\")"
);
registerChromePassthrough(
	"chrome_runtime_getManifest",
	"chrome",
	"Get extension manifest",
	["runtime"],
	z.record(z.unknown()),
	"ECHROME",
	"extension",
	[],
	"chrome.runtime.getManifest()",
	"Manifest",
);
