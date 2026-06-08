/// <reference types="chrome" />
import type { AsyncResponse } from "../../../shared/tool-registry.js";
import { logger } from "../../../shared/logger.js";
import { throwIfAborted } from "../../../shared/tool-registry.js";
import { unwrapContentScriptMessage } from "../../../shared/registry/content-script-response.js";
import { getActiveTabId } from "../../tab-context.js";
import { normalizeChromeError } from "../chrome/internals.js";
import {
	contentScriptMissingError,
	isContentScriptConnectionError,
	normalizeAgentError,
} from "../../../shared/registry/normalize-agent-error.js";
import { CS_FAST_PING_MS } from "../lib/constants.js";
import type { TabMessage } from "../lib/types.js";
import { pingTabContentScript } from "./execute.js";

async function tabUrl(chrome: typeof window.chrome, tabId: number): Promise<string> {
	try {
		const tab = await chrome!.tabs!.get(tabId);
		return tab.url ?? "";
	} catch {
		return "";
	}
}

/** @deprecated Prefer ExtensionSession relay or executeSnapshotInTab. Legacy direct tab messaging. */
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
	const pingResult = await pingTabContentScript(targetTab, CS_FAST_PING_MS);
	if (!pingResult.ok) {
		return pingResult;
	}
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
		if (isContentScriptConnectionError(msg)) {
			const url = await tabUrl(chrome, targetTab);
			return { ok: false, error: contentScriptMissingError(targetTab, url) };
		}
		const normalized = normalizeChromeError(err);
		if (normalized.error.code === "E_EXTENSION") {
			const url = await tabUrl(chrome, targetTab);
			return {
				ok: false,
				error: normalizeAgentError(err, { tabId: targetTab, url }),
			};
		}
		return normalized;
	}
}
