/// <reference types="chrome" />
import { z } from "zod";
import {
	findElementByLabel,
	throwElementNotFound,
} from "../../../content-script/dom-utils.js";
import { logger } from "../../../shared/main/logger.js";
import * as schemas from "../../../shared/cross/schemas.js";
import { registerJsCall } from "../../../shared/main/tool-registry.js";
import type { DomSnapshotParams } from "../runtime.js";
import {
	asRecord,
	DEFAULT_SCROLL_AMOUNT,
	extractRefId,
	getElementByRefId,
	handleDomSnapshot,
	makeError,
	unwrapResult,
} from "../runtime.js";

// ─── Sidepanel ───────────────────────────────────────────────────

const sidepanelHandlers = new Map<
	string,
	(refId: string | undefined, obj: Record<string, unknown>) => unknown
>([
	[
		"sidepanel_click",
		(refId, obj) => {
			const label = typeof obj.label === "string" ? obj.label : "";
			let el = refId ? getElementByRefId(refId) : null;
			if (!el && label) {
				el = findElementByLabel(label);
			}
			if (!el) {
				throwElementNotFound(refId, label, false);
			}
			(el as HTMLElement).click();
			return null;
		},
	],
	[
		"sidepanel_dblclick",
		(refId, obj) => {
			const label = typeof obj.label === "string" ? obj.label : "";
			let el = refId ? getElementByRefId(refId) : null;
			if (!el && label) {
				el = findElementByLabel(label);
			}
			if (!el) {
				throwElementNotFound(refId, label, false);
			}
			const ev = new MouseEvent("dblclick", { bubbles: true });
			el.dispatchEvent(ev);
			return null;
		},
	],
	[
		"sidepanel_fill",
		(refId, obj) => {
			const label = typeof obj.label === "string" ? obj.label : "";
			let el = refId ? getElementByRefId(refId) : null;
			if (!el && label) {
				el = findElementByLabel(label);
			}
			if (!el) {
				throwElementNotFound(refId, label, false);
			}
			const value = obj.value ?? "";
			if ("value" in el) (el as HTMLInputElement).value = String(value);
			return null;
		},
	],
	[
		"sidepanel_type",
		(refId, obj) => {
			const label = typeof obj.label === "string" ? obj.label : "";
			let el = refId ? getElementByRefId(refId) : null;
			if (!el && label) {
				el = findElementByLabel(label);
			}
			if (!el) {
				throwElementNotFound(refId, label, false);
			}
			const text = obj.text ?? "";
			if ("value" in el) {
				const input = el as HTMLInputElement;
				input.value = String(text);
				input.dispatchEvent(new Event("input", { bubbles: true }));
			}
			return null;
		},
	],
	[
		"sidepanel_append",
		(refId, obj) => {
			const label = typeof obj.label === "string" ? obj.label : "";
			let el = refId ? getElementByRefId(refId) : null;
			if (!el && label) {
				el = findElementByLabel(label);
			}
			if (!el) {
				throwElementNotFound(refId, label, false);
			}
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
			const label = typeof obj.label === "string" ? obj.label : "";
			let el = refId ? getElementByRefId(refId) : null;
			if (!el && label) {
				el = findElementByLabel(label);
			}
			if (!el) {
				throwElementNotFound(refId, label, false);
			}
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
			const label = typeof obj.label === "string" ? obj.label : "";
			let el = refId ? getElementByRefId(refId) : null;
			if (!el && label) {
				el = findElementByLabel(label);
			}
			if (!el) {
				throwElementNotFound(refId, label, false);
			}
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
		(refId, obj) => {
			const label = typeof obj.label === "string" ? obj.label : "";
			let el = refId ? getElementByRefId(refId) : null;
			if (!el && label) {
				el = findElementByLabel(label);
			}
			if (!el) {
				throwElementNotFound(refId, label, false);
			}
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
		(refId, obj) => {
			const label = typeof obj.label === "string" ? obj.label : "";
			let el = refId ? getElementByRefId(refId) : null;
			if (!el && label) {
				el = findElementByLabel(label);
			}
			if (!el) {
				throwElementNotFound(refId, label, false);
			}
			el.scrollIntoView({ behavior: "smooth", block: "center" });
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
	handler: async (params, _ctx) =>
		dispatchSidepanelEvent("sidepanel_click", params),
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: false,
			description: "Element reference ID (refId)",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label (label)",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",

	example: 'sidepanel.click({ refId: "e2" })',
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
			required: false,
			description: "Element reference ID (refId)",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label (label)",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",

	example: 'sidepanel.dblclick({ refId: "e2" })',
});

registerJsCall({
	action: "sidepanel_fill",
	namespace: "sidepanel",
	name: "fill",
	description: "Fill an element in the sidepanel",
	params: schemas.SidepanelFillParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (params, _ctx) =>
		dispatchSidepanelEvent("sidepanel_fill", params),
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: false,
			description: "Element reference ID (refId)",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label (label)",
		},
		{
			name: "value",
			type: "string",
			required: false,
			description: "Value to fill (literal)",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",

	example: 'sidepanel.fill({ refId: "e2" })',
});

registerJsCall({
	action: "sidepanel_type",
	namespace: "sidepanel",
	name: "type",
	description: "Type into an element in the sidepanel",
	params: schemas.SidepanelTypeParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (params, _ctx) =>
		dispatchSidepanelEvent("sidepanel_type", params),
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: false,
			description: "Element reference ID (refId)",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label (label)",
		},
		{
			name: "text",
			type: "string",
			required: false,
			description: "Text to type (literal)",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",

	example: 'sidepanel.type({ refId: "e2" })',
});

registerJsCall({
	action: "sidepanel_press",
	namespace: "sidepanel",
	name: "press",
	description: "Press a key in the sidepanel",
	params: schemas.SidepanelPressParamsSchema,
	returns: z.null(),
	fields: ["key"],
	owner: "main-thread",
	handler: async (params, _ctx) =>
		dispatchSidepanelEvent("sidepanel_press", params),
	paramTypes: [
		{
			name: "key",
			type: "string",
			required: false,
			description: "Key to press (literal)",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",

	example: 'sidepanel.press("Enter")',
});

registerJsCall({
	action: "sidepanel_select",
	namespace: "sidepanel",
	name: "select",
	description: "Select an option in the sidepanel",
	params: schemas.SidepanelSelectParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (params, _ctx) =>
		dispatchSidepanelEvent("sidepanel_select", params),
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: false,
			description: "Element reference ID (refId)",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label (label)",
		},
		{
			name: "value",
			type: "string",
			required: false,
			description: "Option value to select (literal)",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",

	example: 'sidepanel.select({ refId: "e2" })',
});

registerJsCall({
	action: "sidepanel_check",
	namespace: "sidepanel",
	name: "check",
	description: "Check/uncheck an element in the sidepanel",
	params: schemas.SidepanelCheckParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (params, _ctx) =>
		dispatchSidepanelEvent("sidepanel_check", params),
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: false,
			description: "Element reference ID (refId)",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label (label)",
		},
		{
			name: "checked",
			type: "boolean",
			required: false,
			description: "Whether to check or uncheck (literal)",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",

	example: 'sidepanel.check({ refId: "e2" })',
});

registerJsCall({
	action: "sidepanel_hover",
	namespace: "sidepanel",
	name: "hover",
	description: "Hover over an element in the sidepanel",
	params: schemas.SidepanelHoverParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (params, _ctx) =>
		dispatchSidepanelEvent("sidepanel_hover", params),
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: false,
			description: "Element reference ID (refId)",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label (label)",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",

	example: 'sidepanel.hover({ refId: "e2" })',
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

	example: "sidepanel.unhover()",
});

registerJsCall({
	action: "sidepanel_scroll",
	namespace: "sidepanel",
	name: "scroll",
	description: "Scroll the sidepanel",
	params: schemas.SidepanelScrollParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (params, _ctx) =>
		dispatchSidepanelEvent("sidepanel_scroll", params),
	paramTypes: [
		{
			name: "direction",
			type: "string",
			required: false,
			description: "Scroll direction (up or down) (literal)",
		},
		{
			name: "amount",
			type: "number",
			required: false,
			description: "Scroll amount in pixels (literal)",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",

	example: 'sidepanel.scroll({ direction: "down", amount: 500 })',
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
			description: "Element reference ID to scroll to (refId)",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label to scroll to (label)",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",

	example: 'sidepanel.scroll_to({ refId: "e2" })',
});

registerJsCall({
	action: "sidepanel_append",
	namespace: "sidepanel",
	name: "append",
	description: "Append text to an element in the sidepanel",
	params: schemas.SidepanelAppendParamsSchema,
	returns: z.null(),
	owner: "main-thread",
	handler: async (params, _ctx) =>
		dispatchSidepanelEvent("sidepanel_append", params),
	paramTypes: [
		{
			name: "refId",
			type: "string",
			required: false,
			description: "Element reference ID (refId)",
		},
		{
			name: "label",
			type: "string",
			required: false,
			description: "Element label (label)",
		},
		{
			name: "text",
			type: "string",
			required: false,
			description: "Text to append (literal)",
		},
	],
	returnDoc: "null",
	errorCode: "E_UNKNOWN",

	example: 'sidepanel.append({ refId: "e2" })',
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

	example: "sidepanel.url()",
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

	example: "sidepanel.title()",
});

registerJsCall({
	action: "sidepanel_wait",
	namespace: "sidepanel",
	name: "wait",
	description: "Wait in the sidepanel",
	params: schemas.SidepanelWaitParamsSchema,
	returns: z.boolean(),
	fields: ["duration"],
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
			description: "Duration to wait in milliseconds (literal)",
		},
	],
	returnDoc: "true",
	errorCode: "E_UNKNOWN",

	example: "sidepanel.wait(1000)",
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
			description: "Only include interactive elements (literal)",
		},
		{
			name: "max_nodes",
			type: "number",
			required: false,
			description: "Maximum nodes to include (literal)",
		},
	],
	returnDoc: "Snapshot text",
	errorCode: "E_SNAPSHOT",

	example: "sidepanel.snapshot()",
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
			description: "Only include interactive elements (literal)",
		},
		{
			name: "max_nodes",
			type: "number",
			required: false,
			description: "Maximum nodes to include (literal)",
		},
	],
	returnDoc: "Snapshot text",
	errorCode: "E_SNAPSHOT",

	example: "sidepanel.snapshot_text()",
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
			description: "Only include interactive elements (literal)",
		},
		{
			name: "max_nodes",
			type: "number",
			required: false,
			description: "Maximum nodes to include (literal)",
		},
	],
	returnDoc: "Snapshot data",
	errorCode: "E_SNAPSHOT",

	example: "sidepanel.snapshot_data()",
});
