/// <reference types="chrome" />
import type {
	DomFormatParams,
	DomSnapshotParams,
	FetchParams,
	TreeSnapshot,
} from "../../../shared/generated.js";

export type { DomFormatParams, DomSnapshotParams, FetchParams };

declare global {
	interface Window {
		__hostHandlers?: Record<string, HostHandler>;
	}
}

export type HostHandler<T = unknown, R = unknown> = (params: T) => Promise<R>;

export type FetchValue = {
	status: number;
	ok: boolean;
	headers: Record<string, string>;
	body: string;
	bodyEncoding: "text" | "base64";
	byteLength: number;
	contentType: string;
	finalUrl: string;
};

export type DomSnapshotValue = {
	data: TreeSnapshot;
	text: string;
};

export type TabMessage =
	| { action: "click"; params: { refId?: string; label?: string } }
	| {
			action: "fill";
			params: { refId?: string; value: string; label?: string };
	  }
	| { action: "type"; params: { refId?: string; text: string; label?: string } }
	| {
			action: "append";
			params: { refId?: string; text: string; label?: string };
	  }
	| { action: "press"; params: { key: string } }
	| { action: "select"; params: { refId: string; value: string } }
	| { action: "check"; params: { refId: string; checked: boolean } }
	| { action: "hover"; params: { refId: string } }
	| { action: "unhover"; params: Record<string, never> }
	| { action: "scroll"; params: { direction: string; amount: number } }
	| { action: "scrollTo"; params: { x: number; y: number; refId?: string } }
	| { action: "dblclick"; params: { refId: string } }
	| { action: "back"; params: Record<string, never> }
	| { action: "ping"; params?: Record<string, never> };

type CodedError = Error & {
	code: string;
	category?: string;
	hint?: string;
	recovery?: string[];
	details?: Record<string, unknown>;
};

export function makeError(
	message: string,
	code: string,
	category?: string,
	extra?: Pick<CodedError, "hint" | "recovery" | "details">,
): CodedError {
	const err = new Error(message) as CodedError;
	err.code = code;
	if (category) err.category = category;
	if (extra?.hint) err.hint = extra.hint;
	if (extra?.recovery) err.recovery = extra.recovery;
	if (extra?.details) err.details = extra.details;
	return err;
}

export function throwAgentError(error: {
	message: string;
	code: string;
	category?: string;
	hint?: string;
	recovery?: string[];
	details?: Record<string, unknown>;
}): never {
	throw makeError(error.message, error.code, error.category, {
		hint: error.hint,
		recovery: error.recovery,
		details: error.details,
	});
}
