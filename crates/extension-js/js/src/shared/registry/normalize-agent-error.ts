import type { AsyncError } from "./manifest.js";
import {
	contentScriptMissingError,
	isContentScriptConnectionError,
	labelNotFoundError,
	noTabError,
	notInteractableError,
	staleRefError,
	throwStructuredAgentError,
	type StaleRefCandidate,
} from "./agent-errors.js";

export {
	contentScriptMissingError,
	isContentScriptConnectionError,
	labelNotFoundError,
	noTabError,
	notInteractableError,
	staleRefError,
	throwStructuredAgentError,
	type StaleRefCandidate,
};

export function normalizeAgentError(
	err: unknown,
	context?: { tabId?: number; url?: string; action?: string },
): AsyncError {
	if (
		typeof err === "object" &&
		err !== null &&
		"code" in err &&
		typeof (err as AsyncError).code === "string" &&
		"message" in err &&
		typeof (err as AsyncError).message === "string"
	) {
		const existing = err as AsyncError;
		if (existing.hint || existing.recovery) {
			return existing;
		}
		if (existing.code === "E_CONTENT_SCRIPT" && context?.tabId != null) {
			return contentScriptMissingError(context.tabId, context.url ?? "");
		}
		return existing;
	}

	const msg = (err instanceof Error ? err.message : String(err)) || "";

	if (isContentScriptConnectionError(msg)) {
		if (context?.tabId != null) {
			return contentScriptMissingError(context.tabId, context.url ?? "");
		}
		return {
			message: "Content script is not connected on this tab.",
			code: "E_CONTENT_SCRIPT",
			category: "content-script",
			hint:
				"Content script is not connected on this tab. " +
				"This tab was likely open before the extension loaded (MV3 does not retro-inject).",
			recovery: [
				`await page.goto(${JSON.stringify(context?.url ?? "")})`,
				"Or ask the user to refresh the target tab, then retry fill/click",
			],
		};
	}

	if (msg.includes("permission") || msg.includes("Permission")) {
		return {
			message: msg,
			code: "E_PERMISSION",
			category: "permission",
		};
	}

	if (
		msg.includes("not found") ||
		msg.includes("No tab") ||
		msg.includes("No active tab")
	) {
		return {
			message: msg,
			code: "E_NOT_FOUND",
			category: "resource",
		};
	}

	return {
		message: msg,
		code: "E_EXTENSION",
		category: "extension",
	};
}

export function agentErrorResponse(
	err: unknown,
	context?: { tabId?: number; url?: string; action?: string },
): { ok: false; error: AsyncError } {
	return { ok: false, error: normalizeAgentError(err, context) };
}
