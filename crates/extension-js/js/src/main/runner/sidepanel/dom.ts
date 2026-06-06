/// <reference types="chrome" />
import { asRecord } from "../lib/params.js";

export function getElementByRefId(refId: string): Element | null {
	return document.querySelector(`[data-ref-id='${CSS.escape(refId)}']`);
}

export function extractRefId(params: unknown): string | undefined {
	if (typeof params === "string") return params;
	const obj = asRecord(params);
	return typeof obj.refId === "string"
		? obj.refId
		: typeof obj.ref_id === "string"
			? obj.ref_id
			: undefined;
}
