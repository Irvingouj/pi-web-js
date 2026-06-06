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

// ─── Page snapshot ───────────────────────────────────────────────

registerJsCall({
	action: "page_snapshot",
	namespace: "page",
	name: "snapshot",
	description: "Capture full DOM snapshot",
	params: schemas.PageSnapshotParamsSchema,
	returns: z.string(),
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
		const obj = asRecord(params);
		const opts = asRecord(obj.options ?? obj);
		const maxNodes =
			typeof opts.max_nodes === "number" ? opts.max_nodes : DEFAULT_MAX_NODES;
		const result = await executeInTab(activeTab, buildSnapshotInTab, [
			maxNodes,
		]);
		if (!result.ok) {
			throw makeError(
				result.error.message,
				result.error.code,
				result.error.category,
			);
		}
		if (result.value && typeof result.value === "object") {
			const val = result.value as Record<string, unknown>;
			return val.text as string;
		}
		throw makeError("Failed to get page snapshot", "E_SNAPSHOT");
	},
	paramTypes: [
		{
			name: "max_nodes",
			type: "number",
			required: false,
			description: "Maximum nodes to include",
		},
		{
			name: "options",
			type: "object",
			required: false,
			description: "Snapshot options",
		},
	],
	returnDoc: "Snapshot text",
	errorCode: "E_SNAPSHOT",
});

registerJsCall({
	action: "page_snapshot_text",
	namespace: "page",
	name: "snapshot_text",
	description: "Capture DOM snapshot and return text representation",
	params: schemas.PageSnapshotTextParamsSchema,
	returns: z.string(),
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
		const obj = asRecord(params);
		const opts = asRecord(obj.options ?? obj);
		const maxNodes =
			typeof opts.max_nodes === "number" ? opts.max_nodes : DEFAULT_MAX_NODES;
		const result = await executeInTab(activeTab, buildSnapshotInTab, [
			maxNodes,
		]);
		if (!result.ok) {
			throw makeError(
				result.error.message,
				result.error.code,
				result.error.category,
			);
		}
		if (result.value && typeof result.value === "object") {
			const val = result.value as Record<string, unknown>;
			return val.text as string;
		}
		throw makeError("Failed to get page snapshot", "E_SNAPSHOT");
	},
	paramTypes: [
		{
			name: "max_nodes",
			type: "number",
			required: false,
			description: "Maximum nodes to include",
		},
		{
			name: "options",
			type: "object",
			required: false,
			description: "Snapshot options",
		},
	],
	returnDoc: "Snapshot text",
	errorCode: "E_SNAPSHOT",
});

registerJsCall({
	action: "page_snapshot_data",
	namespace: "page",
	name: "snapshot_data",
	description: "Get page snapshot data",
	params: schemas.PageSnapshotDataParamsSchema,
	returns: schemas.SnapshotResultSchema,
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const activeTab = await resolveActiveTabId();
		if (activeTab === null) {
			throw makeError("No active tab", "E_NO_TAB");
		}
		const obj = asRecord(params);
		const opts = asRecord(obj.options ?? obj);
		const maxNodes =
			typeof opts.max_nodes === "number" ? opts.max_nodes : DEFAULT_MAX_NODES;
		const result = await executeInTab(activeTab, buildSnapshotInTab, [
			maxNodes,
		]);
		if (!result.ok) {
			throw makeError(
				result.error.message,
				result.error.code,
				result.error.category,
			);
		}
		if (result.value && typeof result.value === "object") {
			return result.value;
		}
		throw makeError("Failed to get page snapshot", "E_SNAPSHOT");
	},
	paramTypes: [
		{
			name: "max_nodes",
			type: "number",
			required: false,
			description: "Maximum nodes to include",
		},
		{
			name: "options",
			type: "object",
			required: false,
			description: "Snapshot options",
		},
	],
	returnDoc: "Snapshot data",
	errorCode: "E_SNAPSHOT",
});
