/**
 * Content-script capabilities — one entry per action stem, surfaces expand to
 * page.* and/or web.tab.*. Built by merging the legacy page/tab spec tables
 * until those tables are fully inlined as register() calls.
 */
import { z } from "zod";
import type { CapabilitySpec } from "./capability.js";
import type { ContentScriptToolSpec } from "./page-specs.js";
import { PAGE_TOOL_SPECS } from "./page-specs.js";
import * as schemas from "./schemas.js";
import { TAB_TOOL_SPECS } from "./tab-specs.js";

type SpecBundle = {
	page?: ContentScriptToolSpec;
	tab?: ContentScriptToolSpec;
};

/** `page_click` → `click`, `tab_set_files` → `set_files`. */
export function actionStemFromAction(action: string): string {
	if (action.startsWith("page_")) return action.slice("page_".length);
	if (action.startsWith("tab_")) return action.slice("tab_".length);
	return action;
}

function handlerParamsFor(actionStem: string): z.ZodType | undefined {
	if (actionStem === "set_files") {
		return schemas.ResolvedSetFilesParamsSchema;
	}
	return undefined;
}

/**
 * Merge page + tab tool specs by action stem (not handlerKey — several agent
 * methods can share one handler, e.g. snapshot + snapshot_text).
 */
export function buildContentScriptCapabilities(): CapabilitySpec[] {
	const byStem = new Map<string, SpecBundle>();

	for (const spec of PAGE_TOOL_SPECS) {
		const stem = actionStemFromAction(spec.action);
		const cur = byStem.get(stem) ?? {};
		cur.page = spec;
		byStem.set(stem, cur);
	}
	for (const spec of TAB_TOOL_SPECS) {
		const stem = actionStemFromAction(spec.action);
		const cur = byStem.get(stem) ?? {};
		cur.tab = spec;
		byStem.set(stem, cur);
	}

	const capabilities: CapabilitySpec[] = [];

	for (const [actionStem, bundle] of byStem) {
		const surfaces: Array<"page" | "web.tab"> = [];
		if (bundle.page) surfaces.push("page");
		if (bundle.tab) surfaces.push("web.tab");

		const primary = bundle.page ?? bundle.tab;
		if (!primary) continue;

		// Prefer page meta when both exist; for dual-surface tools, tab-specific
		// agentMeta (prerequisites wording) is lost — preserve tab meta when only tab.
		const metaSource = bundle.page ?? bundle.tab ?? primary;
		const params = bundle.page ? bundle.page.params : bundle.tab!.params;

		capabilities.push({
			name: primary.name,
			actionStem,
			handlerKey: primary.handlerKey,
			description: (bundle.page ?? primary).description,
			tabDescription: bundle.tab?.description,
			surfaces,
			params: params as z.ZodType,
			returns: primary.returns as z.ZodType,
			handlerParams: handlerParamsFor(actionStem),
			errorCode: metaSource.errorCode,
			errorCategory: metaSource.errorCategory,
			example: metaSource.example,
			returnDoc: metaSource.returnDoc,
			fields: primary.fields,
			aliases: primary.aliases,
			agentMeta: bundle.page?.agentMeta ?? bundle.tab?.agentMeta,
			tabAgentMeta: bundle.tab?.agentMeta,
		});
	}

	return capabilities;
}

/** Singleton list for main + CS registration. */
export const CONTENT_SCRIPT_CAPABILITIES: readonly CapabilitySpec[] =
	buildContentScriptCapabilities();
