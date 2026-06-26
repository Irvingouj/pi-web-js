/** Shared Zod schema constructors used across domain schema files. */
import { z } from "zod";

export const bigintLike = () =>
	z.union([z.bigint(), z.number().finite()]).transform((v) => BigInt(v));

export const refIdString = () => z.string().regex(/^(?:f\d+_)?e\d+$/);

const POSITIONAL_HINT =
	'use { refId: "e2" } or { label: "..." } object form, not positional arguments';

const requireRefIdOrLabel = (
	data: { refId?: string; label?: string; __invalidPositional?: unknown },
	ctx: z.RefinementCtx,
) => {
	if (data.__invalidPositional !== undefined) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: POSITIONAL_HINT,
		});
		return;
	}
	if (!data.refId && !data.label) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: "Either refId or label is required",
		});
	}
};

export const requireRefIdLabelOrCoordinates = (
	data: {
		refId?: string;
		label?: string;
		x?: number;
		y?: number;
		__invalidPositional?: unknown;
	},
	ctx: z.RefinementCtx,
) => {
	if (data.x !== undefined || data.y !== undefined) {
		return;
	}
	requireRefIdOrLabel(data, ctx);
};

/** All element actions accept refId or label (runner + content-script). */
export const elementTargetParams = (extra?: z.ZodRawShape) =>
	z.preprocess(
		(val) => {
			if (typeof val === "string" || typeof val === "number") {
				return { __invalidPositional: val };
			}
			return val;
		},
		z
			.object({
				__invalidPositional: z
					.union([z.string(), z.number()])
					.optional()
					.describe("Internal flag for positional argument rejection"),
				refId: refIdString()
					.optional()
					.describe("Element reference ID (e.g. e2)"),
				label: z.string().optional().describe("Human-readable element label"),
				...extra,
			})
			.superRefine(requireRefIdOrLabel),
	);

export const tabIdField = {
	tabId: z.union([z.number(), z.bigint()]).optional().describe("Target tab ID"),
};

export const tabElementTargetParams = (extra?: z.ZodRawShape) =>
	z.preprocess(
		(val) => {
			if (typeof val === "string" || typeof val === "number") {
				return { __invalidPositional: val };
			}
			return val;
		},
		z
			.object({
				__invalidPositional: z
					.union([z.string(), z.number()])
					.optional()
					.describe("Internal flag for positional argument rejection"),
				...tabIdField,
				refId: refIdString()
					.optional()
					.describe("Element reference ID (e.g. e2)"),
				label: z.string().optional().describe("Human-readable element label"),
				...extra,
			})
			.superRefine(requireRefIdOrLabel),
	);
