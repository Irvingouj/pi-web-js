import type { z } from "zod";
import { type AsyncResponse, coerceWasmParams } from "./manifest.js";
import { normalizeAgentError } from "./normalize-agent-error.js";
import { describeSchema } from "./zod-to-docs.js";

function inferReceivedType(params: unknown): string {
	if (params === null) return "null";
	if (params === undefined) return "undefined";
	if (Array.isArray(params)) return "array";
	return typeof params;
}

export function formatValidationError(
	action: string,
	schema: z.ZodTypeAny,
	issues: z.ZodIssue[],
	params?: unknown,
): string {
	const rootIssues = issues.filter((i) => i.path.length === 0);
	const nestedIssues = issues.filter((i) => i.path.length > 0);

	if (rootIssues.length > 0 && nestedIssues.length === 0) {
		// Only show schema signature for pure type-mismatch root issues.
		// Custom validations (e.g. superRefine) should keep their original message.
		const hasCustomIssue = rootIssues.some((i) => i.code === "custom");
		const hasNonTypeIssue = rootIssues.some(
			(i) =>
				i.code !== "invalid_type" &&
				i.code !== "invalid_literal" &&
				i.code !== "invalid_union",
		);

		if (!hasCustomIssue && !hasNonTypeIssue) {
			const expected = describeSchema(schema);
			const received = inferReceivedType(params);
			const noArgsHint = expected === "{ }" ? " or no args" : "";
			return `Invalid parameters for ${action}: expected ${expected}${noArgsHint}, received ${received}`;
		}
	}

	const parts = issues.map((issue) => {
		const path = issue.path.length > 0 ? issue.path.join(".") : "root";
		return `at '${path}': ${issue.message}`;
	});

	return `Invalid parameters for ${action}: ${parts.join("; ")}`;
}

export async function dispatchValidated<P, R>(
	paramsSchema: z.ZodSchema<P>,
	returnsSchema: z.ZodSchema<R>,
	handler: (params: P) => Promise<R> | R,
	params: unknown,
	action: string,
): Promise<AsyncResponse<R>> {
	const parseResult = paramsSchema.safeParse(coerceWasmParams(params));
	if (!parseResult.success) {
		const message = formatValidationError(
			action,
			paramsSchema,
			parseResult.error.issues,
			params,
		);
		return {
			ok: false,
			error: {
				message,
				code: "E_INVALID_PARAMS",
				category: "validation",
			},
		};
	}

	try {
		const value = await handler(parseResult.data);
		const returnResult = returnsSchema.safeParse(value);
		if (!returnResult.success) {
			const issues = returnResult.error.issues.map((issue) => {
				const path = issue.path.join(".");
				return `invalid return value${path ? ` at '${path}'` : ""} (${issue.message})`;
			});
			return {
				ok: false,
				error: {
					message: `Invalid return value for ${action}: ${issues.join("; ")}`,
					code: "E_INVALID_RETURN",
					category: "validation",
				},
			};
		}
		return { ok: true, value: returnResult.data };
	} catch (err: unknown) {
		const normalized = normalizeAgentError(err);
		const usedHandlerFallback =
			normalized.code === "E_EXTENSION" &&
			(typeof err !== "object" || err === null || !("code" in err));
		return {
			ok: false,
			error: {
				...normalized,
				code: usedHandlerFallback ? "E_HANDLER" : normalized.code,
				message: `${action}: ${normalized.message}`,
			},
		};
	}
}
