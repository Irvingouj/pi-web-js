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

// ─── Clipboard ───────────────────────────────────────────────────

registerJsCall({
	action: "clipboard_read",
	namespace: "clipboard",
	name: "read",
	description: "Read text from clipboard",
	params: schemas.ClipboardReadParamsSchema,
	returns: z.string(),
	aliases: [{ namespace: "web.clipboard", name: "read" }],
	owner: "main-thread",
	handler: async (_params, _ctx) => {
		return navigator.clipboard.readText();
	},
	paramTypes: [],
	returnDoc: "Clipboard text",
	errorCode: "ECLIPBOARD",
	errorCategory: "permission",
});

registerJsCall({
	action: "clipboard_write",
	namespace: "clipboard",
	name: "write",
	description: "Write text to clipboard",
	params: schemas.ClipboardWriteParamsSchema,
	returns: z.null(),
	aliases: [{ namespace: "web.clipboard", name: "write", fields: ["text"] }],
	owner: "main-thread",
	handler: async (params, _ctx) => {
		let text = "";
		if (Array.isArray(params)) {
			const first = params[0];
			if (typeof first === "object" && first !== null) {
				text = String((first as Record<string, unknown>).text ?? first);
			} else {
				text = String(first);
			}
		} else {
			const obj = asRecord(params);
			text = (obj.text as string) || (obj.value as string) || "";
		}
		await navigator.clipboard.writeText(text);
		return null;
	},
	paramTypes: [
		{
			name: "text",
			type: "string",
			required: false,
			description: "Text to write to clipboard",
		},
		{
			name: "value",
			type: "string",
			required: false,
			description: "Alternative text value to write",
		},
	],
	returnDoc: "null",
	errorCode: "ECLIPBOARD",
	errorCategory: "permission",
});
