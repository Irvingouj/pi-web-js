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

// ─── Network / Sleep ─────────────────────────────────────────────

registerJsCall({
	action: "fetch",
	namespace: "network",
	name: "fetch",
	description: "Make an HTTP request",
	params: schemas.FetchParamsSchema,
	returns: schemas.FetchValueSchema,
	fields: ["url"],
	aliases: [{ namespace: "web", name: "fetch", fields: ["url"] }],
	owner: "main-thread",
	handler: async (params, _ctx) => {
		const result = await handleFetch(params as FetchParams);
		return unwrapResult(result);
	},
	paramTypes: [
		{
			name: "url",
			type: "string",
			required: true,
			description: "URL to fetch",
		},
		{
			name: "method",
			type: "string",
			required: false,
			description: "HTTP method (GET, POST, etc.)",
		},
		{
			name: "headers",
			type: "object",
			required: false,
			description: "Request headers",
		},
		{
			name: "body",
			type: "string",
			required: false,
			description: "Request body",
		},
		{
			name: "timeout",
			type: "number",
			required: false,
			description: "Timeout in milliseconds",
		},
	],
	returnDoc: "Response object",
	errorCode: "E_UNKNOWN",
	errorCategory: "network",
});

registerJsCall({
	action: "sleep",
	namespace: "util",
	name: "sleep",
	description: "Sleep for a duration",
	params: schemas.SleepParamsSchema,
	returns: z.null(),
	fields: ["duration"],
	aliases: [{ namespace: "web", name: "sleep", fields: ["duration"] }],
	owner: "main-thread",
	handler: async (params, _ctx) => {
		await new Promise((resolve) =>
			setTimeout(resolve, Number(params.duration)),
		);
		return null;
	},
	paramTypes: [
		{
			name: "duration",
			type: "number",
			required: true,
			description: "Duration to sleep in milliseconds",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",
});

registerJsCall({
	action: "mock_async",
	namespace: "util",
	name: "mock_async",
	description: "Mock async call for testing",
	params: z.union([
		z.string(),
		z.object({ label: z.string().optional() }).passthrough(),
	]),
	returns: z.string(),
	owner: "main-thread",
	handler: async (params, _ctx) => {
		// prelude.js passes the argument directly:
		// web.mock_async('label') -> params = 'label' (string)
		// web.mock_async({label: 'x'}) -> params = {label: 'x'} (object)
		if (typeof params === "string") return params;
		if (params && typeof params === "object" && "label" in params) {
			return (
				((params as Record<string, unknown>).label as string) ?? "mock_async"
			);
		}
		return "mock_async";
	},
	paramTypes: [
		{
			name: "label",
			type: "string",
			required: false,
			description: "Test label",
		},
	],
	returnDoc: "Label string",
	errorCode: "E_UNKNOWN",
});
