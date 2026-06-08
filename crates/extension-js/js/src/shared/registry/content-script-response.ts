import type { AsyncError, AsyncResponse } from "./manifest.js";

const TRANSPORT_ERROR: AsyncError = {
	message: "Content script error",
	code: "E_CONTENT_SCRIPT",
	category: "resource",
};

/** Preserve structured content-script errors; fall back for legacy string/malformed shapes. */
export function parseAsyncError(
	raw: unknown,
	fallback: AsyncError = TRANSPORT_ERROR,
): AsyncError {
	if (typeof raw === "string") {
		return {
			message: raw || fallback.message,
			code: fallback.code,
			...(fallback.category ? { category: fallback.category } : {}),
		};
	}
	if (typeof raw === "object" && raw !== null) {
		const obj = raw as Record<string, unknown>;
		const message =
			typeof obj.message === "string" && obj.message
				? obj.message
				: fallback.message;
		const code =
			typeof obj.code === "string" && obj.code ? obj.code : fallback.code;
		const category =
			typeof obj.category === "string" ? obj.category : fallback.category;
		const hint = typeof obj.hint === "string" ? obj.hint : fallback.hint;
		const recovery = Array.isArray(obj.recovery)
			? (obj.recovery as string[])
			: fallback.recovery;
		const details =
			typeof obj.details === "object" && obj.details !== null
				? (obj.details as Record<string, unknown>)
				: fallback.details;
		return {
			message,
			code,
			...(category ? { category } : {}),
			...(hint ? { hint } : {}),
			...(recovery?.length ? { recovery } : {}),
			...(details ? { details } : {}),
		};
	}
	return { ...fallback };
}

export function unwrapContentScriptMessage(result: unknown): AsyncResponse {
	if (
		result &&
		typeof result === "object" &&
		(result as Record<string, unknown>).ok === false
	) {
		return {
			ok: false,
			error: parseAsyncError((result as Record<string, unknown>).error),
		};
	}

	const value =
		result &&
		typeof result === "object" &&
		"value" in (result as Record<string, unknown>)
			? (result as { value: unknown }).value
			: result;
	return { ok: true, value };
}
