/// <reference types="chrome" />
import { z } from "zod";
import { logger } from "../../../shared/logger.js";
import * as schemas from "../../../shared/schemas.js";
import {
	dispatchTool,
	registerJsCall,
	type CallContext,
	type ToolDocParam,
} from "../../../shared/tool-registry.js";
import type { DomFormatParams, DomSnapshotParams, FetchParams } from "../runtime.js";
import {
	makeError,
	asRecord,
	extractTabId,
	unwrapResult,
	sendMessageToTab,
	getActiveTabId,
	resolveActiveTabId,
	executeInTab,
	waitForTabLoad,
	handleFetch,
	handleHostCallAction,
	registerChromePassthrough,
	getElementByRefId,
	extractRefId,
	handleDomSnapshot,
	handleDomFormat,
	ensureDomSnapshot,
	buildSnapshotInTab,
	throwIfAborted,
	DEFAULT_TIMEOUT_MS,
	DEFAULT_MAX_NODES,
	DEFAULT_SCROLL_AMOUNT,
	DEFAULT_POLL_INTERVAL_MS,
} from "../runtime.js";

// ─── Alias actions ───────────────────────────────────────────────

function registerAlias(
	action: string,
	target: string,
	description: string,
	returnsSchema: z.ZodSchema<unknown>,
	paramTypes: ToolDocParam[] = [],
): void {
	const parts = action.split("_");
	const name = parts[parts.length - 1];
	const category = parts.length > 1 ? parts[0] : "";
	const namespace = category ? `chrome.${category}` : "chrome";
	registerJsCall({
		action,
		namespace,
		name,
		description,
		params: z.record(z.unknown()),
		returns: returnsSchema,
		owner: "main-thread",
		handler: async (params, _ctx) => {
			const log = logger.child("alias");
			log.debug("alias_dispatch", { action, target });
			return unwrapResult(await dispatchTool(target, params));
		},
		paramTypes,
		returnDoc: "Alias result",
		errorCode: "ECHROME",
		errorCategory: "extension",
	});
}

registerAlias(
	"cookies_get",
	"chrome_cookies_get",
	"Get a cookie",
	schemas.ChromeCookieSchema,
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
registerAlias(
	"cookies_set",
	"chrome_cookies_set",
	"Set a cookie",
	schemas.ChromeCookieSchema,
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
registerAlias(
	"cookies_delete",
	"chrome_cookies_remove",
	"Remove a cookie",
	z.record(z.unknown()),
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
registerAlias(
	"cookies_list",
	"chrome_cookies_getAll",
	"Get all cookies",
	schemas.ChromeCookieArraySchema,
	[{ name: "url", type: "string", required: false, description: "Cookie URL" }],
);
registerAlias(
	"history_search",
	"chrome_history_search",
	"Search history",
	schemas.ChromeHistoryArraySchema,
	[
		{
			name: "text",
			type: "string",
			required: false,
			description: "Search text",
		},
		{
			name: "maxResults",
			type: "number",
			required: false,
			description: "Maximum results",
		},
	],
);
registerAlias(
	"history_delete",
	"chrome_history_deleteUrl",
	"Delete a URL from history",
	z.null(),
	[
		{
			name: "url",
			type: "string",
			required: false,
			description: "URL to delete from history",
		},
	],
);
registerAlias(
	"bookmarks_search",
	"chrome_bookmarks_search",
	"Search bookmarks",
	schemas.ChromeBookmarkArraySchema,
	[
		{
			name: "query",
			type: "string",
			required: false,
			description: "Search query",
		},
	],
);
registerAlias(
	"bookmarks_create",
	"chrome_bookmarks_create",
	"Create a bookmark",
	z.record(z.unknown()),
	[
		{
			name: "parentId",
			type: "string",
			required: false,
			description: "Parent folder ID",
		},
		{
			name: "title",
			type: "string",
			required: false,
			description: "Bookmark title",
		},
		{
			name: "url",
			type: "string",
			required: false,
			description: "Bookmark URL",
		},
	],
);
registerAlias(
	"bookmarks_delete",
	"chrome_bookmarks_remove",
	"Remove a bookmark",
	z.null(),
	[
		{
			name: "id",
			type: "string",
			required: false,
			description: "Bookmark ID to remove",
		},
	],
);
registerAlias(
	"notifications_create",
	"chrome_notifications_create",
	"Create a notification",
	schemas.ChromeNotificationIdSchema,
	[
		{
			name: "id",
			type: "string",
			required: false,
			description: "Notification ID",
		},
		{
			name: "options",
			type: "object",
			required: false,
			description: "Notification options",
		},
	],
);
registerAlias(
	"notifications_clear",
	"chrome_notifications_clear",
	"Clear a notification",
	schemas.ChromeNotificationClearSchema,
	[
		{
			name: "id",
			type: "string",
			required: false,
			description: "Notification ID to clear",
		},
	],
);
