/// <reference types="chrome" />

import { refIdString } from "../../../shared/schemas.js";
import { asRecord } from "../lib/params.js";

/**
 * Find an element by its opaque reference ID.
 * @param refId — opaque element ref in 'e{N}' format (e.g. 'e2'). Must match schema regex ^e\d+$.
 */
export function getElementByRefId(refId: string): Element | null {
	return document.querySelector(`[data-ref-id='${CSS.escape(refId)}']`);
}

export function extractRefId(params: unknown): string | undefined {
	if (typeof params === "string") {
		return refIdString().safeParse(params).success ? params : undefined;
	}
	const obj = asRecord(params);
	const refId =
		typeof obj.refId === "string"
			? obj.refId
			: typeof obj.ref_id === "string"
				? obj.ref_id
				: undefined;
	if (refId && !refIdString().safeParse(refId).success) {
		return undefined;
	}
	return refId;
}
