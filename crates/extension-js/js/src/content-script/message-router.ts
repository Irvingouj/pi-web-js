import { normalizeAgentError } from "../shared/registry/normalize-agent-error.js";
import { toHandlerAction } from "../shared/registry/content-script-actions.js";
import {
	cancelContentScriptCall,
	dispatchContentScriptCall,
	getContentScriptSpec,
} from "./registry.js";
import { asRecord } from "./dom-utils.js";
import { handlers } from "./handlers.js";
import { logger } from "./logger.js";

function resolveRegistryAction(
	registryAction: string,
	handlerAction: string,
): string {
	if (getContentScriptSpec(registryAction)) {
		return registryAction;
	}
	const pageAction = `page_${handlerAction}`;
	if (getContentScriptSpec(pageAction)) {
		return pageAction;
	}
	return registryAction;
}

function resolveHandlerKey(
	registryAction: string,
	fallback: string,
): string {
	const spec = getContentScriptSpec(registryAction);
	return spec?.handlerKey ?? fallback;
}

function runHandler(
	registryAction: string,
	handlerAction: string,
	params: unknown,
	sendResponse: (response: unknown) => void,
	callId?: string,
): boolean {
	const effectiveRegistryAction = resolveRegistryAction(
		registryAction,
		handlerAction,
	);
	const resolvedHandlerKey = resolveHandlerKey(
		effectiveRegistryAction,
		handlerAction,
	);
	const handler = handlers[resolvedHandlerKey as string];
	if (!handler) {
		logger.debug("no_handler", {
			action: resolvedHandlerKey,
			registryAction,
		});
		sendResponse({
			ok: false,
			error: `Unknown content script action: ${resolvedHandlerKey}`,
		});
		return false;
	}

	const promise = dispatchContentScriptCall(
		effectiveRegistryAction,
		resolvedHandlerKey,
		handler,
		params,
		callId,
	);
	promise
		.then((result) => {
			logger.debug("dispatch_response", {
				registryAction,
				handlerAction: resolvedHandlerKey,
				ok: result.ok,
			});
			sendResponse(result);
		})
		.catch((err: unknown) => {
			const normalized = normalizeAgentError(err, { action: registryAction });
			logger.debug("dispatch_error", {
				registryAction,
				handlerAction: resolvedHandlerKey,
				error: normalized.message,
			});
			sendResponse({ ok: false, error: normalized });
		});
	return true;
}

export function installMessageListener(): void {
	chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
		if (sender.id !== chrome.runtime.id) {
			logger.warn("unauthorized_sender", {
				senderId: sender.id,
				expected: chrome.runtime.id,
			});
			sendResponse({ ok: false, error: "Unauthorized sender" });
			return false;
		}
		const requestRecord = asRecord(request);
		const messageType = String(requestRecord.type ?? "");
		const action = String(requestRecord.action ?? "");
		logger.debug("received", {
			messageType,
			action,
			hasParams: !!requestRecord.params,
		});

		if (messageType === "registryCallCancel") {
			const callId = String(requestRecord.id ?? "");
			cancelContentScriptCall(callId);
			sendResponse({ ok: true });
			return false;
		}

		if (messageType === "registryCall") {
			const handlerAction = toHandlerAction(action);
			const callId =
				typeof requestRecord.id === "string" ? requestRecord.id : undefined;
			return runHandler(
				action,
				handlerAction,
				requestRecord.params,
				sendResponse,
				callId,
			);
		}

		// Contract/e2e pings use { type: "contract-ping" } without an action field.
		if (!action && messageType === "contract-ping") {
			sendResponse({ ok: true });
			return false;
		}
		if (!action) {
			sendResponse({ ok: false, error: "Missing action" });
			return false;
		}

		if (action === "ping") {
			return runHandler("ping", "ping", requestRecord.params, sendResponse);
		}

		sendResponse({
			ok: false,
			error: "Use registryCall for content-script actions",
		});
		return false;
	});
}
