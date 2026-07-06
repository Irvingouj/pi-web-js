/// <reference types="chrome" />
import { z } from "zod";
import { logger } from "../../../shared/main/logger.js";
import type { AsyncError } from "../../../shared/main/tool-registry.js";
import {
	type CallContext,
	registerJsCall,
	type ToolDocParam,
} from "../../../shared/main/tool-registry.js";
import { makeError } from "../lib/types.js";
import {
	checkPermission,
	manifestPermissionForApiPath,
} from "../tools/chrome/capability.js";
import {
	invokeNative,
	normalizeParityArgs,
	requireArgumentArray,
	resolveChromeMethod,
} from "./native.js";
import { assertTabOwnership } from "./tab-ownership.js";

export {
	invokeNative,
	isNativeParityAction,
	type NativeArgs,
	normalizeParityArgs,
	requireArgumentArray,
	resolveChromeMethod,
} from "./native.js";

export function normalizeChromeError(err: unknown): {
	ok: false;
	error: AsyncError;
} {
	const msg = (err instanceof Error ? err.message : String(err)) || "";
	if (msg.includes("permission") || msg.includes("Permission")) {
		return {
			ok: false,
			error: {
				message: msg,
				code: "E_PERMISSION",
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

export function toPlainObject(value: unknown): unknown {
	if (value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map(toPlainObject);
	// Chrome runtime/tabs Port objects expose postMessage; serialize a minimal stub.
	if (typeof (value as { postMessage?: unknown }).postMessage === "function") {
		const port = value as { name?: string; sender?: unknown };
		return {
			name: port.name ?? "",
			connected: true,
			sender: port.sender ? toPlainObject(port.sender) : null,
		};
	}
	const plain: Record<string, unknown> = {};
	for (const key of Object.keys(value as Record<string, unknown>)) {
		const v = (value as Record<string, unknown>)[key];
		if (typeof v !== "function") {
			plain[key] = toPlainObject(v);
		}
	}
	return plain;
}

export function registerChromePassthrough(
	action: string,
	_namespace: string,
	description: string,
	apiPath: string[],
	returnsSchema: z.ZodSchema<unknown>,
	errorCode: string,
	errorCategory: string | undefined,
	paramTypes: ToolDocParam[] = [],
	example?: string,
	returnType?: string,
): void {
	const name = chromeMethodName(action);
	const namespace =
		apiPath.length > 0 ? `chrome.${apiPath.join(".")}` : _namespace;
	const manifestPermission = manifestPermissionForApiPath(apiPath);
	registerJsCall({
		action,
		namespace,
		name,
		description,
		params: z.unknown(),
		returns: returnsSchema,
		owner: "main-thread",
		permission: manifestPermission ?? undefined,
		returnType: returnType ?? undefined,
		handler: async (params: unknown, ctx: CallContext) => {
			const log = logger.child("chrome");
			const chrome = window.chrome;
			if (!chrome?.runtime?.id) {
				throw makeError(
					`${action} is only available in a browser extension context`,
					"E_NO_EXTENSION",
					"permission",
				);
			}
			checkPermission(action, manifestPermission);
			const args = normalizeParityArgs(
				action,
				requireArgumentArray(params, action),
			);
			// Per-window isolation: reject before Chrome invocation if any target
			// tab belongs to another window. No-op when windowId is unknown.
			await assertTabOwnership(action, args, ctx.windowId, chrome);
			const method = resolveChromeMethod(chrome, apiPath, name);
			log.debug("chrome_passthrough", { action, argCount: args.length });

			try {
				const result = await invokeNative(method, args);
				log.debug("chrome_passthrough_ok", { action });
				const plain = toPlainObject(result);
				return plain === undefined ? null : plain;
			} catch (err: unknown) {
				if (
					typeof err === "object" &&
					err !== null &&
					"code" in err &&
					err.code === "E_INVALID_ARGUMENT_TRANSPORT"
				) {
					throw err;
				}
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
		example,
	});
}

function chromeMethodName(action: string): string {
	const name = action.split("_").at(-1);
	if (!name) {
		throw new Error(`Cannot derive Chrome method name from action "${action}"`);
	}
	return name;
}
