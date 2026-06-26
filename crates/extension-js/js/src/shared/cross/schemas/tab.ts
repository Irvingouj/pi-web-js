import { z } from "zod";
import {
	refIdString,
	requireRefIdLabelOrCoordinates,
	tabElementTargetParams,
	tabIdField,
} from "./helpers.js";
import { ResolvedSetFileSchema, SetFileSourceSchema } from "./page.js";

// ─── Tab action schemas ────────────────────────────────────────

const tabQueryShape = z
	.object({
		active: z.boolean().optional().describe("Whether the tabs are active"),
		currentWindow: z
			.boolean()
			.optional()
			.describe("Whether the tabs are in the current window"),
		url: z.string().optional().describe("URL pattern to match tabs against"),
	})
	.passthrough();
export const TabQueryParamsSchema = tabQueryShape;
export const TabCreateParamsSchema = z.preprocess(
	(val) => (typeof val === "string" ? { url: val } : val),
	z.object({
		url: z.string().optional().describe("URL to open in the new tab"),
		active: z.boolean().optional().describe("Whether to focus the new tab"),
	}),
);
const tabIdScalarOrObject = z.union([
	z.number(),
	z.array(
		z
			.object({
				id: z.number().optional(),
				tabId: z.number().optional(),
				tab_id: z.number().optional(),
			})
			.passthrough(),
	),
	z
		.object({
			id: z.number().optional(),
			tabId: z.number().optional(),
			tab_id: z.number().optional(),
		})
		.passthrough(),
]);
export const TabActivateParamsSchema = tabIdScalarOrObject;
export const TabCloseParamsSchema = tabIdScalarOrObject;

export const TabClickParamsSchema = tabElementTargetParams();
export const TabFillParamsSchema = tabElementTargetParams({
	value: z.string().describe("Value to fill into the element"),
});
export const TabSetFilesParamsSchema = tabElementTargetParams({
	files: z
		.array(SetFileSourceSchema)
		.min(1)
		.describe("Files to attach to the input"),
});
export const TabResolvedSetFilesParamsSchema = tabElementTargetParams({
	files: z
		.array(ResolvedSetFileSchema)
		.min(1)
		.describe("Resolved files for content-script application"),
});
export const TabScrollToParamsSchema = z.preprocess(
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
			x: z.number().optional().describe("X coordinate to scroll to"),
			y: z.number().optional().describe("Y coordinate to scroll to"),
		})
		.superRefine(requireRefIdLabelOrCoordinates),
);
export const TabTypeParamsSchema = tabElementTargetParams({
	text: z.string().describe("Text to type into the element"),
});
export const TabPressParamsSchema = z.object({
	...tabIdField,
	key: z.string().describe("Key to press (e.g. Enter, Escape, ArrowDown)"),
});
export const TabSelectParamsSchema = tabElementTargetParams({
	value: z.string().describe("Value to select in the dropdown"),
});
export const TabSelectOptionParamsSchema = tabElementTargetParams({
	value: z
		.string()
		.describe(
			"Visible text of the option to select (matched case-insensitively)",
		),
});
export const TabCheckParamsSchema = tabElementTargetParams({
	checked: z
		.boolean()
		.optional()
		.describe("Desired checked state (true to check, false to uncheck)"),
});
export const TabHoverParamsSchema = tabElementTargetParams();
export const TabSubmitParamsSchema = tabElementTargetParams();
export const TabCheckRadioParamsSchema = z.object({
	...tabIdField,
	name: z
		.string()
		.min(1)
		.describe("The `name` attribute of the radio group to pick from"),
	value: z.string().describe("The `value` of the radio option to check"),
});
export const TabUnhoverParamsSchema = z.object({
	...tabIdField,
});
export const TabScrollParamsSchema = z.object({
	...tabIdField,
	direction: z
		.string()
		.default("down")
		.describe("Scroll direction: up, down, left, or right"),
	amount: z.number().default(300).describe("Pixels to scroll"),
});
export const TabDblClickParamsSchema = tabElementTargetParams();

export const TabEvaluateParamsSchema = z
	.object({
		tabId: z
			.union([z.number(), z.bigint()])
			.optional()
			.describe("Target tab ID"),
		script: z.string().optional().describe("Script to evaluate"),
		code: z.string().optional().describe("Alternative script code"),
		js: z.string().optional().describe("Alternative JS code"),
	})
	.passthrough();
export const TabBackParamsSchema = z
	.object({
		tabId: z
			.union([z.number(), z.bigint()])
			.optional()
			.describe("Target tab ID"),
	})
	.passthrough();
export const TabForwardParamsSchema = z
	.object({
		tabId: z
			.union([z.number(), z.bigint()])
			.optional()
			.describe("Target tab ID"),
	})
	.passthrough();
export const TabWaitForLoadParamsSchema = z
	.object({
		tabId: z
			.union([z.number(), z.bigint()])
			.optional()
			.describe("Target tab ID"),
		timeout: z.number().optional().describe("Timeout in milliseconds"),
	})
	.passthrough();
export const TabFetchParamsSchema = z
	.object({
		tabId: z
			.union([z.number(), z.bigint()])
			.optional()
			.describe("Target tab ID"),
		url: z.string().optional().describe("URL to fetch"),
		options: z.object({}).passthrough().optional().describe("Fetch options"),
	})
	.passthrough();

export const TabSnapshotParamsSchema = z
	.object({
		tabId: z
			.union([z.number(), z.bigint()])
			.optional()
			.describe("Target tab ID"),
		max_nodes: z.number().optional().describe("Maximum nodes to include"),
		options: z.object({}).passthrough().optional().describe("Snapshot options"),
	})
	.passthrough();
export const TabSnapshotTextParamsSchema = z
	.object({
		tabId: z
			.union([z.number(), z.bigint()])
			.optional()
			.describe("Target tab ID"),
		max_nodes: z.number().optional().describe("Maximum nodes to include"),
		options: z.object({}).passthrough().optional().describe("Snapshot options"),
	})
	.passthrough();
export const TabSnapshotDataParamsSchema = z
	.object({
		tabId: z
			.union([z.number(), z.bigint()])
			.optional()
			.describe("Target tab ID"),
		max_nodes: z.number().optional().describe("Maximum nodes to include"),
		options: z.object({}).passthrough().optional().describe("Snapshot options"),
	})
	.passthrough();
