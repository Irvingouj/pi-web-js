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

// ─── DOM ─────────────────────────────────────────────────────────

registerJsCall({
	action: "dom_snapshot",
	namespace: "dom",
	name: "snapshot",
	description: "Take a DOM snapshot",
	params: schemas.DomSnapshotParamsSchema,
	returns: schemas.DomSnapshotValueSchema,
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const result = await handleDomSnapshot(params as DomSnapshotParams);
		if (!result.ok) {
			throw makeError(
				result.error.message,
				result.error.code,
				result.error.category,
			);
		}
		return unwrapResult(result);
	},
	paramTypes: [
		{
			name: "interactive_only",
			type: "boolean",
			required: false,
			description: "Only include interactive elements",
		},
		{
			name: "max_nodes",
			type: "number",
			required: false,
			description: "Maximum nodes to include",
		},
	],
	returnDoc: "Snapshot data",
	errorCode: "E_SNAPSHOT",
});

registerJsCall({
	action: "dom_format",
	namespace: "dom",
	name: "format",
	description: "Format a DOM snapshot",
	params: schemas.DomFormatParamsSchema,
	returns: z.string(),
	owner: "main-thread",
	handler: async (params, _ctx) => {
		return unwrapResult(await handleDomFormat(params as DomFormatParams));
	},
	paramTypes: [
		{
			name: "snapshot",
			type: "object",
			required: true,
			description: "DOM snapshot data",
		},
		{
			name: "format",
			type: "string",
			required: false,
			description: "Output format (compact-text, json, json-pretty)",
		},
	],
	returnDoc: "Formatted snapshot",
	errorCode: "E_FORMAT",
});
