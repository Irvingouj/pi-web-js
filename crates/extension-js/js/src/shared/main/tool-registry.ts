import type { z } from "zod";
import {
	clearContentScriptActions,
	isContentScriptAction,
} from "../cross/content-script-actions.js";
import { dispatchValidated } from "../cross/dispatch.js";
import type {
	AsyncResponse,
	CallContext,
	JsCallSpec,
	SerializableJsCallManifestEntry,
	ToolDefinition,
	ToolDoc,
} from "../cross/manifest.js";
import { zodToParamDocs, zodToReturnType } from "../cross/zod-to-docs.js";
import { logger } from "./logger.js";
import { inferOwner } from "./routes.js";

export type {
	AsyncError,
	AsyncResponse,
	CallContext,
	Command,
	ExecutionContextId,
	JsCallSpec,
	ParamDetail,
	SerializableJsCallManifestEntry,
	ToolDefinition,
	ToolDoc,
	ToolDocParam,
} from "../cross/manifest.js";
export { coerceWasmParams, manifestEntryToWasm } from "../cross/manifest.js";

const log = logger.child("tool-registry");

// ─── Registries ──────────────────────────────────────────────────

const toolRegistry = new Map<string, ToolDefinition<unknown, unknown>>();
const jsRegistry = new Map<string, JsCallSpec<unknown, unknown>>();
let jsRegistryFrozen = false;

// ─── Runner lifecycle abort signal ───────────────────────────────
//
// Abort is per-session: each ExtensionSession owns its own AbortController
// (extension-session.ts) and threads `signal` down through dispatchTool /
// dispatchCommand into tool handlers and the tab execution helpers. There is
// NO module-global default — every check takes the signal explicitly so that
// multiple sessions in one document (e.g. multi-window sidepanels in tests,
// or future per-window sessions) never race on a shared signal.

/** Throw `Runner aborted` if the given signal has already been aborted. */
export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw new Error("Runner aborted: ExtensionSession stopped");
	}
}

function _isCodedError(
	err: unknown,
): err is { code?: string; category?: string } {
	return typeof err === "object" && err !== null;
}

// ─── Registry operations ─────────────────────────────────────────

/** Manifest-only registration for actions executed in the content script. */
export function registerContentScriptJsCall<P, R>(
	spec: Omit<JsCallSpec<P, R>, "owner" | "handler">,
): void {
	registerJsCall({
		...spec,
		owner: "content-script",
		handler: async () => {
			throw new Error(`${spec.action} runs in the content script`);
		},
	});
}

export function registerJsCall<P, R>(spec: JsCallSpec<P, R>): void {
	if (jsRegistryFrozen) {
		throw new Error(`JS registry is frozen; cannot register "${spec.action}"`);
	}
	if (jsRegistry.has(spec.action)) {
		throw new Error(`Tool "${spec.action}" is already registered`);
	}
	const publicName = `${spec.namespace}.${spec.name}`;
	let publicNameTaken = false;
	let takenByAction = "";
	for (const [action, entry] of jsRegistry) {
		const entryPublicName = `${entry.namespace}.${entry.name}`;
		if (entryPublicName === publicName) {
			publicNameTaken = true;
			takenByAction = action;
			break;
		}
	}

	if (publicNameTaken) {
		throw new Error(
			`Duplicate public name "${publicName}" for action "${spec.action}" (already registered by "${takenByAction}")`,
		);
	}

	const normalizedOwner = inferOwner(spec.action, spec.owner);
	const storedSpec = {
		...spec,
		owner: normalizedOwner,
	} as JsCallSpec<unknown, unknown>;
	jsRegistry.set(spec.action, storedSpec);

	if (normalizedOwner !== "main-thread") {
		return;
	}

	const toolDef: ToolDefinition<unknown, unknown> = {
		action: spec.action,
		namespace: spec.namespace,
		name: spec.name,
		description: spec.description,
		params: spec.params as z.ZodSchema<unknown>,
		returns: spec.returns as z.ZodSchema<unknown>,
		handler: async (params: unknown, ctx: CallContext) => {
			return storedSpec.handler(params, ctx);
		},
		paramTypes: spec.paramTypes ?? [],
		returnType:
			spec.returnType ?? zodToReturnType(spec.returns as z.ZodSchema<unknown>),
		returnDoc: spec.returnDoc ?? "Result",
		errorCode: spec.errorCode,
		errorCategory: spec.errorCategory,
		example: spec.example,
	};
	toolRegistry.set(spec.action, toolDef);
}

export function getTool(
	action: string,
): ToolDefinition<unknown, unknown> | undefined {
	return toolRegistry.get(action);
}

/** Test-only helper: remove a tool from the tool registry without touching the JS registry. */
export function removeToolForTest(action: string): boolean {
	return toolRegistry.delete(action);
}

export function clearRegistry(): void {
	toolRegistry.clear();
	jsRegistry.clear();
	jsRegistryFrozen = false;
	clearContentScriptActions();
}

export function freezeJsRegistry(): void {
	jsRegistryFrozen = true;

	// Validate every manifest entry has an executable route + handler.
	const manifest = getSerializableJsManifest();
	const orphans: string[] = [];

	for (const entry of manifest) {
		if (entry.owner === "main-thread") {
			if (!getTool(entry.action)) {
				orphans.push(`${entry.action} (main-thread: no tool handler)`);
			}
		} else if (entry.owner === "content-script") {
			if (!isContentScriptAction(entry.action)) {
				orphans.push(
					`${entry.action} (content-script: missing from content-script action set)`,
				);
			}
		} else {
			// Unknown owner type — every manifest entry must have a known owner
			// so that freeze validation can verify its executable handler.
			// Worker entries are registered and validated on the WASM side;
			// they do not appear in the JS registry.
			orphans.push(`${entry.action} (unknown owner: ${entry.owner})`);
		}
	}

	if (orphans.length > 0) {
		throw new Error(
			`Manifest integrity failure: ${orphans.length} orphan entries lack executable handlers:\n` +
				orphans.map((o) => `  - ${o}`).join("\n"),
		);
	}
}

export function clearJsRegistry(): void {
	jsRegistry.clear();
	jsRegistryFrozen = false;
	toolRegistry.clear();
	clearContentScriptActions();
}

export function getSerializableJsManifest(): SerializableJsCallManifestEntry[] {
	const entries: SerializableJsCallManifestEntry[] = [];
	for (const [action, spec] of jsRegistry) {
		if (spec.owner === "rust") continue;

		const paramsDoc =
			spec.paramTypes && spec.paramTypes.length > 0
				? spec.paramTypes
				: zodToParamDocs(spec.params);
		const returnsDoc = {
			type: spec.returnType ?? zodToReturnType(spec.returns),
			description: spec.returnDoc ?? "Result",
		};
		entries.push({
			action,
			namespace: spec.namespace,
			name: spec.name,
			publicName: `${spec.namespace}.${spec.name}`,
			description: spec.description,
			fields: spec.fields ?? null,
			aliases:
				spec.aliases?.map((a) => ({
					namespace: a.namespace,
					name: a.name,
					fields: a.fields ?? null,
				})) ?? null,
			owner: spec.owner,
			paramsDoc,
			returnsDoc,
			errorCode: spec.errorCode,
			errorCategory: spec.errorCategory,
			permission: spec.permission,
			example: spec.example,
			prerequisites: spec.agentMeta?.prerequisites,
			notes: spec.agentMeta?.notes,
			tags: spec.agentMeta?.tags,
			relatedApis: spec.agentMeta?.relatedApis,
		});
	}
	return entries;
}

export async function dispatchTool(
	action: string,
	params: unknown,
	ctx: CallContext,
): Promise<AsyncResponse> {
	log.debug("dispatch_start", { action, callId: ctx.callId, runId: ctx.runId });
	const tool = toolRegistry.get(action);
	if (!tool) {
		return {
			ok: false,
			error: {
				message: `Unknown main-thread action: ${action}`,
				code: "E_UNKNOWN",
				category: "unknown",
			},
		};
	}

	throwIfAborted(ctx.signal);

	const result = await dispatchValidated(
		tool.params,
		tool.returns,
		async (validated) => tool.handler(validated, ctx),
		params,
		action,
		`${tool.namespace}.${tool.name}`,
	);

	if (!result.ok) {
		log.warn("dispatch_error", {
			action,
			error: result.error.message,
			code: result.error.code,
		});
		if (result.error.code === "E_HANDLER") {
			return {
				ok: false,
				error: {
					...result.error,
					code: tool.errorCode,
					category: tool.errorCategory ?? result.error.category,
				},
			};
		}
		return result;
	}

	log.debug("dispatch_done", {
		action,
		ok: true,
		resultType: typeof result.value,
	});
	return result;
}

export function listTools(): ToolDoc[] {
	const docs: ToolDoc[] = [];
	for (const [action, tool] of toolRegistry) {
		const params = tool.paramTypes.map((pt) => ({
			name: pt.name,
			type: pt.type,
			required: pt.required,
			description: pt.description,
		}));

		docs.push({
			action,
			namespace: tool.namespace,
			description: tool.description,
			params,
			returns: {
				type: tool.returnType ?? "unknown",
				description: tool.returnDoc,
			},
			errorCode: tool.errorCode,
			errorCategory: tool.errorCategory,
			example: tool.example,
		});
	}
	return docs;
}
