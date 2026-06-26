import { z } from "zod";
import type {
	DomSnapshotParams,
	FetchParams,
	FsCopyParams,
	FsHashParams,
	FsPathParams,
	FsReadRangeParams,
	FsUpdateParams,
	FsWriteParams,
	PageCheckParams,
	PageDomParams,
	PageExtractParams,
	PageFillParams,
	PageFindParams,
	PageGotoParams,
	PagePressParams,
	PageScrollParams,
	PageScrollToParams,
	PageSelectParams,
	PageSetFilesParams,
	PageTypeParams,
	PageWaitForParams,
	PageWaitParams,
	SleepParams,
	StorageDeleteParams,
	StorageGetParams,
	StorageSetParams,
} from "../generated.js";
import {
	bigintLike,
	refIdString,
	elementTargetParams,
	tabElementTargetParams,
	requireRefIdLabelOrCoordinates,
} from "./helpers.js";

// ─── Page action schemas ───────────────────────────────────────

export const PageUrlParamsSchema = z.object({});
export const PageTitleParamsSchema = z.object({});

export const PageGotoParamsSchema = z.object({
	url: z.string().describe("URL to navigate to"),
	timeout: bigintLike()
		.optional()
		.describe("Navigation timeout in milliseconds"),
	waitUntil: z
		.enum(["load", "networkidle"])
		.optional()
		.describe(
			"When to consider navigation complete: 'load' (tab status complete) or 'networkidle' (no in-flight requests for 500ms)",
		),
});

export const PageBackParamsSchema = z.object({});
export const PageForwardParamsSchema = z.object({});
export const PageReloadParamsSchema = z.object({});

export const PageWaitParamsSchema = z.object({
	duration: bigintLike()
		.default(1000n)
		.describe("Duration to wait in milliseconds"),
});

export const PageClickParamsSchema = elementTargetParams();

const requireExactlyOneFileSource = (
	data: { url?: string; path?: string; handle?: string },
	ctx: z.RefinementCtx,
) => {
	const sources = [data.url, data.path, data.handle].filter(
		(v) => typeof v === "string" && v.length > 0,
	);
	if (sources.length !== 1) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: "Each file entry requires exactly one of url, path, or handle",
		});
	}
};

export const SetFileSourceSchema = z
	.object({
		name: z.string().optional().describe("File name including extension"),
		mimeType: z
			.string()
			.optional()
			.describe("MIME type (defaults to application/octet-stream)"),
		url: z
			.string()
			.url()
			.optional()
			.describe("HTTP(S) URL to fetch in the target tab"),
		path: z
			.string()
			.min(1)
			.optional()
			.describe("Virtual filesystem path (resolved in worker)"),
		handle: z
			.string()
			.min(1)
			.optional()
			.describe("Binary handle from page.fetch({ store: true })"),
	})
	.superRefine(requireExactlyOneFileSource);

export const ResolvedSetFileSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("bytes"),
		name: z.string().min(1),
		data: z.string().min(1),
		mimeType: z.string().optional(),
	}),
	z.object({
		kind: z.literal("url"),
		url: z.string().url(),
		name: z.string().min(1),
		mimeType: z.string().optional(),
	}),
]);

export const PageFillParamsSchema = elementTargetParams({
	value: z.string().describe("Value to fill into the element"),
});
export const PageSetFilesParamsSchema = elementTargetParams({
	files: z
		.array(SetFileSourceSchema)
		.min(1)
		.describe("Files to attach to the input"),
});
export const ResolvedSetFilesParamsSchema = elementTargetParams({
	files: z
		.array(ResolvedSetFileSchema)
		.min(1)
		.describe("Resolved files for content-script application"),
});
export const PageTypeParamsSchema = elementTargetParams({
	text: z.string().describe("Text to type into the element"),
});
export const PageAppendParamsSchema = elementTargetParams({
	text: z.string().describe("Text to append into the element"),
});

export const PagePressParamsSchema = z.object({
	refId: refIdString()
		.optional()
		.describe(
			"Element reference ID to dispatch the key on (e.g. e2). Omit to dispatch on document.",
		),
	label: z
		.string()
		.optional()
		.describe("Human-readable element label. Omit to dispatch on document."),
	key: z.string().describe("Key to press (e.g. Enter, Escape, ArrowDown)"),
});

export const PageSelectParamsSchema = elementTargetParams({
	value: z
		.union([
			z.string().describe("Value to select in the dropdown"),
			z
				.array(z.string())
				.describe(
					"Values to select in a multiple dropdown (empty array clears selection)",
				),
		])
		.describe("Value (string) or values (array) to select in the dropdown"),
});
export const PageSelectOptionParamsSchema = elementTargetParams({
	value: z
		.string()
		.describe(
			"Visible text of the option to select (matched case-insensitively)",
		),
});
export const PageCheckParamsSchema = elementTargetParams({
	checked: z
		.boolean()
		.optional()
		.describe("Desired checked state (true to check, false to uncheck)"),
});
export const PageCheckRadioParamsSchema = z.object({
	name: z
		.string()
		.min(1)
		.describe("The `name` attribute of the radio group to pick from"),
	value: z.string().describe("The `value` of the radio option to check"),
});
export const PageHoverParamsSchema = elementTargetParams();
export const PageUnhoverParamsSchema = z.object({});
export const PageSubmitParamsSchema = elementTargetParams();

export const PageScrollParamsSchema = z.object({
	direction: z
		.string()
		.default("down")
		.describe("Scroll direction: up, down, left, or right"),
	amount: z.number().default(300).describe("Pixels to scroll"),
});

export const PageScrollToParamsSchema = z.preprocess(
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
			x: z.number().optional().describe("X coordinate to scroll to"),
			y: z.number().optional().describe("Y coordinate to scroll to"),
		})
		.superRefine(requireRefIdLabelOrCoordinates),
);
export const PageDblClickParamsSchema = elementTargetParams();

export const PageFindParamsSchema = z.object({
	selector: z.string().describe("CSS selector to find elements"),
});

export const PageDomParamsSchema = z.object({
	selector: z
		.string()
		.describe("CSS selector for the root element(s) to introspect"),
	depth: z
		.number()
		.int()
		.min(0)
		.max(10)
		.default(2)
		.describe("How many descendant levels to include (0 = root only)"),
	includeHidden: z
		.boolean()
		.default(true)
		.describe(
			"Include elements hidden by CSS/aria (default true — this tool's purpose is to see what the curated snapshot filters out)",
		),
});

export const PageWaitForParamsSchema = z.object({
	selector: z.string().describe("CSS selector to wait for"),
	timeout: bigintLike().default(30000n).describe("Timeout in milliseconds"),
});

const pageExtractShape = z.object({
	fields: z.array(z.string()).describe("Array of field names to extract"),
});
export const PageExtractParamsSchema = z.preprocess(
	(val) => (Array.isArray(val) ? { fields: val } : val),
	pageExtractShape,
) as z.ZodType<PageExtractParams>;

export const PageCloseParamsSchema = z.union([
	z.number(),
	z.array(z.object({}).passthrough()),
	z.object({}).passthrough(),
]);
export const PageActiveTabParamsSchema = z.object({});

