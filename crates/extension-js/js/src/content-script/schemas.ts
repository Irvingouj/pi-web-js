import { z } from "zod";
import { expandCapability } from "../shared/cross/capability.js";
import { CONTENT_SCRIPT_CAPABILITIES } from "../shared/cross/content-script-capabilities.js";
import type { ContentScriptHandlerSpec } from "./registry.js";

/** Infra-only schemas for non-registryCall messages (ping connectivity probe). */
export function buildInfraContentScriptSpecs(): ContentScriptHandlerSpec[] {
	return [
		{
			registryAction: "ping",
			handlerKey: "ping",
			params: z.object({}),
			returns: z.object({ ok: z.boolean() }),
		},
	];
}

/** Expand capabilities into per-action CS validation specs (handlerParams when set). */
export function buildContentScriptSpecs(): ContentScriptHandlerSpec[] {
	const specs: ContentScriptHandlerSpec[] = [];
	for (const cap of CONTENT_SCRIPT_CAPABILITIES) {
		for (const entry of expandCapability(cap)) {
			specs.push({
				registryAction: entry.action,
				handlerKey: entry.handlerKey,
				params: entry.handlerParams as z.ZodSchema<unknown>,
				returns: entry.returns as z.ZodSchema<unknown>,
			});
		}
	}
	return specs;
}
