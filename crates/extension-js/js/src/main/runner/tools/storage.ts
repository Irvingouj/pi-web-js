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

// ─── Storage ─────────────────────────────────────────────────────

registerJsCall({
	action: "storage_get",
	namespace: "storage",
	name: "get",
	description: "Get a value from localStorage",
	params: schemas.StorageGetParamsSchema,
	returns: z.string().nullable(),
	fields: ["key"],
	aliases: [{ namespace: "web.storage", name: "get", fields: ["key"] }],
	owner: "main-thread",
	handler: async (params, _ctx) => {
		return localStorage.getItem(params.key);
	},
	paramTypes: [
		{ name: "key", type: "string", required: true, description: "Storage key" },
	],
	returnDoc: "Stored value or null",
	errorCode: "ESTORAGE",
	errorCategory: "storage",
});

registerJsCall({
	action: "storage_set",
	namespace: "storage",
	name: "set",
	description: "Set a value in localStorage",
	params: schemas.StorageSetParamsSchema,
	returns: z.null(),
	fields: ["key", "value"],
	aliases: [{ namespace: "web.storage", name: "set", fields: ["key", "value"] }],
	owner: "main-thread",
	handler: async (params, _ctx) => {
		localStorage.setItem(params.key, params.value);
		return null;
	},
	paramTypes: [
		{ name: "key", type: "string", required: true, description: "Storage key" },
		{
			name: "value",
			type: "string",
			required: true,
			description: "Value to store",
		},
	],
	returnDoc: "null",
	errorCode: "ESTORAGE",
	errorCategory: "storage",
});

registerJsCall({
	action: "storage_delete",
	namespace: "storage",
	name: "delete",
	description: "Delete a key from localStorage",
	params: schemas.StorageDeleteParamsSchema,
	returns: z.null(),
	fields: ["key"],
	aliases: [{ namespace: "web.storage", name: "delete", fields: ["key"] }],
	owner: "main-thread",
	handler: async (params, _ctx) => {
		localStorage.removeItem(params.key);
		return null;
	},
	paramTypes: [
		{ name: "key", type: "string", required: true, description: "Storage key" },
	],
	returnDoc: "null",
	errorCode: "ESTORAGE",
	errorCategory: "storage",
});

registerJsCall({
	action: "storage_list",
	namespace: "storage",
	name: "list",
	description: "List all localStorage keys",
	params: schemas.StorageListParamsSchema,
	returns: z.array(z.string()),
	aliases: [{ namespace: "web.storage", name: "list" }],
	owner: "main-thread",
	handler: async (_params, _ctx) => {
		const keys: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key) keys.push(key);
		}
		return keys;
	},
	paramTypes: [],
	returnDoc: "Array of keys",
	errorCode: "ESTORAGE",
	errorCategory: "storage",
});

registerJsCall({
	action: "storage_set_many",
	namespace: "storage",
	name: "set_many",
	description: "Set multiple values in localStorage",
	params: schemas.StorageSetManyParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const itemRec = asRecord(params.items);
		for (const key of Object.keys(itemRec)) {
			const value = itemRec[key];
			localStorage.setItem(
				`__csl__:${key}`,
				value === null || value === undefined ? "null" : String(value),
			);
		}
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
	errorCode: "ESTORAGE",
	errorCategory: "storage",
});

registerJsCall({
	action: "storage_get_many",
	namespace: "storage",
	name: "get_many",
	description: "Get multiple values from localStorage",
	params: schemas.StorageGetManyParamsSchema,
	returns: z.record(z.string().nullable()),
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const keys = params.keys;
		const defaults = asRecord(params.defaults ?? {});
		const results: Record<string, string | null> = {};
		for (const key of keys) {
			const val = localStorage.getItem(`__csl__:${String(key)}`);
			results[String(key)] =
				val !== null ? val : ((defaults[String(key)] as string | null) ?? null);
		}
		return results;
	},
	paramTypes: [
		{
			name: "keys",
			type: "array",
			required: true,
			description: "Array of keys to retrieve",
		},
		{
			name: "defaults",
			type: "object",
			required: false,
			description: "Default values for missing keys",
		},
	],
	returnDoc: "Record of values",
	errorCode: "ESTORAGE",
	errorCategory: "storage",
});

registerJsCall({
	action: "storage_get_all",
	namespace: "storage",
	name: "get_all",
	description: "Get all __csl__ values from localStorage",
	params: schemas.StorageGetAllParamsSchema,
	returns: z.record(z.string().nullable()),
	owner: "main-thread",
	handler: async (_params, _ctx) => {
		const results: Record<string, string | null> = {};
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key?.startsWith("__csl__:")) {
				const shortKey = key.slice("__csl__:".length);
				results[shortKey] = localStorage.getItem(key);
			}
		}
		return results;
	},
	paramTypes: [],
	returnDoc: "Record of values",
	errorCode: "ESTORAGE",
	errorCategory: "storage",
});

registerJsCall({
	action: "storage_delete_many",
	namespace: "storage",
	name: "delete_many",
	description: "Delete multiple keys from localStorage",
	params: schemas.StorageDeleteManyParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const keys = params.keys;
		for (const key of keys) {
			localStorage.removeItem(`__csl__:${String(key)}`);
		}
		return null;
	},
	paramTypes: [
		{
			name: "keys",
			type: "array",
			required: true,
			description: "Array of keys to delete",
		},
	],
	returnDoc: "null",
	errorCode: "ESTORAGE",
	errorCategory: "storage",
});

registerJsCall({
	action: "storage_clear",
	namespace: "storage",
	name: "clear",
	description: "Clear all __csl__ keys from localStorage",
	params: schemas.StorageClearParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (_params, _ctx) => {
		const keysToRemove: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key?.startsWith("__csl__:")) {
				keysToRemove.push(key);
			}
		}
		for (const key of keysToRemove) {
			localStorage.removeItem(key);
		}
		return null;
	},
	paramTypes: [],
	returnDoc: "null",
	errorCode: "ESTORAGE",
	errorCategory: "storage",
});
