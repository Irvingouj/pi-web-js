/// <reference types="chrome" />
import { z } from "zod";
import * as schemas from "../../../../shared/cross/schemas.js";
import { logger } from "../../../../shared/main/logger.js";
import {
	type CallContext,
	type ParamDetail,
	registerJsCall,
} from "../../../../shared/main/tool-registry.js";
import {
	registerChromePassthrough,
	toPlainObject,
} from "../../chrome/internals.js";
import {
	invokeNative,
	normalizeParityArgs,
	requireArgumentArray,
	resolveChromeMethod,
} from "../../chrome/native.js";
import { assertTabOwnership } from "../../chrome/tab-ownership.js";
import { makeError } from "../../lib/types.js";
import { checkPermission, manifestPermissionForApiPath } from "./capability.js";
import { zChromeAny } from "./register-helpers.js";

const EXECUTE_SCRIPT_API_PATH = ["scripting"];

/** Parsed executeScript injection spec — the first element of the parity args array. */
type ExecuteScriptSpec = {
	readonly func?: unknown;
	readonly files?: unknown;
	readonly [key: string]: unknown;
};

/** Result of the pure guard parser — either the spec is transportable, or it is not. */
type ExecuteScriptGuardResult =
	| { ok: true; spec: ExecuteScriptSpec }
	| { ok: false; error: ReturnType<typeof makeError> };

/**
 * Pure parser: examine the executeScript parity args and decide whether the
 * spec is transportable. No side effects, no throws — the caller decides.
 * `args` is the narrowed NativeArgs array from requireArgumentArray.
 */
/** Set param detail on a CodedError for structured error reporting. */
function withParam(
	err: ReturnType<typeof makeError>,
	path: string,
): ReturnType<typeof makeError> {
	(err as Error & { param?: ParamDetail }).param = { path };
	return err;
}
function parseExecuteScriptSpec(
	args: readonly unknown[],
): ExecuteScriptGuardResult {
	const spec = args[0];
	if (typeof spec !== "object" || spec === null) {
		return { ok: true, spec: {} };
	}
	const obj = spec as ExecuteScriptSpec;

	if ("func" in obj) {
		const err = makeError(
			'Functions cannot be transported from run_js (QuickJS cannot serialize function values across the native bridge). For MAIN-world injection use files: ["/path/in/extension/pkg.js"] with an extension-packaged path. For isolated-world DOM inspection use web.tab.evaluate(tabId, script). For active-tab snapshot data use page.snapshot_data().',
			"E_UNTRANSPORTABLE_PARAM",
			"transport",
			{
				hint: "Use web.tab.evaluate(tabId, scriptString) for isolated DOM reads, or chrome.scripting.executeScript with files: [...] referencing a file bundled in the extension package.",
				recovery: [
					"Call get_doc for web.tab.evaluate",
					"Package the function as a .js file under the extension web/dist/ and pass its path via files:",
				],
			},
		);
		return { ok: false, error: withParam(err, "func") };
	}

	if ("files" in obj) {
		const files = obj.files;
		const filesError = (message: string): ExecuteScriptGuardResult => ({
			ok: false,
			error: withParam(
				makeError(message, "E_UNTRANSPORTABLE_PARAM", "transport"),
				"files",
			),
		});
		if (!Array.isArray(files) || files.length === 0) {
			return filesError(
				"param 'files' must be a non-empty array of extension-packaged file paths (e.g. [\"/assets/injected.js\"]).",
			);
		}
		for (const f of files) {
			if (typeof f !== "string") {
				return filesError("param 'files' must contain only string paths.");
			}
			if (f.startsWith("/skills/") || f.startsWith("/opfs/")) {
				return filesError(
					`param 'files' path "${f}" is not extension-packaged. Chrome requires paths relative to the extension package (e.g. "/assets/injected.js"), not OPFS or skill paths.`,
				);
			}
		}
	}

	return { ok: true, spec: obj };
}

/** Impure wrapper: parse then throw if the guard rejects. */
function interceptExecuteScript(params: unknown): void {
	const args = requireArgumentArray(params, "chrome_scripting_executeScript");
	const guard = parseExecuteScriptSpec(args);
	if (!guard.ok) {
		throw guard.error;
	}
}

registerJsCall({
	action: "chrome_scripting_executeScript",
	namespace: "chrome.scripting",
	name: "executeScript",
	description:
		'Execute a script in a tab. Use files: ["/path/in/extension/pkg.js"] for MAIN-world injection, or web.tab.evaluate(tabId, script) for isolated-world DOM inspection.',
	params: z.unknown(),
	returns: schemas.ChromeScriptResultSchema,
	owner: "main-thread",
	handler: async (params: unknown, ctx: CallContext) => {
		const log = logger.child("chrome");
		const action = "chrome_scripting_executeScript";
		const apiPath = EXECUTE_SCRIPT_API_PATH;
		const name = "executeScript";
		const manifestPermission = manifestPermissionForApiPath(apiPath);

		interceptExecuteScript(params);

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
		// Per-window isolation: reject before Chrome invocation if the target
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
			const message = err instanceof Error ? err.message : String(err);
			log.debug("chrome_passthrough_err", { action, error: message });
			throw makeError(message, "ECHROME", "extension");
		}
	},
	paramTypes: [],
	returnDoc: "Chrome API result",
	errorCode: "ECHROME",
	errorCategory: "extension",
	example:
		'chrome.scripting.executeScript({ target: { tabId: 1 }, files: ["/assets/injected.js"] })',
});

registerChromePassthrough(
	"chrome_scripting_insertCSS",
	"chrome",
	"Insert CSS into a tab",
	["scripting"],
	zChromeAny,
	"ECHROME",
	"extension",
	[],
	'chrome.scripting.insertCSS({ target: { tabId: 1 }, css: "body { color: red; }" })',
	"null",
);
registerChromePassthrough(
	"chrome_scripting_removeCSS",
	"chrome",
	"Remove CSS from a tab",
	["scripting"],
	zChromeAny,
	"ECHROME",
	"extension",
	[],
	'chrome.scripting.removeCSS({ target: { tabId: 1 }, css: "body { color: red; }" })',
	"null",
);
