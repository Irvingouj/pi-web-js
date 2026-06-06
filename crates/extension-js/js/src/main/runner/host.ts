/// <reference types="chrome" />
import type { AsyncResponse } from "../../shared/tool-registry.js";
import { logger } from "../../shared/logger.js";
import { hostHandlers } from "./lib/host-registry.js";

export async function handleHostCallAction(
	action: string,
	params: unknown,
): Promise<AsyncResponse> {
	const log = logger.child("runner");
	log.debug("handleHostCallAction_start", { action });
	const handler = hostHandlers[action] ?? window.__hostHandlers?.[action];
	if (!handler) {
		log.debug("handleHostCallAction_result", {
			action,
			status: "error",
			reason: "no_handler",
		});
		return {
			ok: false,
			error: {
				message: `No handler registered for "${action}"`,
				code: "ENOHANDLER",
				category: "host",
			},
		};
	}
	try {
		const value = await handler(params);
		log.debug("handleHostCallAction_result", { action, status: "ok" });
		return { ok: true, value };
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		log.debug("handleHostCallAction_result", {
			action,
			status: "error",
			error: message || String(err),
		});
		return {
			ok: false,
			error: {
				message: message || String(err),
				code: "EHOSTCALL",
				category: "host",
			},
		};
	}
}
