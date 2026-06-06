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

// ─── Chrome extension storage ────────────────────────────────────

registerJsCall({
	action: "chrome_storage_local_set",
	namespace: "chrome.storage.local",
	name: "set",
	description: "Set extension local storage values",
	params: z.object({ items: z.record(z.unknown()) }),
	returns: z.null(),
	fields: ["items"],
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const chrome = window.chrome;
		if (!chrome?.runtime?.id) {
			throw makeError(
				"chrome.storage.local is only available in a browser extension context",
				"E_NO_EXTENSION",
				"permission",
			);
		}
		await chrome.storage.local.set(params.items);
		return null;
	},
	paramTypes: [
		{
			name: "items",
			type: "object",
			required: true,
			description: "Record of key-value pairs to set",
		},
	],
	returnDoc: "null",
	errorCode: "ECHROME",
	errorCategory: "extension",
});

registerJsCall({
	action: "chrome_storage_local_get",
	namespace: "chrome.storage.local",
	name: "get",
	description: "Get extension local storage values",
	params: z.object({
		keys: z.union([z.string(), z.array(z.string())]).optional(),
	}),
	returns: z.record(z.unknown()),
	fields: ["keys"],
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const chrome = window.chrome;
		if (!chrome?.runtime?.id) {
			throw makeError(
				"chrome.storage.local is only available in a browser extension context",
				"E_NO_EXTENSION",
				"permission",
			);
		}
		return chrome.storage.local.get(params.keys);
	},
	paramTypes: [
		{
			name: "keys",
			type: "union",
			required: false,
			description: "Key or array of keys to get",
		},
	],
	returnDoc: "Record of values",
	errorCode: "ECHROME",
	errorCategory: "extension",
});

registerJsCall({
	action: "chrome_storage_local_remove",
	namespace: "chrome.storage.local",
	name: "remove",
	description: "Remove extension local storage values",
	params: z.object({
		keys: z.union([z.string(), z.array(z.string())]),
	}),
	returns: z.null(),
	fields: ["keys"],
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const chrome = window.chrome;
		if (!chrome?.runtime?.id) {
			throw makeError(
				"chrome.storage.local is only available in a browser extension context",
				"E_NO_EXTENSION",
				"permission",
			);
		}
		await chrome.storage.local.remove(params.keys);
		return null;
	},
	paramTypes: [
		{
			name: "keys",
			type: "union",
			required: true,
			description: "Key or array of keys to remove",
		},
	],
	returnDoc: "null",
	errorCode: "ECHROME",
	errorCategory: "extension",
});

registerJsCall({
	action: "chrome_storage_local_clear",
	namespace: "chrome.storage.local",
	name: "clear",
	description: "Clear all extension local storage",
	params: z.object({}),
	returns: z.null(),
	owner: "main-thread",
	handler: async (_params, _ctx) => {
		const chrome = window.chrome;
		if (!chrome?.runtime?.id) {
			throw makeError(
				"chrome.storage.local is only available in a browser extension context",
				"E_NO_EXTENSION",
				"permission",
			);
		}
		await chrome.storage.local.clear();
		return null;
	},
	paramTypes: [],
	returnDoc: "null",
	errorCode: "ECHROME",
	errorCategory: "extension",
});
