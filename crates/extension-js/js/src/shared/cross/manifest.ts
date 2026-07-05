import type { z } from "zod";
import type {
	JsApiAlias,
	JsManifestEntry,
	JsParamDoc,
} from "../../../pkg/extension_js.js";

export interface Command {
	action: string;
	params: unknown;
	call_id?: number;
	runId?: string;
}

export type ParamDetail = {
	path: string;
	expected?: string;
	receivedType?: string;
	receivedPreview?: string;
};

export type AsyncError = {
	message: string;
	code: string;
	category?: string;
	hint?: string;
	recovery?: string[];
	details?: Record<string, unknown>;
	action?: string;
	publicName?: string;
	param?: ParamDetail;
	line?: number | null;
};

export type AsyncResponse<T = unknown> =
	| { ok: true; value: T }
	| { ok: false; error: AsyncError };

// JsParamDoc fields (name/type/required/description) match ToolDocParam exactly.
// Re-export the generated type and keep the legacy name for existing callers.
export type { JsParamDoc };
export type ToolDocParam = JsParamDoc;

export interface ToolDoc {
	action: string;
	namespace: string;
	description: string;
	params: ToolDocParam[];
	returns: {
		type: string;
		description: string;
	};
	errorCode: string;
	errorCategory?: string;
	example?: string;
}

export type ToolAgentMeta = {
	prerequisites?: string[];
	notes?: string[];
	tags?: Array<
		"read" | "write" | "mutation" | "snapshot" | "navigation" | "chrome"
	>;
	relatedApis?: string[];
};

export interface ToolDefinition<P, R> {
	action: string;
	namespace: string;
	name: string;
	description: string;
	params: z.ZodSchema<P>;
	returns: z.ZodSchema<R>;
	handler: (
		params: P,
		callId?: number,
		runId?: string,
		signal?: AbortSignal,
	) => Promise<R>;
	paramTypes: ToolDocParam[];
	returnType?: string;
	returnDoc: string;
	errorCode: string;
	errorCategory?: string;
	example?: string;
}

export type ExecutionContextId = string;

export type CallContext = {
	action: string;
	callId?: number;
	runId?: string;
	signal?: AbortSignal;
};

export type JsCallSpec<P, R> = {
	action: string;
	namespace: string;
	name: string;
	description: string;
	params: z.ZodSchema<P>;
	returns: z.ZodSchema<R>;
	fields?: string[];
	aliases?: Array<{ namespace: string; name: string; fields?: string[] }>;
	owner: ExecutionContextId;
	handler: (params: P, ctx: CallContext) => Promise<R>;
	errorCode: string;
	errorCategory?: string;
	paramTypes?: ToolDocParam[];
	returnType?: string;
	returnDoc?: string;
	/** Chrome permission required to use this API (e.g. "notifications", "cookies"). */
	permission?: string;
	/** Runnable example string for this API. */
	example?: string;
	/** Agent-facing metadata for this API. */
	agentMeta?: ToolAgentMeta;
};

/**
 * Runtime manifest shape derived from the generated JsManifestEntry (wasm-bindgen).
 *
 * The Omit-plus-override pattern handles shape differences between the generated
 * type and the runtime construction paths:
 * - `aliases` is `JsApiAlias[] | null` (wasm-bindgen emits non-null, callers pass null).
 * - `errorCategory`, `permission`, `example` are `string | undefined` (callers pass
 *   optional strings; manifestEntryToWasm normalizes undefined → null for WASM).
 * - `owner` is a runtime-only routing field, not sent to WASM.
 * - The flat fields `prerequisites`, `notes`, `tags`, `relatedApis` come from
 *   JsManifestEntry (optional `string[] | null`); callers may omit them.
 */
export type SerializableJsCallManifestEntry = Omit<
	JsManifestEntry,
	"aliases" | "errorCategory" | "permission" | "example"
> & {
	/** Aliases can be null when constructed from JsCallSpec (spec.aliases may be undefined). */
	aliases: JsApiAlias[] | null;
	/** Runtime routing owner; not part of the WASM manifest shape. */
	owner: ExecutionContextId;
	/** Callers pass string | undefined; manifestEntryToWasm normalizes to string | null. */
	errorCategory?: string;
	permission?: string;
	example?: string;
};

/** Rust/WASM often passes BTreeMap params as a JS Map; Zod object schemas need plain objects.
 *  Native-parity chrome actions also JSON-round-trip in dispatch_handler; this covers relay paths. */
export function coerceWasmParams(params: unknown): unknown {
	if (params === null || params === undefined) {
		return {};
	}
	if (params instanceof Map) {
		return Object.fromEntries(
			[...params.entries()].map(([key, value]) => [
				key,
				coerceWasmParams(value),
			]),
		);
	}
	if (Array.isArray(params)) {
		return params.map(coerceWasmParams);
	}
	return params;
}

/** Convert a serializable manifest entry to the shape expected by WASM registerJsCall/registerJsCallBatch. */
export function manifestEntryToWasm(
	entry: SerializableJsCallManifestEntry,
): JsManifestEntry {
	return {
		action: entry.action,
		namespace: entry.namespace,
		name: entry.name,
		publicName: entry.publicName,
		description: entry.description,
		fields: entry.fields,
		aliases: (entry.aliases ?? []).map((alias) => ({
			namespace: alias.namespace,
			name: alias.name,
			fields: alias.fields,
		})),
		paramsDoc: entry.paramsDoc.map((param) => ({
			name: param.name,
			type: param.type,
			required: param.required,
			description: param.description,
		})),
		returnsDoc: {
			type: entry.returnsDoc.type,
			description: entry.returnsDoc.description,
		},
		errorCode: entry.errorCode,
		errorCategory: entry.errorCategory ?? null,
		permission: entry.permission ?? null,
		example: entry.example ?? null,
		prerequisites: entry.prerequisites ?? null,
		notes: entry.notes ?? null,
		tags: entry.tags ?? null,
		relatedApis: entry.relatedApis ?? null,
	};
}
