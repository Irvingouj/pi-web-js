import type { z } from "zod";
import { coerceWasmParams, type AsyncResponse } from "./manifest.js";

export async function dispatchValidated<P, R>(
	paramsSchema: z.ZodSchema<P>,
	returnsSchema: z.ZodSchema<R>,
	handler: (params: P) => Promise<R> | R,
	params: unknown,
	action: string,
): Promise<AsyncResponse<R>> {
	const parseResult = paramsSchema.safeParse(coerceWasmParams(params));
	if (!parseResult.success) {
		const issues = parseResult.error.issues.map((issue) => {
			const path = issue.path.join(".");
			return `invalid value for field '${path}' (${issue.message})`;
		});
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
		return { ok: false, error: { message, code } };
	}
}
