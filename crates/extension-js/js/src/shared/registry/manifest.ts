import type { z } from "zod";

export interface Command {
	action: string;
	params: unknown;
	call_id?: number;
	runId?: string;
}

export type AsyncError = {
	message: string;
	code: string;
	category?: string;
};

export type AsyncResponse<T = unknown> =
	| { ok: true; value: T }
	| { ok: false; error: AsyncError };

export interface ToolDocParam {
	name: string;
	type: string;
	required: boolean;
	description: string;
}

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

export interface ToolDefinition<P, R> {
	action: string;
	namespace: string;
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
};

export type SerializableJsCallManifestEntry = {
	action: string;
	namespace: string;
	name: string;
	publicName: string;
	description: string;
	fields: string[] | null;
	aliases: Array<{
		namespace: string;
		name: string;
		fields: string[] | null;
	}> | null;
	owner: ExecutionContextId;
	paramsDoc: ToolDocParam[];
	returnsDoc: { type: string; description: string };
	errorCode: string;
	errorCategory?: string;
	/** Chrome permission required to use this API (e.g. "notifications", "cookies"). */
	permission?: string;
	/** Runnable example string for this API. */
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
			[...params.entries()].map(([key, value]) => [key, coerceWasmParams(value)]),
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
): Record<string, unknown> {
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
	};
}
