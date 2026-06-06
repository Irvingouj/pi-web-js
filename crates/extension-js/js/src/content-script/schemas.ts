import { z } from "zod";
import * as schemas from "../shared/schemas.js";
import { CONTENT_SCRIPT_ACTIONS } from "../shared/registry/content-script-actions.js";
import type { ContentScriptHandlerSpec } from "./registry.js";

const returns = {
	string: z.string(),
	null: z.null(),
	boolean: z.boolean(),
} as const;

/** Params/returns schemas aligned with runner.ts registerJsCall definitions. */
const ACTION_SCHEMAS: Record<
	string,
	{ params: z.ZodSchema<unknown>; returns: z.ZodSchema<unknown> }
> = {
	page_url: { params: schemas.PageUrlParamsSchema, returns: returns.string },
	page_title: { params: schemas.PageTitleParamsSchema, returns: returns.string },
	page_click: { params: schemas.PageClickParamsSchema, returns: returns.null },
	page_fill: { params: schemas.PageFillParamsSchema, returns: returns.null },
	page_type: { params: schemas.PageTypeParamsSchema, returns: returns.null },
	page_append: { params: schemas.PageAppendParamsSchema, returns: returns.null },
	page_press: { params: schemas.PagePressParamsSchema, returns: returns.null },
	page_select: { params: schemas.PageSelectParamsSchema, returns: returns.null },
	page_check: { params: schemas.PageCheckParamsSchema, returns: returns.null },
	page_hover: { params: schemas.PageHoverParamsSchema, returns: returns.null },
	page_unhover: { params: schemas.PageUnhoverParamsSchema, returns: returns.null },
	page_scroll: { params: schemas.PageScrollParamsSchema, returns: returns.boolean },
	page_scroll_to: {
		params: schemas.PageScrollToParamsSchema,
		returns: returns.boolean,
	},
	page_dblclick: { params: schemas.PageDblClickParamsSchema, returns: returns.null },
	page_back: { params: schemas.PageBackParamsSchema, returns: returns.boolean },
	tab_click: { params: schemas.TabClickParamsSchema, returns: returns.null },
	tab_fill: { params: schemas.TabFillParamsSchema, returns: returns.null },
	tab_type: { params: schemas.TabTypeParamsSchema, returns: returns.null },
	tab_press: { params: schemas.TabPressParamsSchema, returns: returns.null },
	tab_select: { params: schemas.TabSelectParamsSchema, returns: returns.null },
	tab_check: { params: schemas.TabCheckParamsSchema, returns: returns.null },
	tab_hover: { params: schemas.TabHoverParamsSchema, returns: returns.null },
	tab_unhover: { params: schemas.TabUnhoverParamsSchema, returns: returns.null },
	tab_scroll: { params: schemas.TabScrollParamsSchema, returns: returns.boolean },
	tab_scroll_to: {
		params: schemas.TabScrollToParamsSchema,
		returns: returns.boolean,
	},
	tab_dblclick: { params: schemas.TabDblClickParamsSchema, returns: returns.null },
	tab_back: { params: schemas.TabBackParamsSchema, returns: returns.boolean },
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
