/**
 * Capability registration shape — pure types + surface expansion.
 * Call sites use realm-specific `register` (main or content-script) which
 * feeds the existing registry pipeline.
 */
import { z } from "zod";
import type { ToolAgentMeta } from "./manifest.js";

export type Surface = "page" | "web.tab";

export type CapabilitySpec<P = unknown, R = unknown> = {
	/** Agent-facing method name (`page.click` → name `"click"`). */
	name: string;
	/**
	 * Wire action stem: `page_${actionStem}` / `tab_${actionStem}`.
	 * Defaults to `handlerKey` then `name`. Distinct from handlerKey when multiple
	 * agent methods share one handler (e.g. `snapshot` + `snapshot_text` →
	 * handlerKey `snapshot_text`).
	 */
	actionStem?: string;
	/**
	 * Content-script handler map key. Defaults to `actionStem` then `name`.
	 */
	handlerKey?: string;
	description: string;
	/** Which agent surfaces to expose. One handler meaning per capability. */
	surfaces: readonly Surface[];
	/**
	 * Declared params — what agents and apiDocs see (and default CS validation).
	 * Core schema without Surface routing fields; `web.tab` adds `tabId`.
	 */
	params: z.ZodType<P>;
	returns: z.ZodType<R>;
	/**
	 * Opt-in: schema the content-script handler actually receives after pipeline
	 * rewrites (e.g. set_files resolved files). Defaults to `params`.
	 */
	handlerParams?: z.ZodType;
	errorCode: string;
	errorCategory?: string;
	example?: string;
	returnDoc?: string;
	/** Positional/prelude field names for WASM (e.g. find → ["selector"]). */
	fields?: string[];
	aliases?: Array<{ namespace: string; name: string; fields?: string[] }>;
	agentMeta?: ToolAgentMeta;
	/** Optional web.tab-specific agent metadata (prerequisites wording, etc.). */
	tabAgentMeta?: ToolAgentMeta;
	/** Optional page-specific description override (defaults to `description`). */
	tabDescription?: string;
	/**
	 * Implementation. Only invoked in the content-script realm when wired;
	 * main-thread register ignores it for execution (owner: content-script).
	 */
	handler?: (
		params: P,
		signal?: AbortSignal,
	) => R | Promise<R>;
	/**
	 * When true (or when `handler` is set), also register content-script
	 * validation schemas in this realm. Main-thread bootstrap leaves this off;
	 * the CS bundle uses expandCapability + registerContentScriptSpecs instead.
	 */
	wireContentScriptSchema?: boolean;
};

export type ExpandedSurface = {
	action: string;
	namespace: string;
	name: string;
	handlerKey: string;
	/** Declared / agent-facing params for this surface. */
	params: z.ZodType;
	/** Content-script validation params for this surface. */
	handlerParams: z.ZodType;
	returns: z.ZodType;
	description: string;
	errorCode: string;
	errorCategory?: string;
	example?: string;
	returnDoc?: string;
	fields?: string[];
	aliases?: Array<{ namespace: string; name: string; fields?: string[] }>;
	agentMeta?: ToolAgentMeta;
};

const tabIdField = z
	.union([z.number(), z.bigint()])
	.describe("Target tab ID (literal number)");

/** Add required tabId for web.tab surface docs + validation. */
export function withTabId(schema: z.ZodTypeAny): z.ZodTypeAny {
	if (schema instanceof z.ZodObject) {
		return schema.extend({ tabId: tabIdField });
	}
	// preprocess / effects / unions: intersect so tabId is still required
	return schema.and(z.object({ tabId: tabIdField }));
}

export function expandCapability<P, R>(
	spec: CapabilitySpec<P, R>,
): ExpandedSurface[] {
	const actionStem = spec.actionStem ?? spec.handlerKey ?? spec.name;
	const handlerKey = spec.handlerKey ?? actionStem;
	const declaredCore = spec.params as z.ZodTypeAny;
	const handlerCore = (spec.handlerParams ?? spec.params) as z.ZodTypeAny;
	const out: ExpandedSurface[] = [];

	for (const surface of spec.surfaces) {
		if (surface === "page") {
			out.push({
				action: `page_${actionStem}`,
				namespace: "page",
				name: spec.name,
				handlerKey,
				params: declaredCore,
				handlerParams: handlerCore,
				returns: spec.returns as z.ZodTypeAny,
				description: spec.description,
				errorCode: spec.errorCode,
				errorCategory: spec.errorCategory,
				example: spec.example,
				returnDoc: spec.returnDoc,
				fields: spec.fields,
				aliases: spec.aliases,
				agentMeta: spec.agentMeta,
			});
			continue;
		}
		if (surface === "web.tab") {
			out.push({
				action: `tab_${actionStem}`,
				namespace: "web.tab",
				name: spec.name,
				handlerKey,
				params: withTabId(declaredCore),
				handlerParams: withTabId(handlerCore),
				returns: spec.returns as z.ZodTypeAny,
				description: spec.tabDescription ?? spec.description,
				errorCode: spec.errorCode,
				errorCategory: spec.errorCategory,
				example: spec.example,
				returnDoc: spec.returnDoc,
				fields: spec.fields,
				aliases: spec.aliases,
				agentMeta: spec.tabAgentMeta ?? spec.agentMeta,
			});
		}
	}
	return out;
}
