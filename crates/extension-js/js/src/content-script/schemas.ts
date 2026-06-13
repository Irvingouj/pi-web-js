import { z } from "zod";
import { CONTENT_SCRIPT_TOOL_SPECS } from "../shared/registry/content-script-tools.js";
import * as schemas from "../shared/schemas.js";
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

const RESOLVED_SET_FILES_ACTIONS = new Set(["page_set_files", "tab_set_files"]);

export function buildContentScriptSpecs(): ContentScriptHandlerSpec[] {
	return CONTENT_SCRIPT_TOOL_SPECS.map((spec) => ({
		registryAction: spec.action,
		handlerKey: spec.handlerKey,
		params: RESOLVED_SET_FILES_ACTIONS.has(spec.action)
			? spec.action === "tab_set_files"
				? schemas.TabResolvedSetFilesParamsSchema
				: schemas.ResolvedSetFilesParamsSchema
			: spec.params,
		returns: spec.returns,
	}));
}
