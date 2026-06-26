import * as schemas from "../../../../shared/cross/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";
import { zChromeVoid } from "./register-helpers.js";

registerChromePassthrough(
	"chrome_downloads_download",
	"chrome",
	"Download a file",
	["downloads"],
	schemas.ChromeDownloadIdSchema,
	"ECHROME",
	"extension",
	[],
	'chrome.downloads.download({ url: "https://example.com/file.zip" })',
);
registerChromePassthrough(
	"chrome_downloads_search",
	"chrome",
	"Search downloads",
	["downloads"],
	schemas.ChromeDownloadArraySchema,
	"ECHROME",
	"extension",
	[],
	"chrome.downloads.search({})",
);
registerChromePassthrough(
	"chrome_downloads_erase",
	"chrome",
	"Erase downloads",
	["downloads"],
	schemas.ChromeDownloadArraySchema,
	"ECHROME",
	"extension",
	[],
	"chrome.downloads.erase({ ids: [1] })",
);
registerChromePassthrough(
	"chrome_downloads_pause",
	"chrome",
	"Pause a download",
	["downloads"],
	zChromeVoid,
	"ECHROME",
	"extension",
	[],
	"chrome.downloads.pause(1)",
);
registerChromePassthrough(
	"chrome_downloads_resume",
	"chrome",
	"Resume a download",
	["downloads"],
	zChromeVoid,
	"ECHROME",
	"extension",
	[],
	"chrome.downloads.resume(1)",
);
registerChromePassthrough(
	"chrome_downloads_cancel",
	"chrome",
	"Cancel a download",
	["downloads"],
	zChromeVoid,
	"ECHROME",
	"extension",
	[],
	"chrome.downloads.cancel(1)",
);
registerChromePassthrough(
	"chrome_downloads_open",
	"chrome",
	"Open a downloaded file",
	["downloads"],
	zChromeVoid,
	"ECHROME",
	"extension",
	[],
	"chrome.downloads.open(1)",
);
registerChromePassthrough(
	"chrome_downloads_show",
	"chrome",
	"Show a downloaded file",
	["downloads"],
	zChromeVoid,
	"ECHROME",
	"extension",
	[],
	"chrome.downloads.show(1)",
);
registerChromePassthrough(
	"chrome_downloads_removeFile",
	"chrome",
	"Remove download file",
	["downloads"],
	zChromeVoid,
	"ECHROME",
	"extension",
	[],
	"chrome.downloads.removeFile(1)",
);
