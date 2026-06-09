/// <reference types="chrome" />
import { z } from "zod";
import { registerJsCall } from "../../../../shared/tool-registry.js";
import {
	invokeNative,
	normalizeParityArgs,
	requireArgumentArray,
	resolveChromeMethod,
} from "../../chrome/native.js";
import { makeError } from "../../lib/types.js";
import { refreshCapabilities } from "./capability.js";
import { regChrome, zChromeAny, zChromeNull } from "./register-helpers.js";

async function invokePermissionsChrome(
	action: string,
	apiPath: string[],
	methodName: string,
	params: unknown,
): Promise<unknown> {
	const chrome = window.chrome;
	if (!chrome?.runtime?.id) {
		throw makeError(
			`${action} is only available in a browser extension context`,
			"E_NO_EXTENSION",
			"permission",
		);
	}
	const args = normalizeParityArgs(
		action,
		requireArgumentArray(params, action),
	);
	const method = resolveChromeMethod(chrome, apiPath, methodName);
	const result = await Promise.resolve(invokeNative(method, args));
	await refreshCapabilities();
	return result;
}

regChrome("chrome_permissions_contains", ["permissions"], "Check permission", zChromeAny, "chrome.permissions.contains({ permissions: [\"tabs\"] })", "boolean");
regChrome("chrome_permissions_getAll", ["permissions"], "Get all permissions", zChromeAny, "chrome.permissions.getAll()", "{ permissions: string[], origins: string[] }");

registerJsCall({
	action: "chrome_permissions_remove",
	namespace: "chrome.permissions",
	name: "remove",
	description: "Remove permissions",
	params: z.unknown(),
	returns: zChromeNull,
	owner: "main-thread",
	returnType: "boolean",
	handler: async (params: unknown) =>
		invokePermissionsChrome("chrome_permissions_remove", ["permissions"], "remove", params),
	paramTypes: [],
	returnDoc: "boolean",
	errorCode: "ECHROME",
	example: 'chrome.permissions.remove({ permissions: ["tabs"] })',
});

registerJsCall({
	action: "chrome_permissions_request",
	namespace: "chrome.permissions",
	name: "request",
	description: "Request permissions",
	params: z.unknown(),
	returns: zChromeNull,
	owner: "main-thread",
	returnType: "boolean",
	handler: async (params: unknown) =>
		invokePermissionsChrome("chrome_permissions_request", ["permissions"], "request", params),
	paramTypes: [],
	returnDoc: "boolean",
	errorCode: "ECHROME",
	example: 'chrome.permissions.request({ permissions: ["tabs"] })',
});
