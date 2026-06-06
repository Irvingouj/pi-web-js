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
	const handler = handlers[handlerAction as string];
	if (!handler) {
		logger.debug("no_handler", { action: handlerAction, registryAction });
		sendResponse({
			ok: false,
			error: `Unknown content script action: ${handlerAction}`,
		});
		return false;
	}

	const promise = dispatchContentScriptCall(
		effectiveRegistryAction,
		handlerAction,
		handler,
		params,
		callId,
	);
	promise
		.then((result) => {
			logger.debug("dispatch_response", {
				registryAction,
				handlerAction,
				ok: result.ok,
			});
			sendResponse(result);
		})
		.catch((err: unknown) => {
			const msg = err instanceof Error ? err.message : String(err);
			logger.debug("dispatch_error", {
				registryAction,
				handlerAction,
				error: msg,
			});
			sendResponse({ ok: false, error: msg || String(err) });
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

		return runHandler(action, action, requestRecord.params, sendResponse);
	});
}
