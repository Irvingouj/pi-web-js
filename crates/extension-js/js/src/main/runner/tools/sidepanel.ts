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

// ─── Sidepanel ───────────────────────────────────────────────────

const sidepanelHandlers = new Map<
	string,
	(refId: string | undefined, obj: Record<string, unknown>) => unknown
>([
	[
		"sidepanel_click",
		(refId) => {
			const el = refId ? getElementByRefId(refId) : null;
			if (!el) throw makeError(`Element ${refId} not found`, "ENOTFOUND");
			(el as HTMLElement).click();
			return null;
		},
	],
	[
		"sidepanel_dblclick",
		(refId) => {
			const el = refId ? getElementByRefId(refId) : null;
			if (!el) throw makeError(`Element ${refId} not found`, "ENOTFOUND");
			const ev = new MouseEvent("dblclick", { bubbles: true });
			el.dispatchEvent(ev);
			return null;
		},
	],
	[
		"sidepanel_fill",
		(refId, obj) => {
			const el = refId ? getElementByRefId(refId) : null;
			if (!el) throw makeError(`Element ${refId} not found`, "ENOTFOUND");
			const value = obj.value ?? "";
			if ("value" in el) (el as HTMLInputElement).value = String(value);
			return null;
		},
	],
	[
		"sidepanel_type",
		(refId, obj) => {
			const el = refId ? getElementByRefId(refId) : null;
			if (!el) throw makeError(`Element ${refId} not found`, "ENOTFOUND");
			const text = obj.text ?? "";
			if ("value" in el) {
				const input = el as HTMLInputElement;
				input.value += String(text);
				input.dispatchEvent(new Event("input", { bubbles: true }));
			}
			return null;
		},
	],
	[
		"sidepanel_append",
		(refId, obj) => {
			const el = refId ? getElementByRefId(refId) : null;
			if (!el) throw makeError(`Element ${refId} not found`, "ENOTFOUND");
			const text = obj.text ?? "";
			if ("value" in el) {
				const input = el as HTMLInputElement;
				input.value += String(text);
				input.dispatchEvent(new Event("input", { bubbles: true }));
			}
			return null;
		},
	],
	[
		"sidepanel_press",
		(_, obj) => {
			const key = obj.key ?? "";
			const el = document.activeElement;
			if (!el) throw makeError("No active element to press", "ENOTFOUND");
			const ev = new KeyboardEvent("keydown", {
				key: String(key),
				bubbles: true,
			});
			el.dispatchEvent(ev);
			const ev2 = new KeyboardEvent("keyup", {
				key: String(key),
				bubbles: true,
			});
			el.dispatchEvent(ev2);
			return null;
		},
	],
	[
		"sidepanel_select",
		(refId, obj) => {
			const el = refId ? getElementByRefId(refId) : null;
			if (!el) throw makeError(`Element ${refId} not found`, "ENOTFOUND");
			const value = obj.value ?? "";
			if ("value" in el) {
				const select = el as HTMLSelectElement;
				select.value = String(value);
				select.dispatchEvent(new Event("change", { bubbles: true }));
			}
			return null;
		},
	],
	[
		"sidepanel_check",
		(refId, obj) => {
			const el = refId ? getElementByRefId(refId) : null;
			if (!el) throw makeError(`Element ${refId} not found`, "ENOTFOUND");
			const checked = typeof obj.checked === "boolean" ? obj.checked : true;
			if ("checked" in el) {
				const cb = el as HTMLInputElement;
				cb.checked = checked;
				cb.dispatchEvent(new Event("change", { bubbles: true }));
			}
			return null;
		},
	],
	[
		"sidepanel_hover",
		(refId) => {
			const el = refId ? getElementByRefId(refId) : null;
			if (!el) throw makeError(`Element ${refId} not found`, "ENOTFOUND");
			const ev = new MouseEvent("mouseenter", { bubbles: true });
			el.dispatchEvent(ev);
			return null;
		},
	],
	[
		"sidepanel_unhover",
		() => {
			const el = document.activeElement;
			if (!el) throw makeError("No active element to unhover", "ENOTFOUND");
			const ev = new MouseEvent("mouseleave", { bubbles: true });
			el.dispatchEvent(ev);
			return null;
		},
	],
	[
		"sidepanel_scroll",
		(_, obj) => {
			const direction = obj.direction ?? "down";
			const amount =
				typeof obj.amount === "number" ? obj.amount : DEFAULT_SCROLL_AMOUNT;
			window.scrollBy({
				top: direction === "up" ? -amount : amount,
				behavior: "smooth",
			});
			return null;
		},
	],
	[
		"sidepanel_scroll_to",
		(refId) => {
			const el = refId ? getElementByRefId(refId) : null;
			if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
			else window.scrollTo({ top: 0, behavior: "smooth" });
			return null;
		},
	],
]);

function dispatchSidepanelEvent(action: string, params: unknown): unknown {
	const log = logger.child("runner");
	const refId = extractRefId(params);
	log.debug("dispatchSidepanelEvent_start", { action, refId });
	const obj = asRecord(params);
	const handler = sidepanelHandlers.get(action);
	if (!handler) {
		log.error("dispatchSidepanelEvent_no_handler", { action });
		throw makeError(`Unknown sidepanel action: ${action}`, "E_UNKNOWN");
	}
	return handler(refId, obj);
}

registerJsCall({
	action: "sidepanel_click",
	namespace: "sidepanel",
	name: "click",
	description: "Click an element in the sidepanel",
	params: schemas.SidepanelClickParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (params, _ctx) => dispatchSidepanelEvent("sidepanel_click", params),
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",
});

registerJsCall({
	action: "sidepanel_dblclick",
	namespace: "sidepanel",
	name: "dblclick",
	description: "Double-click an element in the sidepanel",
	params: schemas.SidepanelDblClickParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (params, _ctx) =>
		dispatchSidepanelEvent("sidepanel_dblclick", params),
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",
});

registerJsCall({
	action: "sidepanel_fill",
	namespace: "sidepanel",
	name: "fill",
	description: "Fill an element in the sidepanel",
	params: schemas.SidepanelFillParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (params, _ctx) => dispatchSidepanelEvent("sidepanel_fill", params),
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
		{
			name: "value",
			type: "string",
			required: false,
			description: "Value to fill",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",
});

registerJsCall({
	action: "sidepanel_type",
	namespace: "sidepanel",
	name: "type",
	description: "Type into an element in the sidepanel",
	params: schemas.SidepanelTypeParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (params, _ctx) => dispatchSidepanelEvent("sidepanel_type", params),
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
		{
			name: "text",
			type: "string",
			required: false,
			description: "Text to type",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",
});

registerJsCall({
	action: "sidepanel_press",
	namespace: "sidepanel",
	name: "press",
	description: "Press a key in the sidepanel",
	params: schemas.SidepanelPressParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (params, _ctx) => dispatchSidepanelEvent("sidepanel_press", params),
	paramTypes: [
		{
			name: "key",
			type: "string",
			required: false,
			description: "Key to press",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",
});

registerJsCall({
	action: "sidepanel_select",
	namespace: "sidepanel",
	name: "select",
	description: "Select an option in the sidepanel",
	params: schemas.SidepanelSelectParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (params, _ctx) => dispatchSidepanelEvent("sidepanel_select", params),
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
		{
			name: "value",
			type: "string",
			required: false,
			description: "Option value to select",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",
});

registerJsCall({
	action: "sidepanel_check",
	namespace: "sidepanel",
	name: "check",
	description: "Check/uncheck an element in the sidepanel",
	params: schemas.SidepanelCheckParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (params, _ctx) => dispatchSidepanelEvent("sidepanel_check", params),
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
		{
			name: "checked",
			type: "boolean",
			required: false,
			description: "Whether to check or uncheck",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",
});

registerJsCall({
	action: "sidepanel_hover",
	namespace: "sidepanel",
	name: "hover",
	description: "Hover over an element in the sidepanel",
	params: schemas.SidepanelHoverParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (params, _ctx) => dispatchSidepanelEvent("sidepanel_hover", params),
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",
});

registerJsCall({
	action: "sidepanel_unhover",
	namespace: "sidepanel",
	name: "unhover",
	description: "Unhover in the sidepanel",
	params: schemas.SidepanelUnhoverParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (params, _ctx) =>
		dispatchSidepanelEvent("sidepanel_unhover", params),
	paramTypes: [],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",
});

registerJsCall({
	action: "sidepanel_scroll",
	namespace: "sidepanel",
	name: "scroll",
	description: "Scroll the sidepanel",
	params: schemas.SidepanelScrollParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (params, _ctx) => dispatchSidepanelEvent("sidepanel_scroll", params),
	paramTypes: [
		{
			name: "direction",
			type: "string",
			required: false,
			description: "Scroll direction (up or down)",
		},
		{
			name: "amount",
			type: "number",
			required: false,
			description: "Scroll amount in pixels",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",
});

registerJsCall({
	action: "sidepanel_scroll_to",
	namespace: "sidepanel",
	name: "scroll_to",
	description: "Scroll to an element in the sidepanel",
	params: schemas.SidepanelScrollToParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (params, _ctx) =>
		dispatchSidepanelEvent("sidepanel_scroll_to", params),
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: false,
			description: "Element reference ID to scroll to",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",
});

registerJsCall({
	action: "sidepanel_append",
	namespace: "sidepanel",
	name: "append",
	description: "Append text to an element in the sidepanel",
	params: schemas.SidepanelAppendParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (params, _ctx) => dispatchSidepanelEvent("sidepanel_append", params),
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: true,
			description: "Element reference ID",
		},
		{
			name: "text",
			type: "string",
			required: false,
			description: "Text to append",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",
});

registerJsCall({
	action: "sidepanel_url",
	namespace: "sidepanel",
	name: "url",
	description: "Get the sidepanel URL",
	params: schemas.SidepanelUrlParamsSchema,
	returns: z.string(),
	owner: "main-thread",
	handler: async (_params, _ctx) => window.location.href,
	paramTypes: [],
	returnDoc: "URL string",
	errorCode: "E_UNKNOWN",
});

registerJsCall({
	action: "sidepanel_title",
	namespace: "sidepanel",
	name: "title",
	description: "Get the sidepanel title",
	params: schemas.SidepanelTitleParamsSchema,
	returns: z.string(),
	owner: "main-thread",
	handler: async (_params, _ctx) => document.title,
	paramTypes: [],
	returnDoc: "Title string",
	errorCode: "E_UNKNOWN",
});

registerJsCall({
	action: "sidepanel_wait",
	namespace: "sidepanel",
	name: "wait",
	description: "Wait in the sidepanel",
	params: schemas.SidepanelWaitParamsSchema,
	returns: z.boolean(),
	owner: "main-thread",
	handler: async (params, _ctx) => {
		await new Promise((resolve) =>
			setTimeout(resolve, Number(params.duration)),
		);
		return true;
	},
	paramTypes: [
		{
			name: "duration",
			type: "number",
			required: false,
			description: "Duration to wait in milliseconds",
		},
	],
	returnDoc: "true",
	errorCode: "E_UNKNOWN",
});

registerJsCall({
	action: "sidepanel_snapshot",
	namespace: "sidepanel",
	name: "snapshot",
	description: "Capture sidepanel DOM snapshot",
	params: schemas.SidepanelSnapshotParamsSchema,
	returns: z.string(),
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
		if (result.value && typeof result.value === "object") {
			return (result.value as Record<string, unknown>).text as string;
		}
		throw makeError("Failed to get sidepanel snapshot", "E_SNAPSHOT");
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
	returnDoc: "Snapshot text",
	errorCode: "E_SNAPSHOT",
});

registerJsCall({
	action: "sidepanel_snapshot_text",
	namespace: "sidepanel",
	name: "snapshot_text",
	description: "Capture sidepanel DOM snapshot and return text representation",
	params: schemas.SidepanelSnapshotTextParamsSchema,
	returns: z.string(),
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
		if (result.value && typeof result.value === "object") {
			return (result.value as Record<string, unknown>).text as string;
		}
		throw makeError("Failed to get sidepanel snapshot", "E_SNAPSHOT");
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
	returnDoc: "Snapshot text",
	errorCode: "E_SNAPSHOT",
});

registerJsCall({
	action: "sidepanel_snapshot_data",
	namespace: "sidepanel",
	name: "snapshot_data",
	description: "Get sidepanel snapshot data",
	params: schemas.SidepanelSnapshotDataParamsSchema,
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
