/// <reference types="chrome" />
import { z } from "zod";
import { logger } from "../../../shared/logger.js";
import {
	registerJsCall,
	type CallContext,
	type ToolDocParam,
} from "../../../shared/tool-registry.js";
import type { AsyncError } from "../../../shared/tool-registry.js";
import { asRecord } from "../lib/params.js";
import { makeError } from "../lib/types.js";

export function normalizeChromeError(err: unknown): { ok: false; error: AsyncError } {
	const msg = (err instanceof Error ? err.message : String(err)) || "";
	if (msg.includes("permission") || msg.includes("Permission")) {
		return {
			ok: false,
			error: {
				message: msg,
				code: "E_PERMISSION_DENIED",
				category: "permission",
			},
		};
	}
	if (
		msg.includes("not found") ||
		msg.includes("No tab") ||
		msg.includes("No window")
	) {
		return {
			ok: false,
			error: { message: msg, code: "E_NOT_FOUND", category: "resource" },
		};
	}
	return {
		ok: false,
		error: { message: msg, code: "E_EXTENSION", category: "extension" },
	};
}

// ─── Chrome API dispatcher ─────────────────────────────────────

function toPlainObject(value: unknown): unknown {
	if (value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map(toPlainObject);
	const plain: Record<string, unknown> = {};
	for (const key of Object.keys(value as Record<string, unknown>)) {
		const v = (value as Record<string, unknown>)[key];
		if (typeof v !== "function") {
			plain[key] = toPlainObject(v);
		}
	}
	return plain;
}

// ─── Chrome passthrough dispatch table ─────────────────────────

type ChromeApiCaller = (
	api: unknown,
	firstRec: Record<string, unknown>,
	first: unknown,
	second: unknown,
) => Promise<unknown>;

const chromePassthroughHandlers = new Map<string, ChromeApiCaller>([
	[
		"chrome_tabs_update",
		async (api, firstRec, first, second) => {
			const tabId = firstRec.tabId || first;
			const updateProps = firstRec.update || second || {};
			if (typeof tabId === "number") {
				return (api as typeof chrome.tabs).update(
					tabId,
					updateProps as chrome.tabs.UpdateProperties,
				);
			}
			return (api as typeof chrome.tabs).update(
				updateProps as chrome.tabs.UpdateProperties,
			);
		},
	],
	[
		"chrome_tabs_remove",
		async (api, firstRec, first) => {
			const tabIds = firstRec.tabIds || firstRec.tabId || firstRec.id || first;
			if (typeof tabIds === "number") {
				await (api as typeof chrome.tabs).remove(tabIds);
			} else {
				await (api as typeof chrome.tabs).remove(tabIds as number[]);
			}
			return null;
		},
	],
	[
		"chrome_tabs_get",
		async (api, firstRec, first) => {
			const tabId = firstRec.tabId || firstRec.id || first;
			return (api as typeof chrome.tabs).get(tabId as number);
		},
	],
	[
		"chrome_tabs_reload",
		async (api, firstRec, first, second) => {
			const tabId = firstRec.tabId || first;
			const reloadProps = firstRec.reload || second || {};
			if (typeof tabId === "number") {
				await (api as typeof chrome.tabs).reload(
					tabId,
					reloadProps as chrome.tabs.ReloadProperties,
				);
			} else {
				await (api as typeof chrome.tabs).reload(
					reloadProps as chrome.tabs.ReloadProperties,
				);
			}
			return null;
		},
	],
	[
		"chrome_tabs_sendMessage",
		async (api, firstRec, first, second) => {
			const tabId = firstRec.tabId || first;
			const message = firstRec.message || second || {};
			return (api as typeof chrome.tabs).sendMessage(tabId as number, message);
		},
	],
	[
		"chrome_alarms_create",
		async (api, firstRec, first, second) => {
			const name =
				firstRec.name || (typeof first === "string" ? first : "") || "";
			const alarmInfo = firstRec.alarmInfo || second || firstRec || {};
			await (api as typeof chrome.alarms).create(name as string, alarmInfo);
			return null;
		},
	],
	[
		"chrome_alarms_clear",
		async (api, firstRec, first) => {
			const alarmName =
				firstRec.name || (typeof first === "string" ? first : "") || "";
			return (api as typeof chrome.alarms).clear(alarmName as string);
		},
	],
	[
		"chrome_action_setBadgeText",
		async (api, firstRec) => {
			await (api as typeof chrome.action).setBadgeText(
				(firstRec || {}) as chrome.action.BadgeTextDetails,
			);
			return null;
		},
	],
	[
		"chrome_action_setBadgeBackgroundColor",
		async (api, _firstRec, first) => {
			await (api as typeof chrome.action).setBadgeBackgroundColor(
				first as chrome.action.BadgeColorDetails,
			);
			return null;
		},
	],
	[
		"chrome_action_setTitle",
		async (api, _firstRec, first) => {
			await (api as typeof chrome.action).setTitle(
				first as chrome.action.TitleDetails,
			);
			return null;
		},
	],
	[
		"chrome_action_setIcon",
		async (api, firstRec) => {
			return (api as typeof chrome.action).setIcon(
				(firstRec || {}) as chrome.action.TabIconDetails,
			);
		},
	],
	[
		"chrome_contextMenus_remove",
		async (api, firstRec, first) => {
			const menuId = firstRec.menuItemId || firstRec.id || first;
			await (api as typeof chrome.contextMenus).remove(
				menuId as string | number,
			);
			return null;
		},
	],
	[
		"chrome_windows_update",
		async (api, firstRec, first, second) => {
			const windowId = firstRec.windowId || first;
			const updateInfo = firstRec.update || second || {};
			return (api as typeof chrome.windows).update(
				windowId as number,
				updateInfo as chrome.windows.UpdateInfo,
			);
		},
	],
	[
		"chrome_windows_remove",
		async (api, firstRec, first) => {
			const windowId = firstRec.windowId || first;
			await (api as typeof chrome.windows).remove(windowId as number);
			return null;
		},
	],
	[
		"chrome_cookies_get",
		async (api, _firstRec, first) => {
			return (api as typeof chrome.cookies).get(
				first as chrome.cookies.CookieDetails,
			);
		},
	],
	[
		"chrome_cookies_set",
		async (api, _firstRec, first) => {
			return (api as typeof chrome.cookies).set(
				first as chrome.cookies.SetDetails,
			);
		},
	],
	[
		"chrome_cookies_remove",
		async (api, _firstRec, first) => {
			return (api as typeof chrome.cookies).remove(
				first as chrome.cookies.CookieDetails,
			);
		},
	],
	[
		"chrome_cookies_getAll",
		async (api, firstRec) => {
			return (api as typeof chrome.cookies).getAll(
				(firstRec || {}) as chrome.cookies.GetAllDetails,
			);
		},
	],
	[
		"chrome_bookmarks_search",
		async (api, firstRec, first) => {
			const query =
				firstRec.query || (typeof first === "string" ? first : "") || "";
			return (api as typeof chrome.bookmarks).search(query as string);
		},
	],
	[
		"chrome_bookmarks_remove",
		async (api, firstRec, first) => {
			const bookmarkId = firstRec.id || first;
			await (api as typeof chrome.bookmarks).remove(bookmarkId as string);
			return null;
		},
	],
	[
		"chrome_history_search",
		async (api, _firstRec, first) => {
			return (api as typeof chrome.history).search(
				first as chrome.history.HistoryQuery,
			);
		},
	],
	[
		"chrome_history_deleteUrl",
		async (api, firstRec, first) => {
			await (api as typeof chrome.history).deleteUrl({
				url: (firstRec.url || first) as string,
			} as chrome.history.UrlDetails);
			return null;
		},
	],
	[
		"chrome_notifications_create",
		async (api, firstRec, first, second) => {
			const notifId =
				firstRec.id || (typeof first === "string" ? first : "") || "";
			const options = firstRec.options || second || {};
			return (api as typeof chrome.notifications).create(
				notifId as string,
				options as chrome.notifications.NotificationCreateOptions,
			);
		},
	],
	[
		"chrome_notifications_clear",
		async (api, firstRec, first) => {
			const notifId =
				firstRec.id || (typeof first === "string" ? first : "") || "";
			return (api as typeof chrome.notifications).clear(notifId as string);
		},
	],
	[
		"chrome_tabGroups_get",
		async (api, firstRec, first) => {
			const groupId = firstRec.groupId || first;
			return (api as typeof chrome.tabGroups).get(groupId as number);
		},
	],
	[
		"chrome_tabGroups_update",
		async (api, firstRec, first, second) => {
			const groupId = firstRec.groupId || first;
			const updateProps = firstRec.update || second || {};
			return (api as typeof chrome.tabGroups).update(
				groupId as number,
				updateProps as chrome.tabGroups.UpdateProperties,
			);
		},
	],
	[
		"chrome_tabs_ungroup",
		async (api, firstRec, first) => {
			const tabIds = firstRec.tabIds || firstRec.tabId || first;
			if (typeof tabIds === "number") {
				(api as typeof chrome.tabs).ungroup(tabIds);
			} else {
				(api as typeof chrome.tabs).ungroup(
					tabIds as number | [number, ...number[]],
				);
			}
			return null;
		},
	],
	[
		"chrome_sessions_restore",
		async (api, firstRec, first) => {
			return (api as typeof chrome.sessions).restore(
				(firstRec.sessionId || first || undefined) as string | undefined,
			);
		},
	],
	[
		"chrome_downloads_pause",
		async (api, firstRec, first) => {
			(api as typeof chrome.downloads).pause(
				(firstRec.downloadId || first) as number,
			);
			return null;
		},
	],
	[
		"chrome_downloads_resume",
		async (api, firstRec, first) => {
			(api as typeof chrome.downloads).resume(
				(firstRec.downloadId || first) as number,
			);
			return null;
		},
	],
	[
		"chrome_downloads_cancel",
		async (api, firstRec, first) => {
			(api as typeof chrome.downloads).cancel(
				(firstRec.downloadId || first) as number,
			);
			return null;
		},
	],
	[
		"chrome_downloads_open",
		async (api, firstRec, first) => {
			(api as typeof chrome.downloads).open(
				(firstRec.downloadId || first) as number,
			);
			return null;
		},
	],
	[
		"chrome_downloads_show",
		async (api, firstRec, first) => {
			(api as typeof chrome.downloads).show(
				(firstRec.downloadId || first) as number,
			);
			return null;
		},
	],
	[
		"chrome_system_cpu_getInfo",
		async (api) => {
			return (api as typeof chrome.system.cpu).getInfo();
		},
	],
	[
		"chrome_system_memory_getInfo",
		async (api) => {
			return (api as typeof chrome.system.memory).getInfo();
		},
	],
	[
		"chrome_system_storage_getInfo",
		async (api) => {
			return (api as typeof chrome.system.storage).getInfo();
		},
	],
]);

// ─── Tool registrations ────────────────────────────────────────

export function registerChromePassthrough(
	action: string,
	namespace: string,
	description: string,
	apiPath: string[],
	paramsSchema: z.ZodSchema<unknown>,
	returnsSchema: z.ZodSchema<unknown>,
	errorCode: string,
	errorCategory: string | undefined,
	paramTypes: ToolDocParam[],
	fields?: string[],
): void {
	const name = chromeActionName(action);
	registerJsCall({
		action,
		namespace,
		name,
		description,
		params: paramsSchema,
		returns: returnsSchema,
		fields,
		owner: "main-thread",
		handler: async (params: unknown, _ctx: CallContext) => {
			const log = logger.child("chrome");
			const chrome = window.chrome;
			if (!chrome?.runtime?.id) {
				throw makeError(
					`${action} is only available in a browser extension context`,
					"E_NO_EXTENSION",
					"permission",
				);
			}
			let api: unknown = chrome;
			for (const part of apiPath) {
				api = (api as Record<string, unknown>)[part];
			}
			const first = Array.isArray(params) ? params[0] : params;
			const firstRec = asRecord(first);
			const second = Array.isArray(params) ? params[1] : undefined;
			log.debug("chrome_passthrough", {
				action,
				params: Object.keys(firstRec),
			});

			try {
				const handler = chromePassthroughHandlers.get(action);
				let result: unknown;
				if (handler) {
					result = await handler(api, firstRec, first, second);
				} else {
					const method = (api as Record<string, unknown>)[
						action.split("_").pop()!
					] as (...args: unknown[]) => Promise<unknown>;
					result = await (method as (...args: unknown[]) => Promise<unknown>)(
						firstRec || {},
					);
				}
				log.debug("chrome_passthrough_ok", { action });
				return toPlainObject(result);
			} catch (err: unknown) {
				const normalized = normalizeChromeError(err);
				log.debug("chrome_passthrough_err", {
					action,
					error: normalized.error.message,
				});
				throw makeError(
					normalized.error.message,
					normalized.error.code,
					normalized.error.category,
				);
			}
		},
		paramTypes,
		returnDoc: "Chrome API result",
		errorCode,
		errorCategory,
	});
}

function chromeActionName(action: string): string {
	const name = action.startsWith("chrome_")
		? action.slice("chrome_".length)
		: action.split("_").at(-1);
	if (!name) {
		throw new Error(`Cannot derive Chrome API name from action "${action}"`);
	}
	return name;
}
