import { z } from "zod";
import * as schemas from "../shared/schemas.js";
import { CONTENT_SCRIPT_TOOL_SPECS } from "../shared/registry/content-script-tools.js";
import type { ContentScriptHandlerSpec } from "./registry.js";

/** Direct handler-key messages (non-registryCall) kept for compatibility. */
export function buildLegacyContentScriptSpecs(): ContentScriptHandlerSpec[] {
	return [
		{
			registryAction: "ping",
			handlerKey: "ping",
			params: z.object({}),
			returns: z.object({ ok: z.boolean() }),
		},
		{
			registryAction: "snapshot",
			handlerKey: "snapshot",
			params: schemas.PageSnapshotParamsSchema,
			returns: schemas.SnapshotResultSchema,
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
