import type { z } from "zod";
import { coerceWasmParams } from "../shared/registry/manifest.js";
import { dispatchValidated } from "../shared/registry/dispatch.js";

export type ContentScriptHandler = (
	params: unknown,
	signal?: AbortSignal,
) => unknown | Promise<unknown>;

export type ContentScriptHandlerSpec = {
	registryAction: string;
	handlerKey: string;
	params: z.ZodSchema<unknown>;
	returns: z.ZodSchema<unknown>;
};

const handlerSpecs = new Map<string, ContentScriptHandlerSpec>();
const inFlightCalls = new Map<string, AbortController>();

export function registerContentScriptSpec(spec: ContentScriptHandlerSpec): void {
	handlerSpecs.set(spec.registryAction, spec);
}

export function getContentScriptSpec(
	registryAction: string,
): ContentScriptHandlerSpec | undefined {
	return handlerSpecs.get(registryAction);
}

/** Register content-script handler specs and announce readiness to the host. */
export function registerContentScriptSpecs(
	specs: ContentScriptHandlerSpec[],
): void {
	for (const spec of specs) {
		registerContentScriptSpec(spec);
	}

	try {
		chrome.runtime.sendMessage({ type: "contentScriptReady" });
	} catch {
		// Extension host may not be listening yet.
	}
}

export function cancelContentScriptCall(callId: string): boolean {
	const controller = inFlightCalls.get(callId);
	if (!controller) {
		return false;
	}
	controller.abort();
	inFlightCalls.delete(callId);
	return true;
}

export async function dispatchContentScriptCall(
	registryAction: string,
	_handlerKey: string,
	handler: ContentScriptHandler,
	params: unknown,
	callId?: string,
): Promise<{ ok: true; value: unknown } | { ok: false; error: { message: string; code: string } }> {
	const spec = getContentScriptSpec(registryAction);
	if (!spec) {
		return {
			ok: false,
			error: {
				message: `No schema registered for content-script action: ${registryAction}`,
				code: "E_INTERNAL",
			},
		};
	}

	const abortController = new AbortController();
	if (callId) {
		inFlightCalls.set(callId, abortController);
	}

	try {
		return await dispatchValidated(
			spec.params,
			spec.returns,
			async (validated) => handler(validated, abortController.signal),
			coerceWasmParams(params),
			registryAction,
		);
	} finally {
		if (callId) {
			inFlightCalls.delete(callId);
		}
	}
}
