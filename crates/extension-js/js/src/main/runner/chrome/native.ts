import { makeError } from "../lib/types.js";

export type NativeArgs = readonly unknown[];

/** Chrome parity aliases that forward opaque argument arrays to chrome_* targets. */
const NATIVE_PARITY_ALIASES = new Set([
	"bookmarks_search",
	"bookmarks_create",
	"bookmarks_delete",
	"history_search",
	"history_delete",
	"cookies_get",
	"cookies_set",
	"cookies_delete",
	"cookies_list",
	"notifications_create",
	"notifications_clear",
]);

export function isNativeParityAction(action: string): boolean {
	return action.startsWith("chrome_") || NATIVE_PARITY_ALIASES.has(action);
}

export function invokeNative(
	method: (...args: unknown[]) => unknown,
	args: NativeArgs,
): unknown {
	return method(...args);
}

/** Chrome query/search APIs require a first argument; no-arg JS calls become `{}`. */
const CHROME_QUERY_ACTIONS = new Set([
	"chrome_bookmarks_search",
	"bookmarks_search",
	"chrome_history_search",
	"history_search",
	"chrome_downloads_search",
	"chrome_tabs_query",
	"tab_query",
]);

export function normalizeParityArgs(
	action: string,
	args: NativeArgs,
): NativeArgs {
	if (args.length > 0) return args;
	if (CHROME_QUERY_ACTIONS.has(action)) return [{}];
	return args;
}

export function requireArgumentArray(
	value: unknown,
	action: string,
): NativeArgs {
	if (!Array.isArray(value)) {
		throw makeError(
			`Native-parity action ${action} requires an argument array`,
			"E_INVALID_ARGUMENT_TRANSPORT",
			"validation",
		);
	}
	return value;
}

export function resolveChromeMethod(
	chromeRoot: unknown,
	apiPath: string[],
	methodName: string,
): (...args: unknown[]) => unknown {
	let api: unknown = chromeRoot;
	for (const part of apiPath) {
		api = (api as Record<string, unknown>)[part];
		if (api == null) {
			throw makeError(
				`Chrome API path not found: ${apiPath.join(".")}`,
				"E_EXTENSION",
				"extension",
			);
		}
	}
	const method = (api as Record<string, unknown>)[methodName];
	if (typeof method !== "function") {
		throw makeError(
			`Chrome method not found: ${methodName}`,
			"E_EXTENSION",
			"extension",
		);
	}
	return method.bind(api) as (...args: unknown[]) => unknown;
}
