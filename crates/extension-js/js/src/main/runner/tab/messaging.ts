/// <reference types="chrome" />
import type { AsyncResponse } from "../../../shared/tool-registry.js";
import { logger } from "../../../shared/logger.js";
import { throwIfAborted } from "../../../shared/tool-registry.js";
import { unwrapContentScriptMessage } from "../../../shared/registry/content-script-response.js";
import { getActiveTabId } from "../../tab-context.js";
import { normalizeChromeError } from "../chrome/internals.js";
import { INJECTION_DELAY_MS, RETRY_DELAY_MS } from "../lib/constants.js";
import type { TabMessage } from "../lib/types.js";

export async function sendMessageToTab(
	tabId: number | null,
	message: TabMessage,
): Promise<AsyncResponse> {
	throwIfAborted();
	const log = logger.child("runner");
	log.debug("sendMessageToTab_start", { tabId, action: message.action });
	const chrome = window.chrome;
	if (!chrome?.runtime?.id) {
		return {
			ok: false,
			error: {
				message: "Not in extension context",
				code: "E_NO_EXTENSION",
				category: "permission",
			},
		};
	}
	const targetTab = typeof tabId === "number" ? tabId : getActiveTabId();
	if (targetTab === null) {
		log.warn("sendMessageToTab_no_tab", { tabId });
		return {
			ok: false,
			error: {
				message: "No active tab available",
				code: "E_NO_TAB",
				category: "resource",
			},
		};
	}
	logger.debug("sendMessageToTab", {
		targetTab,
		messageAction: message.action,
	});
	for (let attempt = 0; attempt < 5; attempt++) {
		try {
			const result = await chrome.tabs.sendMessage(targetTab, message);
			logger.debug("sendMessageToTab_raw_result", {
				targetTab,
				resultType: typeof result,
			});
			const parsed = unwrapContentScriptMessage(result);
			if (!parsed.ok) {
				logger.debug("sendMessageToTab_content_script_error", {
					targetTab,
					error: parsed.error,
				});
				return parsed;
			}
			logger.debug("sendMessageToTab_success", {
				targetTab,
				resultType: typeof result,
			});
			return parsed;
		} catch (err: unknown) {
			const msg = (err instanceof Error ? err.message : String(err)) || "";
			if (msg.includes("Receiving end does not exist") && attempt < 4) {
				log.debug("sendMessageToTab_retry", { targetTab, attempt });
				if (attempt === 0) {
					try {
						await chrome.scripting.executeScript({
							target: { tabId: targetTab },
							files: ["content-script.js"],
							world: "ISOLATED",
						});
						await new Promise((resolve) =>
							setTimeout(resolve, INJECTION_DELAY_MS),
						);
					} catch (injectErr: unknown) {
						return normalizeChromeError(injectErr);
					}
				}
				await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
				continue;
			}
			return normalizeChromeError(err);
		}
	}
	return {
		ok: false,
		error: {
			message: "Failed to send message to tab after retries",
			code: "E_TAB_MESSAGE",
			category: "resource",
		},
	};
}
