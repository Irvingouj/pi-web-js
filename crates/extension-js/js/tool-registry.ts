import type { z } from "zod";
import { logger } from "./logger.js";

const log = logger.child("tool-registry");

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
}

export interface ToolDefinition<P, R> {
	action: string;
	namespace: string;
	description: string;
	params: z.ZodSchema<P>;
	returns: z.ZodSchema<R>;
	handler: (params: P) => Promise<R>;
	paramTypes: ToolDocParam[];
	returnType?: string;
	returnDoc: string;
	errorCode: string;
	errorCategory?: string;
}

const toolRegistry = new Map<string, ToolDefinition<unknown, unknown>>();

// ─── Runner lifecycle abort signal ───────────────────────────────

let runnerAbortController: AbortController | null = null;

export function setRunnerAbortController(controller: AbortController | null) {
	runnerAbortController = controller;
}

function getRunnerSignal(): AbortSignal | undefined {
	return runnerAbortController?.signal;
}

export function throwIfAborted(): void {
	const signal = getRunnerSignal();
	if (signal?.aborted) {
		throw new Error("Runner aborted: ExtensionSession stopped");
	}
}

// ─── Registry operations ─────────────────────────────────────────

export function registerTool<P, R>(tool: ToolDefinition<P, R>): void {
	if (toolRegistry.has(tool.action)) {
		throw new Error(`Tool "${tool.action}" is already registered`);
	}
	toolRegistry.set(tool.action, tool as ToolDefinition<unknown, unknown>);
}

export function getTool(
	action: string,
): ToolDefinition<unknown, unknown> | undefined {
	return toolRegistry.get(action);
}

export function clearRegistry(): void {
	toolRegistry.clear();
}

export async function dispatchTool(
	action: string,
	params: unknown,
): Promise<AsyncResponse> {
	log.debug("dispatch_start", { action });
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

	throwIfAborted();

	const parseResult = tool.params.safeParse(params);
	if (!parseResult.success) {
		const issues = parseResult.error.issues.map((issue) => {
			const path = issue.path.join(".");
			return `invalid value for field '${path}' (${issue.message})`;
		});
		log.warn("dispatch_invalid_params", { action, issues });
		return {
			ok: false,
			error: {
				message: `Invalid parameters for ${action}: ${issues.join("; ")}`,
				code: "E_INVALID_PARAMS",
				category: "validation",
			},
		};
	}

	try {
		const value = await tool.handler(parseResult.data);
		log.debug("dispatch_done", { action, ok: true, resultType: typeof value });
		return { ok: true, value };
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		const code =
			((err as unknown as Record<string, unknown>).code as string) ||
			tool.errorCode;
		const category = (err as unknown as Record<string, unknown>).category as
			| string
			| undefined;
		log.error("dispatch_error", { action, error: message, code });
		const error: AsyncError = { message, code };
		if (category !== undefined) {
			error.category = category;
		} else if (tool.errorCategory !== undefined) {
			error.category = tool.errorCategory;
		}
		return { ok: false, error };
	}
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
		});
	}
	return docs;
}
