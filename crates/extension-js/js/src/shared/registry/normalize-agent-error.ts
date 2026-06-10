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

function extractErrorDetails(err: unknown): { name?: string; stack?: string; line?: number } {
	if (!(err instanceof Error)) return {};
	const name = err.name !== "Error" ? err.name : undefined;
	const stack = err.stack;
	let line: number | undefined;
	if (stack) {
		const match = stack.match(/:(\d+):\d+\)?$/m);
		if (match) line = parseInt(match[1], 10);
	}
	return { name, stack, line };
}

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
		if (existing.code === "E_CONTENT_SCRIPT") {
			return contentScriptMissingError(context?.tabId, context?.url);
		}
		return existing;
	}

	const msg = (err instanceof Error ? err.message : String(err)) || "";
	const { name, stack, line } = extractErrorDetails(err);

	if (isContentScriptConnectionError(msg)) {
		return contentScriptMissingError(context?.tabId, context?.url);
	}

	if (msg.includes("permission") || msg.includes("Permission")) {
		const error: AsyncError = {
			message: msg,
			code: "E_PERMISSION",
			category: "permission",
		};
		if (name || stack || line) {
			error.details = { name, stack, line };
		}
		return error;
	}

	if (
		msg.includes("not found") ||
		msg.includes("No tab") ||
		msg.includes("No active tab")
	) {
		const error: AsyncError = {
			message: msg,
			code: "E_NOT_FOUND",
			category: "resource",
		};
		if (name || stack || line) {
			error.details = { name, stack, line };
		}
		return error;
	}

	const error: AsyncError = {
		message: msg,
		code: "E_EXTENSION",
		category: "extension",
	};
	if (name || stack || line) {
		error.details = { name, stack, line };
	}
	return error;
}

export function agentErrorResponse(
	err: unknown,
	context?: { tabId?: number; url?: string; action?: string },
): { ok: false; error: AsyncError } {
	return { ok: false, error: normalizeAgentError(err, context) };
}
