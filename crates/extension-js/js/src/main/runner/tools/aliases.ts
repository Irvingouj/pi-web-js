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
	requireArgumentArray,
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
import {
	checkPermission,
	permissionFromChromeAction,
} from "./chrome/capability.js";

// ─── Alias actions ───────────────────────────────────────────────

function normalizeAliasArgs(action: string, args: readonly unknown[]): unknown[] {
	if (args.length === 1 && typeof args[0] === "string") {
		switch (action) {
			case "history_delete":
				return [{ url: args[0] }];
			case "bookmarks_search":
				return [{ query: args[0] }];
			case "bookmarks_delete":
			case "notifications_clear":
				return [args[0]];
			default:
				break;
		}
	}
	if (
		action === "notifications_create" &&
		args.length === 1 &&
		args[0] !== null &&
		typeof args[0] === "object" &&
		!Array.isArray(args[0])
	) {
		const obj = args[0] as Record<string, unknown>;
		if ("options" in obj) {
			return [obj.id ?? "", obj.options];
		}
	}
	return [...args];
}

function registerAlias(
	action: string,
	target: string,
	description: string,
	returnsSchema: z.ZodSchema<unknown>,
	paramTypes: ToolDocParam[] = [],
	example?: string,
): void {
	const parts = action.split("_");
	const name = parts[parts.length - 1];
	const category = parts.length > 1 ? parts[0] : "";
	const namespace = category ? `web.${category}` : "web";
	const manifestPermission = permissionFromChromeAction(target);
	registerJsCall({
		action,
		namespace,
		name,
		description,
		params: z.unknown(),
		returns: returnsSchema,
		owner: "main-thread",
		permission: manifestPermission ?? undefined,
		handler: async (params, _ctx) => {
			const log = logger.child("alias");
			checkPermission(action, manifestPermission);
			const args = normalizeAliasArgs(
				action,
				requireArgumentArray(params, action),
			);
			log.debug("alias_dispatch", { action, target, argCount: args.length });
			return unwrapResult(await dispatchTool(target, args));
		},
		paramTypes,
		returnDoc: "Alias result",
		errorCode: "ECHROME",
		errorCategory: "extension",
		example,
	});
}

registerAlias(
	"cookies_get",
	"chrome_cookies_get",
	"Get a cookie",
	schemas.ChromeCookieSchema,
	[
		{ name: "url", type: "string", required: false, description: "Cookie URL (url)" },
		{
			name: "name",
			type: "string",
			required: false,
			description: "Cookie name (literal)",
		},
	],
	"web.cookies.get({ url: \"https://example.com\", name: \"session\" })",
);
registerAlias(
	"cookies_set",
	"chrome_cookies_set",
	"Set a cookie",
	schemas.ChromeCookieSchema,
	[
		{ name: "url", type: "string", required: false, description: "Cookie URL (url)" },
		{
			name: "name",
			type: "string",
			required: false,
			description: "Cookie name (literal)",
		},
		{
			name: "value",
			type: "string",
			required: false,
			description: "Cookie value (literal)",
		},
	],
	"web.cookies.set({ url: \"https://example.com\", name: \"session\", value: \"abc\" })",
);
registerAlias(
	"cookies_delete",
	"chrome_cookies_remove",
	"Remove a cookie",
	z.record(z.unknown()),
	[
		{ name: "url", type: "string", required: false, description: "Cookie URL (url)" },
		{
			name: "name",
			type: "string",
			required: false,
			description: "Cookie name (literal)",
		},
	],
	"web.cookies.delete({ url: \"https://example.com\", name: \"session\" })",
);
registerAlias(
	"cookies_list",
	"chrome_cookies_getAll",
	"Get all cookies",
	schemas.ChromeCookieArraySchema,
	[{ name: "url", type: "string", required: false, description: "Cookie URL (url)" }],
	"web.cookies.list({ url: \"https://example.com\" })",
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
			description: "Search text (literal)",
		},
		{
			name: "maxResults",
			type: "number",
			required: false,
			description: "Maximum results (literal)",
		},
	],
	"web.history.search({ text: \"example\", maxResults: 10 })",
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
			description: "URL to delete from history (url)",
		},
	],
	"web.history.delete(\"https://example.com\")",
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
			description: "Search query (literal)",
		},
	],
	"web.bookmarks.search(\"example\")",
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
			description: "Parent folder ID (literal)",
		},
		{
			name: "title",
			type: "string",
			required: false,
			description: "Bookmark title (literal)",
		},
		{
			name: "url",
			type: "string",
			required: false,
			description: "Bookmark URL (url)",
		},
	],
	"web.bookmarks.create({ title: \"Example\", url: \"https://example.com\" })",
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
			description: "Bookmark ID to remove (literal)",
		},
	],
	"web.bookmarks.delete(\"bookmarkId\")",
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
			description: "Notification ID (literal)",
		},
		{
			name: "options",
			type: "object",
			required: false,
			description: "Notification options (literal)",
		},
	],
	"web.notifications.create({ id: \"test\", options: { type: \"basic\", title: \"Hello\", message: \"World\" } })",
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
			description: "Notification ID to clear (literal)",
		},
	],
	"web.notifications.clear(\"test\")",
);
