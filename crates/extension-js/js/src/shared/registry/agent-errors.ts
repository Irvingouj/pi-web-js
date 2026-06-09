import type { AsyncError } from "./manifest.js";

const CONTENT_SCRIPT_HINT =
	"Content script is not connected on this tab. " +
	"This tab was likely open before the extension loaded (MV3 does not retro-inject).";

function contentScriptRecovery(url: string): string[] {
	const quoted = JSON.stringify(url || "");
	return [
		`await page.goto(${quoted})`,
		"Or ask the user to refresh the target tab, then retry fill/click",
	];
}

export function contentScriptMissingError(
	tabId: number,
	url: string,
): AsyncError {
	const displayUrl = url || "unknown url";
	return {
		message: `Content script is not connected on tab ${tabId} (${displayUrl}).`,
		code: "E_CONTENT_SCRIPT",
		category: "content-script",
		hint: CONTENT_SCRIPT_HINT,
		recovery: contentScriptRecovery(url),
		details: { tabId, url: displayUrl },
	};
}

export function noTabError(action: string): AsyncError {
	return {
		message: `No active tab resolved for ${action}.`,
		code: "E_NO_TAB",
		category: "resource",
		recovery: [
			"const t = await web.tab.current(); console.log(t.tabId, t.url)",
			"Ensure the user is focused on a normal http(s) page tab, not chrome:// or the side panel",
		],
	};
}

export type StaleRefCandidate = {
	refId: string;
	role?: string;
	name?: string;
};

export function staleRefError(
	refId: string,
	options?: { label?: string; candidates?: StaleRefCandidate[] },
): AsyncError {
	const mode = refId ? "refId" : options?.label ? "label" : null;
	const query = refId || options?.label || "";
	let message = `Element not found${mode ? ` by ${mode} "${query}"` : ""}`;
	if (options?.label && options.candidates?.length) {
		const labels = options.candidates
			.map((c) => c.name || c.refId)
			.filter(Boolean)
			.slice(0, 5);
		if (labels.length > 0) {
			message += `. Candidates: ${labels.join(", ")}`;
		} else {
			message += ". Candidates: none";
		}
	}
	const error: AsyncError = {
		message,
		code: "E_STALE",
		category: "resource",
		hint:
			"RefIds are ephemeral. They are assigned at snapshot time and invalidated when the DOM is replaced (navigation, SPA rerender, autocomplete).",
		recovery: [
			"const d = await page.snapshot_data(); find the target in d.nodes",
			"Use a fresh refId from that snapshot only",
			"Do not reuse refIds from before press/click/navigation",
		],
		details: { staleRefId: refId || undefined },
	};
	if (options?.candidates?.length) {
		error.details = { ...error.details, candidates: options.candidates };
	}
	return error;
}

export function notInteractableError(
	action: string,
	refId: string,
	details?: Record<string, unknown>,
): AsyncError {
	return {
		message: `${action} on ${refId} returned no effect.`,
		code: "E_NOT_INTERACTABLE",
		category: "resource",
		hint:
			"Some sites ignore programmatic value assignment; value may not appear in snapshot_data.",
		recovery: [
			`await page.click({ refId: ${JSON.stringify(refId)} }) then await page.type({ refId: ${JSON.stringify(refId)}, text: "..." })`,
			'Or await page.press({ key: "Enter" }) after fill',
			"Re-snapshot and confirm URL or node state changed",
		],
		details: { refId, ...details },
	};
}

export function isContentScriptConnectionError(msg: string): boolean {
	return (
		msg.includes("Could not establish connection") ||
		msg.includes("Receiving end does not exist") ||
		msg.includes("Timeout waiting for content-script ping") ||
		msg.includes("content script not available")
	);
}

export function throwStructuredAgentError(error: AsyncError): never {
	const err = new Error(error.message) as Error & AsyncError;
	err.code = error.code;
	if (error.category) err.category = error.category;
	if (error.hint) err.hint = error.hint;
	if (error.recovery) err.recovery = error.recovery;
	if (error.details) err.details = error.details;
	throw err;
}

export function labelNotFoundError(
	label: string,
	candidates?: StaleRefCandidate[],
): AsyncError {
	let message = `Element not found by label "${label}"`;
	if (candidates?.length) {
		const labels = candidates
			.map((c) => c.name || c.refId)
			.filter(Boolean)
			.slice(0, 5);
		message +=
			labels.length > 0
				? `. Candidates: ${labels.join(", ")}`
				: ". Candidates: none";
	}
	return {
		message,
		code: "E_NOT_FOUND",
		category: "resource",
		hint:
			"No element matched this label. Check candidates or snapshot for visible controls.",
		recovery: [
			"const d = await page.snapshot_data(); find the target in d.nodes",
			"Try a more specific label or use refId from snapshot",
		],
		details: candidates?.length ? { label, candidates } : { label },
	};
}
