/// <reference types="chrome" />
import { getTool } from "../../../shared/main/tool-registry.js";
import type { HostHandler } from "./types.js";

// ─── Host handler registry ─────────────────────────────────────

export const hostHandlers: Record<string, HostHandler> = {};

export function registerHostHandler<T, R>(
	action: string,
	handler: (params: T) => Promise<R>,
) {
	hostHandlers[action] = handler as HostHandler;
}

export function registerHostHandlers(handlers: Record<string, HostHandler>) {
	Object.assign(hostHandlers, handlers);
}

export function isValidMainThreadAction(action: string): boolean {
	if (getTool(action)) return true;
	if (action.startsWith("host_")) {
		const hostAction = action.slice(5);
		return !!hostHandlers[hostAction] || !!window.__hostHandlers?.[hostAction];
	}
	return false;
}
