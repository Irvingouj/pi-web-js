import type { z } from "zod";
import { coerceWasmParams, type AsyncResponse } from "./manifest.js";

function inferReceivedType(params: unknown): string {
	if (params === null) return "null";
	if (params === undefined) return "undefined";
	if (Array.isArray(params)) return "array";
	return typeof params;
}

function describeSchema(schema: z.ZodTypeAny, depth = 0): string {
	if (depth > 2) return "...";

	const def = schema._def as any;

	switch (def.typeName) {
		case "ZodObject": {
			const shape = def.shape();
			const keys = Object.keys(shape);
			if (keys.length === 0) return "{ }";
			if (depth >= 1) return "{ ... }";
			const fields = keys.map((k) => {
				const field = shape[k];
				const isOptional = field._def.typeName === "ZodOptional";
				const type = isOptional
					? describeSchema(field._def.innerType, depth + 1)
					: describeSchema(field, depth + 1);
				return `${k}${isOptional ? "?" : ""}: ${type}`;
			});
			return `{ ${fields.join(", ")} }`;
		}
		case "ZodUnion": {
			const options = def.options as z.ZodTypeAny[];
			return options.map((o) => describeSchema(o, depth)).join(" or ");
		}
		case "ZodString":
			return "string";
		case "ZodNumber":
			return "number";
		case "ZodBoolean":
			return "boolean";
		case "ZodBigInt":
			return "bigint";
		case "ZodNull":
			return "null";
		case "ZodArray":
			return `${describeSchema(def.type, depth + 1)}[]`;
		case "ZodTuple": {
			const items = def.items as z.ZodTypeAny[];
			return `[${items.map((i: z.ZodTypeAny) => describeSchema(i, depth + 1)).join(", ")}]`;
		}
		case "ZodRecord":
			return "object";
		case "ZodOptional":
			return `${describeSchema(def.innerType, depth)}?`;
		case "ZodLiteral":
			return JSON.stringify(def.value);
		case "ZodEnum":
			return def.values.map((v: string) => `"${v}"`).join(" | ");
		case "ZodAny":
			return "any";
		case "ZodUnknown":
			return "unknown";
		case "ZodVoid":
			return "void";
		case "ZodUndefined":
			return "undefined";
		case "ZodEffects":
			return describeSchema(def.schema, depth);
		case "ZodDefault":
			return describeSchema(def.innerType, depth);
		case "ZodNullable":
			return `${describeSchema(def.innerType, depth)} | null`;
		case "ZodLazy":
			return "lazy";
		case "ZodPromise":
			return `Promise<${describeSchema(def.type, depth + 1)}>`;
		case "ZodFunction":
			return "function";
		case "ZodDate":
			return "Date";
		case "ZodMap":
			return "Map";
		case "ZodSet":
			return "Set";
		case "ZodIntersection": {
			return `${describeSchema(def.left, depth)} & ${describeSchema(def.right, depth)}`;
		}
		case "ZodDiscriminatedUnion": {
			const options = def.options as z.ZodTypeAny[];
			return options.map((o) => describeSchema(o, depth)).join(" or ");
		}
		case "ZodBranded":
			return describeSchema(def.type, depth);
		case "ZodNaN":
			return "NaN";
		case "ZodCatch":
			return describeSchema(def.innerType, depth);
		case "ZodPipeline":
			return describeSchema(def.in, depth);
		case "ZodReadonly":
			return `readonly ${describeSchema(def.innerType, depth)}`;
		default:
			return "unknown";
	}
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
		const message = err instanceof Error ? err.message : String(err);
		const code =
			typeof err === "object" &&
			err !== null &&
			"code" in err &&
			typeof err.code === "string"
				? err.code
				: "E_HANDLER";
		const category =
			typeof err === "object" &&
			err !== null &&
			"category" in err &&
			typeof err.category === "string"
				? err.category
				: undefined;
		return {
			ok: false,
			error: {
				message: `${action}: ${message}`,
				code,
				category,
			},
		};
	}
}
