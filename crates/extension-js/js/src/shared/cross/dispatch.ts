import type { z } from "zod";
import {
	type AsyncResponse,
	coerceWasmParams,
	type ParamDetail,
} from "./manifest.js";
import { normalizeAgentError } from "./normalize-agent-error.js";
import { describeSchema } from "./zod-to-docs.js";

/** Structured fields extracted from zod validation issues. */
type ValidationFields = {
	message: string;
	param?: ParamDetail;
};

/** Received-value descriptor used to populate receivedType/receivedPreview. */
type ReceivedDescriptor = {
	receivedType: string;
	receivedPreview?: string;
};

/**
 * Describe a received value at a (possibly nested) path for error messages.
 * `value` is external boundary data from the QuickJS runtime; narrow here, never deeper.
 */
// `value` is external boundary data from the QuickJS runtime; narrowed here, never passed deeper.
function describeReceived(value: unknown, path?: string[]): ReceivedDescriptor {
	const target = path ? walkPath(value, path) : value;
	if (target === null) return { receivedType: "null" };
	if (target === undefined) return { receivedType: "undefined" };
	if (Array.isArray(target)) return { receivedType: "array" };
	const ty = typeof target;
	if (ty === "function" || ty === "symbol") {
		return { receivedType: ty };
	}
	if (
		ty === "object" ||
		ty === "string" ||
		ty === "number" ||
		ty === "boolean"
	) {
		const preview = safePreview(target);
		return preview !== undefined
			? { receivedType: ty, receivedPreview: preview }
			: { receivedType: ty };
	}
	return { receivedType: ty };
}

function walkPath(value: unknown, path: string[]): unknown {
	let current: unknown = value;
	for (const seg of path) {
		if (current === null || current === undefined) return undefined;
		if (typeof current !== "object") return undefined;
		const idx = Number(seg);
		if (Number.isInteger(idx) && Array.isArray(current)) {
			current = current[idx];
		} else {
			current = (current as Record<string, unknown>)[seg];
		}
	}
	return current;
}

function safePreview(value: unknown): string | undefined {
	try {
		const json = JSON.stringify(value);
		if (json === undefined) return undefined;
		return json.length > 120 ? `${json.slice(0, 117)}...` : json;
	} catch {
		return undefined;
	}
}

export function displayActionName(action: string): string {
	const [head, ...tail] = action.split("_");
	if (head === "page") return `page.${tail.join("_")}`;
	if (head === "tab") return `web.tab.${tail.join("_")}`;
	if (head === "sidepanel") return `sidepanel.${tail.join("_")}`;
	return action;
}

export function formatValidationError(
	action: string,
	schema: z.ZodTypeAny,
	issues: z.ZodIssue[],
	params: unknown,
	displayAction = displayActionName(action),
): ValidationFields {
	const rootIssues = issues.filter((i) => i.path.length === 0);
	const nestedIssues = issues.filter((i) => i.path.length > 0);

	if (rootIssues.length > 0 && nestedIssues.length === 0) {
		const hasCustomIssue = rootIssues.some((i) => i.code === "custom");
		const hasNonTypeIssue = rootIssues.some(
			(i) =>
				i.code !== "invalid_type" &&
				i.code !== "invalid_literal" &&
				i.code !== "invalid_union",
		);

		if (!hasCustomIssue && !hasNonTypeIssue) {
			const expected = describeSchema(schema);
			const received = describeReceived(params).receivedType;
			const noArgsHint = expected === "{ }" ? " or no args" : "";
			const preview = safePreview(params);
			return {
				message: `Invalid parameters for ${displayAction}: expected ${expected}${noArgsHint}, received ${received}`,
				param: {
					path: "root",
					expected: expected === "{ }" ? "object" : expected,
					receivedType: received,
					receivedPreview: preview,
				},
			};
		}
	}

	const parts = issues.map((issue) => {
		const path = issue.path.length > 0 ? issue.path.join(".") : "root";
		return `at '${path}': ${issue.message}`;
	});

	const primary = issues[0];
	const primaryPath = primary.path.length > 0 ? primary.path : [];
	const received = describeReceived(params, primaryPath as string[]);
	const paramPath = primaryPath.length > 0 ? primaryPath.join(".") : "root";
	const expectedType =
		primary.code === "invalid_type" ? extractExpectedType(primary) : undefined;

	return {
		message: `Invalid parameters for ${displayAction}: ${parts.join("; ")}`,
		param: {
			path: paramPath,
			expected: expectedType,
			receivedType: received.receivedType,
			receivedPreview: received.receivedPreview,
		},
	};
}

function extractExpectedType(issue: z.ZodIssue): string | undefined {
	if (issue.code === "invalid_type" && "expected" in issue) {
		return String(issue.expected);
	}
	return undefined;
}

export type { ParamDetail } from "./manifest.js";

export async function dispatchValidated<P, R>(
	paramsSchema: z.ZodSchema<P>,
	returnsSchema: z.ZodSchema<R>,
	handler: (params: P) => Promise<R> | R,
	params: unknown,
	action: string,
	displayAction?: string,
): Promise<AsyncResponse<R>> {
	const publicName = displayAction ?? displayActionName(action);
	const parseResult = paramsSchema.safeParse(coerceWasmParams(params));
	if (!parseResult.success) {
		const fields = formatValidationError(
			action,
			paramsSchema,
			parseResult.error.issues,
			params,
			publicName,
		);
		return {
			ok: false,
			error: {
				...fields,
				code: "E_INVALID_PARAMS",
				category: "validation",
				action,
				publicName,
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
					action,
					publicName,
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
				action,
				publicName,
			},
		};
	}
}
