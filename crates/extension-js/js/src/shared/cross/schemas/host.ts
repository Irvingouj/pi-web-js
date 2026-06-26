import { z } from "zod";

// ─── Host call schema ──────────────────────────────────────────

export const HostCallParamsSchema = z
	.object({
		action: z.string().describe("Host action name"),
		params: z
			.object({})
			.passthrough()
			.optional()
			.describe("Parameters for the host action"),
	})
	.passthrough();

/** JSON-serializable values returned by eval/host handlers (array before record — Zod union order). */
export const JsonSerializableResultSchema = z.union([
	z.string(),
	z.number(),
	z.boolean(),
	z.null(),
	z.array(z.unknown()),
	z.record(z.unknown()),
]);

export const HostCallResultSchema = JsonSerializableResultSchema;
