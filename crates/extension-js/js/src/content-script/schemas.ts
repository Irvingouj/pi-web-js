import { z } from "zod";
import * as schemas from "../shared/schemas.js";
import { CONTENT_SCRIPT_TOOL_SPECS } from "../shared/registry/content-script-tools.js";
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

export function buildContentScriptSpecs(): ContentScriptHandlerSpec[] {
	return CONTENT_SCRIPT_TOOL_SPECS.map((spec) => ({
		registryAction: spec.action,
		handlerKey: spec.handlerKey,
		params: spec.params,
		returns: spec.returns,
	}));
}
