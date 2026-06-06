/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/schemas.js";
import { registerChromePassthrough } from "../../chrome/internals.js";

registerChromePassthrough(
	"chrome_downloads_download",
	"chrome",
	"Download a file",
	["downloads"],
	schemas.ChromeDownloadsDownloadParamsSchema,
	schemas.ChromeDownloadIdSchema,
	"ECHROME",
	"extension",
	[
		{
			name: "url",
			type: "string",
			required: false,
			description: "Download URL",
		},
	],
);
registerChromePassthrough(
	"chrome_downloads_search",
	"chrome",
	"Search downloads",
	["downloads"],
	schemas.ChromeDownloadsSearchParamsSchema,
	schemas.ChromeDownloadArraySchema,
	"ECHROME",
	"extension",
	[
		{
			name: "query",
			type: "object",
			required: false,
			description: "Download query",
		},
	],
);
registerChromePassthrough(
	"chrome_downloads_erase",
	"chrome",
	"Erase downloads",
	["downloads"],
	schemas.ChromeDownloadsEraseParamsSchema,
	schemas.ChromeDownloadArraySchema,
	"ECHROME",
	"extension",
	[
		{
			name: "query",
			type: "object",
			required: false,
			description: "Download query",
		},
	],
);
registerChromePassthrough(
	"chrome_downloads_pause",
	"chrome",
	"Pause a download",
	["downloads"],
	schemas.ChromeDownloadsPauseParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "downloadId",
			type: "number",
			required: false,
			description: "Download ID",
		},
	],
);
registerChromePassthrough(
	"chrome_downloads_resume",
	"chrome",
	"Resume a download",
	["downloads"],
	schemas.ChromeDownloadsResumeParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "downloadId",
			type: "number",
			required: false,
			description: "Download ID",
		},
	],
);
registerChromePassthrough(
	"chrome_downloads_cancel",
	"chrome",
	"Cancel a download",
	["downloads"],
	schemas.ChromeDownloadsCancelParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "downloadId",
			type: "number",
			required: false,
			description: "Download ID",
		},
	],
);
registerChromePassthrough(
	"chrome_downloads_open",
	"chrome",
	"Open a downloaded file",
	["downloads"],
	schemas.ChromeDownloadsOpenParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "downloadId",
			type: "number",
			required: false,
			description: "Download ID",
		},
	],
);
registerChromePassthrough(
	"chrome_downloads_show",
	"chrome",
	"Show a downloaded file",
	["downloads"],
	schemas.ChromeDownloadsShowParamsSchema,
	z.null(),
	"ECHROME",
	"extension",
	[
		{
			name: "downloadId",
			type: "number",
			required: false,
			description: "Download ID",
		},
	],
);
