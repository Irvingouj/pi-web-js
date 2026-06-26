import {
	notInteractableError,
	throwStructuredAgentError,
} from "../shared/cross/normalize-agent-error.js";
import type { PageActionResult } from "../shared/cross/schemas.js";
import { readFormFields } from "../shared/cs/snapshot-dom.js";

export function makeActionResult(
	action: string,
	el: Element | null,
	extras?: Record<string, unknown>,
): PageActionResult {
	const refId = el?.getAttribute("data-ref-id") ?? undefined;
	const base: PageActionResult = {
		ok: true,
		action,
		...(refId ? { refId } : {}),
		...(el ? readFormFields(el) : {}),
		...extras,
	};
	return base;
}

export function assertFillEffect(
	action: string,
	el: Element,
	refId: string,
	requested: string,
): void {
	if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
		return;
	}
	if (el.value !== requested) {
		throwStructuredAgentError(
			notInteractableError(action, refId, {
				requested,
				actual: el.value,
			}),
		);
	}
}
