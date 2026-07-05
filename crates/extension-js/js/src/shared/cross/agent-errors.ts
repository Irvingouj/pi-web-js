import type { AsyncError } from "./manifest.js";

const CONTENT_SCRIPT_HINT =
	"Content script is not connected on this tab. " +
	"This tab was likely open before the extension loaded (MV3 does not retro-inject).";

function contentScriptRecovery(url?: string): string[] {
	const quoted = JSON.stringify(url || "");
	return [
		`await page.goto(${quoted})`,
		"Or ask the user to refresh the target tab, then retry fill/click",
	];
}

export function contentScriptMissingError(
	tabId?: number,
	url?: string,
): AsyncError {
	const displayUrl = url || "unknown url";
	const error: AsyncError = {
		message:
			tabId !== undefined
				? `Content script is not connected on tab ${tabId} (${displayUrl}).`
				: `Content script is not connected on this tab (${displayUrl}).`,
		code: "E_CONTENT_SCRIPT",
		category: "content-script",
		hint: CONTENT_SCRIPT_HINT,
		recovery: contentScriptRecovery(url),
	};
	if (tabId !== undefined) {
		error.details = { tabId, url: displayUrl };
	}
	return error;
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
	options?: {
		label?: string;
		candidates?: StaleRefCandidate[];
		snapshot?: unknown;
	},
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
	const hasSnapshot = options?.snapshot !== undefined;
	const error: AsyncError = {
		message,
		code: "E_STALE",
		category: "resource",
		hint: hasSnapshot
			? "The element changed or was removed after the last observation. A fresh snapshot is attached — re-resolve the target refId and retry."
			: "RefIds are ephemeral. They are assigned at snapshot time and invalidated when the DOM is replaced (navigation, SPA rerender, autocomplete).",
		recovery: hasSnapshot
			? [
					"Read error.details.snapshot.nodes, find the element by role/name, and retry with the new refId",
					"No separate snapshot_data call needed — the attached snapshot already refreshes the lease",
				]
			: [
					"const d = await page.snapshot_data(); find the target in d.nodes",
					"Use a fresh refId from that snapshot only",
					"Do not reuse refIds from before press/click/navigation",
				],
		details: { staleRefId: refId || undefined },
	};
	if (options?.candidates?.length) {
		error.details = { ...error.details, candidates: options.candidates };
	}
	if (hasSnapshot) {
		error.details = { ...error.details, snapshot: options!.snapshot };
	}
	return error;
}

export function notInteractableError(
	action: string,
	refId: string,
	details?: Record<string, unknown>,
): AsyncError {
	const isDropdown =
		details?.controlType === "dropdown" ||
		details?.nearbyControlType === "dropdown";
	const recovery = isDropdown
		? [
				`await page.select_option({ refId: ${JSON.stringify(refId)}, value: "..." }) — this is a dropdown; fill/type do not work on combobox/proxy inputs`,
				"Re-snapshot and use select_option with the option's visible text",
			]
		: [
				`await page.click({ refId: ${JSON.stringify(refId)} }) then await page.type({ refId: ${JSON.stringify(refId)}, text: "..." })`,
				'Or await page.press({ key: "Enter" }) after fill',
				"Re-snapshot and confirm URL or node state changed",
			];
	return {
		message: `${action} on ${refId} returned no effect.`,
		code: "E_NOT_INTERACTABLE",
		category: "resource",
		hint: "Some sites ignore programmatic value assignment; value may not appear in snapshot_data.",
		recovery,
		details: { refId, ...details },
	};
}

export function observationRequiredError(action: string): AsyncError {
	return {
		message: `${action} requires a fresh observation before acting.`,
		code: "E_OBSERVATION_REQUIRED",
		category: "observation",
		hint: "Element refIds are only valid after a snapshot. Take a fresh observation and select a refId from its returned nodes.",
		recovery: [
			"const d = await page.snapshot_data(); find the target in d.nodes",
			"Use a refId from that snapshot only",
		],
		details: { action },
	};
}

export function ambiguousTargetError(label: string): AsyncError {
	return {
		message: `Multiple elements match label "${label}". The target is ambiguous.`,
		code: "E_AMBIGUOUS_TARGET",
		category: "observation",
		hint: "Use a refId from the latest snapshot_data instead of a label, or narrow the label.",
		recovery: [
			"const d = await page.snapshot_data(); find the target in d.nodes",
			"Use the refId from that snapshot",
		],
		details: { label },
	};
}

export function isContentScriptConnectionError(msg: string): boolean {
	return (
		msg.includes("Could not establish connection") ||
		msg.includes("Receiving end does not exist") ||
		msg.includes("Timeout waiting for content-script ping") ||
		msg.includes("content script not available") ||
		msg.includes("message port closed before a response was received")
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
	extra?: {
		searchedIds?: string[];
		ignoredIds?: string[];
		targetRefId?: string;
		targetName?: string;
		ariaControlsBefore?: string | null;
		ariaControlsAfter?: string | null;
		isDropdown?: boolean;
	},
): AsyncError {
	let message = `Element not found by label "${label}"`;
	if (candidates !== undefined) {
		const labels = candidates
			.map((c) => c.name || c.refId)
			.filter(Boolean)
			.slice(0, 5);
		message +=
			labels.length > 0
				? `. Candidates: ${labels.join(", ")}`
				: ". Candidates: none";
	}
	let hint = extra?.searchedIds?.length
		? `Searched listbox(es): ${extra.searchedIds.join(", ")}. Ignored: ${(extra.ignoredIds || []).join(", ") || "none"}.`
		: "No element matched this label. Check candidates or snapshot for visible controls.";
	if (extra?.isDropdown) {
		hint = [
			`Target is a dropdown (combobox). ${hint}`,
			"If candidates are present, retry select_option with one exact candidate text.",
			"Do not fill/type hidden validation-proxy inputs.",
		].join(" ");
	}
	const recovery = extra?.isDropdown
		? [
				"Re-snapshot the dropdown, then retry page.select_option/web.tab.select_option on the same control with one exact visible candidate text",
				[
					"Do not use fill/type/click on comboboxes,",
					"react-select controls, or hidden validation-proxy inputs",
				].join(" "),
			]
		: [
				"const d = await page.snapshot_data(); find the target in d.nodes",
				"Try a more specific label or use refId from snapshot",
			];
	return {
		message,
		code: "E_NOT_FOUND",
		category: "resource",
		hint,
		recovery,
		details: {
			label,
			...(extra?.targetRefId ? { targetRefId: extra.targetRefId } : {}),
			...(extra?.targetName ? { targetName: extra.targetName } : {}),
			...(extra?.searchedIds ? { searchedIds: extra.searchedIds } : {}),
			...(extra?.ignoredIds ? { ignoredIds: extra.ignoredIds } : {}),
			...(extra?.ariaControlsBefore !== undefined
				? { ariaControlsBefore: extra.ariaControlsBefore }
				: {}),
			...(extra?.ariaControlsAfter !== undefined
				? { ariaControlsAfter: extra.ariaControlsAfter }
				: {}),
			...(extra?.isDropdown !== undefined
				? { isDropdown: extra.isDropdown }
				: {}),
			...(candidates?.length ? { candidates } : {}),
		},
	};
}
