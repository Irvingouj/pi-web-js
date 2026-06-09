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
	getActiveTabId,
	resolveActiveTabId,
	executeSnapshotInTab,
	waitForTabLoad,
	DEFAULT_TIMEOUT_MS,
	DEFAULT_MAX_NODES,
	DEFAULT_SCROLL_AMOUNT,
	DEFAULT_POLL_INTERVAL_MS,
} from "../runtime.js";
import { noTabError } from "../../../shared/registry/normalize-agent-error.js";
import { throwAgentError } from "../lib/types.js";

async function requireActiveTab(action: string): Promise<number> {
	const tabId = await resolveActiveTabId();
	if (tabId === null) {
		throwAgentError(noTabError(action));
	}
	return tabId;
}

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
		const activeTab = await requireActiveTab("page.snapshot()");
		const obj = asRecord(params);
		const opts = asRecord(obj.options ?? obj);
		const maxNodes =
			typeof opts.max_nodes === "number" ? opts.max_nodes : DEFAULT_MAX_NODES;
		const result = await executeSnapshotInTab(activeTab, maxNodes);
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
			description: "Maximum nodes to include (literal)",
		},
		{
			name: "options",
			type: "object",
			required: false,
			description: "Snapshot options (literal)",
		},
	],
	returnDoc: "Snapshot text",
	errorCode: "E_SNAPSHOT",

	example: "page.snapshot({ text: \"hello\" })",
	agentMeta: {
		notes: ["Uses script injection; does not guarantee mutations work"],
		tags: ["snapshot", "read"],
		relatedApis: ["web.tab.snapshot"],
	},
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
		const activeTab = await requireActiveTab("page.snapshot()");
		const obj = asRecord(params);
		const opts = asRecord(obj.options ?? obj);
		const maxNodes =
			typeof opts.max_nodes === "number" ? opts.max_nodes : DEFAULT_MAX_NODES;
		const result = await executeSnapshotInTab(activeTab, maxNodes);
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
			description: "Maximum nodes to include (literal)",
		},
		{
			name: "options",
			type: "object",
			required: false,
			description: "Snapshot options (literal)",
		},
	],
	returnDoc: "Snapshot text",
	errorCode: "E_SNAPSHOT",

	example: "page.snapshot_text({ text: \"hello\" })",
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
		const activeTab = await requireActiveTab("page.snapshot()");
		const obj = asRecord(params);
		const opts = asRecord(obj.options ?? obj);
		const maxNodes =
			typeof opts.max_nodes === "number" ? opts.max_nodes : DEFAULT_MAX_NODES;
		const result = await executeSnapshotInTab(activeTab, maxNodes);
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
			description: "Maximum nodes to include (literal)",
		},
		{
			name: "options",
			type: "object",
			required: false,
			description: "Snapshot options (literal)",
		},
	],
	returnDoc: "{ text, nodes, url, title, viewport } — nodes include refId, role, tag, name, value (inputs), checked (checkbox/radio), disabled/readOnly when readable",
	errorCode: "E_SNAPSHOT",

	example: "page.snapshot_data({ value: \"hello\" })",
	agentMeta: {
		notes: [
			"Uses script injection; does not guarantee mutations work",
			"nodes[].value, checked, disabled, and readOnly are included for form controls when readable from the DOM",
			"After fill or other mutations, call snapshot_data() again on the same tab to verify state changed",
		],
		tags: ["snapshot", "read"],
		relatedApis: ["web.tab.snapshot_data"],
	},
});
