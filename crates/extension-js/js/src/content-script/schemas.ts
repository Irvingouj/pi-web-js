import { z } from "zod";
import * as schemas from "../shared/schemas.js";
import { CONTENT_SCRIPT_ACTIONS } from "../shared/registry/content-script-actions.js";
import type { ContentScriptHandlerSpec } from "./registry.js";

const actionResult = schemas.PageActionResultSchema;

/** Params/returns schemas aligned with runner.ts registerJsCall definitions. */
const ACTION_SCHEMAS: Record<
	string,
	{ params: z.ZodSchema<unknown>; returns: z.ZodSchema<unknown> }
> = {
	page_click: { params: schemas.PageClickParamsSchema, returns: actionResult },
	page_fill: { params: schemas.PageFillParamsSchema, returns: actionResult },
	page_type: { params: schemas.PageTypeParamsSchema, returns: actionResult },
	page_append: { params: schemas.PageAppendParamsSchema, returns: actionResult },
	page_press: { params: schemas.PagePressParamsSchema, returns: actionResult },
	page_select: { params: schemas.PageSelectParamsSchema, returns: actionResult },
	page_check: { params: schemas.PageCheckParamsSchema, returns: actionResult },
	page_hover: { params: schemas.PageHoverParamsSchema, returns: actionResult },
	page_unhover: { params: schemas.PageUnhoverParamsSchema, returns: actionResult },
	page_scroll: { params: schemas.PageScrollParamsSchema, returns: actionResult },
	page_scroll_to: {
		params: schemas.PageScrollToParamsSchema,
		returns: actionResult,
	},
	page_dblclick: { params: schemas.PageDblClickParamsSchema, returns: actionResult },
	page_back: { params: schemas.PageBackParamsSchema, returns: actionResult },
	tab_click: { params: schemas.TabClickParamsSchema, returns: actionResult },
	tab_fill: { params: schemas.TabFillParamsSchema, returns: actionResult },
	tab_type: { params: schemas.TabTypeParamsSchema, returns: actionResult },
	tab_press: { params: schemas.TabPressParamsSchema, returns: actionResult },
	tab_select: { params: schemas.TabSelectParamsSchema, returns: actionResult },
	tab_check: { params: schemas.TabCheckParamsSchema, returns: actionResult },
	tab_hover: { params: schemas.TabHoverParamsSchema, returns: actionResult },
	tab_unhover: { params: schemas.TabUnhoverParamsSchema, returns: actionResult },
	tab_scroll: { params: schemas.TabScrollParamsSchema, returns: actionResult },
	tab_scroll_to: {
		params: schemas.TabScrollToParamsSchema,
		returns: actionResult,
	},
	tab_dblclick: { params: schemas.TabDblClickParamsSchema, returns: actionResult },
	tab_back: { params: schemas.TabBackParamsSchema, returns: actionResult },
};

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
	const specs: ContentScriptHandlerSpec[] = [];
	for (const action of CONTENT_SCRIPT_ACTIONS) {
		const entry = ACTION_SCHEMAS[action];
		if (!entry) {
			throw new Error(`Missing content-script schemas for action: ${action}`);
		}
		const underscore = action.indexOf("_");
		const handlerKey = underscore >= 0 ? action.slice(underscore + 1) : action;
		specs.push({
			registryAction: action,
			handlerKey,
			params: entry.params,
			returns: entry.returns,
		});
	}
	return specs;
}
