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

// ─── Host call ───────────────────────────────────────────────────

registerJsCall({
	action: "host_call",
	namespace: "host",
	name: "call",
	description: "Call a host handler",
	params: schemas.HostCallParamsSchema,
	returns: z.unknown(), // host handler result is arbitrary
	fields: ["action", "params"],
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const obj = asRecord(params);
		const action = obj.action as string;
		const actionParams = obj.params;
		return unwrapResult(await handleHostCallAction(action, actionParams));
	},
	paramTypes: [
		{
			name: "action",
			type: "string",
			required: true,
			description: "Host action name (literal)",
		},
		{
			name: "params",
			type: "object",
			required: false,
			description: "Parameters for the host action (literal)",
		},
	],
	returnDoc: "Handler result",
	errorCode: "ENOHANDLER",
	errorCategory: "host",

	example: "host.call([\"title\", \"url\"])",
});
