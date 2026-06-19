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
} from "./generated.js";

const bigintLike = () =>
	z.union([z.bigint(), z.number().finite()]).transform((v) => BigInt(v));

// ─── Storage schemas ───────────────────────────────────────────

export const StorageGetParamsSchema = z.object({
	key: z.string().describe("Storage key to retrieve"),
});

export const StorageSetParamsSchema = z.object({
	key: z.string().describe("Storage key to set"),
	value: z.string().describe("Value to store"),
});

export const StorageDeleteParamsSchema = z.object({
	key: z.string().describe("Storage key to delete"),
});

export const StorageListParamsSchema = z.object({});

const storageSetManyShape = z.object({
	items: z
		.record(z.string())
		.describe("Record of key-value string pairs to store"),
});
export type StorageSetManyParams = z.infer<typeof storageSetManyShape>;
export const StorageSetManyParamsSchema = z.preprocess((val) => {
	if (
		val !== null &&
		typeof val === "object" &&
		!Array.isArray(val) &&
		!("items" in (val as Record<string, unknown>))
	) {
		return { items: val };
	}
	return val;
}, storageSetManyShape) as z.ZodType<StorageSetManyParams>;

const storageGetManyShape = z.object({
	keys: z.array(z.string()).describe("Array of storage keys to retrieve"),
	defaults: z
		.record(z.string())
		.optional()
		.describe("Default string values for missing keys"),
});
export type StorageGetManyParams = z.infer<typeof storageGetManyShape>;
export const StorageGetManyParamsSchema = z.preprocess(
	(val) => (Array.isArray(val) ? { keys: val } : val),
	storageGetManyShape,
) as z.ZodType<StorageGetManyParams>;

export const StorageGetAllParamsSchema = z.object({});

const storageDeleteManyShape = z.object({
	keys: z.array(z.string()).describe("Array of storage keys to delete"),
});
export type StorageDeleteManyParams = z.infer<typeof storageDeleteManyShape>;
export const StorageDeleteManyParamsSchema = z.preprocess(
	(val) => (Array.isArray(val) ? { keys: val } : val),
	storageDeleteManyShape,
) as z.ZodType<StorageDeleteManyParams>;
export const StorageClearParamsSchema = z.object({});

// ─── Clipboard schemas ─────────────────────────────────────────

export const ClipboardReadParamsSchema = z.object({});

export const ClipboardWriteParamsSchema = z.union([
	z.tuple([z.union([z.object({ text: z.string() }), z.string()])]),
	z.object({ text: z.string().optional(), value: z.string().optional() }),
]);

// ─── Network / Sleep schemas ───────────────────────────────────

export const FetchParamsSchema = z
	.object({
		url: z.string().describe("URL to fetch"),
		method: z
			.string()
			.default("GET")
			.describe("HTTP method (GET, POST, PUT, DELETE, etc.)"),
		headers: z
			.record(z.string())
			.default({})
			.describe("Request headers as key-value pairs"),
		body: z.string().nullable().default(null).describe("Request body string"),
		timeout: bigintLike().default(30000n).describe("Timeout in milliseconds"),
		store: z
			.boolean()
			.optional()
			.describe(
				"When true, store binary responses as a handle instead of returning body bytes",
			),
		options: z.object({}).passthrough().optional().describe("Fetch options"),
	})
	.passthrough();

export const SleepParamsSchema = z.object({
	duration: bigintLike().describe("Duration to sleep in milliseconds"),
});

// ─── DOM interaction helpers ─────────────────────────────────────

export const refIdString = () => z.string().regex(/^e\d+$/);

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

const requireRefIdLabelOrCoordinates = (
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
const elementTargetParams = (extra?: z.ZodRawShape) =>
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

const tabIdField = {
	tabId: z.union([z.number(), z.bigint()]).optional().describe("Target tab ID"),
};

const tabElementTargetParams = (extra?: z.ZodRawShape) =>
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
	key: z.string().describe("Key to press (e.g. Enter, Escape, ArrowDown)"),
});

export const PageSelectParamsSchema = elementTargetParams({
	value: z.string().describe("Value to select in the dropdown"),
});
export const PageCheckParamsSchema = elementTargetParams({
	checked: z
		.boolean()
		.optional()
		.describe("Desired checked state (true to check, false to uncheck)"),
});
export const PageHoverParamsSchema = elementTargetParams();
export const PageUnhoverParamsSchema = z.object({});

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
export const TabCheckParamsSchema = tabElementTargetParams({
	checked: z
		.boolean()
		.optional()
		.describe("Desired checked state (true to check, false to uncheck)"),
});
export const TabHoverParamsSchema = tabElementTargetParams();
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

// ─── Sidepanel action schemas ──────────────────────────────────

export const SidepanelClickParamsSchema = elementTargetParams();
export const SidepanelDblClickParamsSchema = elementTargetParams();
export const SidepanelFillParamsSchema = elementTargetParams({
	value: z.string().optional().describe("Value to fill into the element"),
});
export const SidepanelTypeParamsSchema = elementTargetParams({
	text: z.string().optional().describe("Text to type into the element"),
});
export const SidepanelPressParamsSchema = z.object({
	key: z
		.string()
		.optional()
		.describe("Key to press (e.g. Enter, Escape, ArrowDown)"),
});
export const SidepanelSelectParamsSchema = elementTargetParams({
	value: z.string().optional().describe("Value to select in the dropdown"),
});
export const SidepanelCheckParamsSchema = elementTargetParams({
	checked: z
		.boolean()
		.optional()
		.describe("Desired checked state (true to check, false to uncheck)"),
});
export const SidepanelHoverParamsSchema = elementTargetParams();
export const SidepanelUnhoverParamsSchema = z.object({});
export const SidepanelScrollParamsSchema = z.object({
	direction: z
		.string()
		.optional()
		.describe("Scroll direction: up, down, left, or right"),
	amount: z.number().optional().describe("Pixels to scroll"),
});
export const SidepanelScrollToParamsSchema = elementTargetParams();
export const SidepanelAppendParamsSchema = elementTargetParams({
	text: z.string().optional().describe("Text to append into the element"),
});

export const SidepanelUrlParamsSchema = z.object({});
export const SidepanelTitleParamsSchema = z.object({});
export const SidepanelWaitParamsSchema = z.object({
	duration: bigintLike()
		.default(1000n)
		.describe("Duration to wait in milliseconds"),
});

export const SidepanelSnapshotParamsSchema = z.object({
	interactive_only: z
		.boolean()
		.default(false)
		.describe("Only include interactive elements"),
	max_nodes: bigintLike()
		.default(500n)
		.describe("Maximum number of nodes to include in snapshot"),
});
export const SidepanelSnapshotTextParamsSchema = z.object({
	interactive_only: z
		.boolean()
		.default(false)
		.describe("Only include interactive elements"),
	max_nodes: bigintLike()
		.default(500n)
		.describe("Maximum number of nodes to include in snapshot"),
});
export const SidepanelSnapshotDataParamsSchema = z.object({
	interactive_only: z
		.boolean()
		.default(false)
		.describe("Only include interactive elements"),
	max_nodes: bigintLike()
		.default(500n)
		.describe("Maximum number of nodes to include in snapshot"),
});

// ─── DOM schemas ───────────────────────────────────────────────

export const DomSnapshotParamsSchema = z.object({
	interactive_only: z
		.boolean()
		.default(false)
		.describe("Only include interactive elements"),
	max_nodes: bigintLike()
		.default(500n)
		.describe("Maximum number of nodes to include in snapshot"),
});

export const DomFormatParamsSchema = z.object({
	snapshot: z
		.object({})
		.passthrough()
		.describe("Raw DOM snapshot data to format"),
	format: z.string().optional().describe("Output format (e.g. markdown, html)"),
});

// ─── Page snapshot schemas ─────────────────────────────────────

export const PageSnapshotParamsSchema = z
	.object({
		max_nodes: z.number().optional().describe("Maximum nodes to include"),
		options: z.object({}).passthrough().optional().describe("Snapshot options"),
	})
	.passthrough();
export const PageSnapshotTextParamsSchema = z
	.object({
		max_nodes: z.number().optional().describe("Maximum nodes to include"),
		options: z.object({}).passthrough().optional().describe("Snapshot options"),
	})
	.passthrough();
export const PageSnapshotDataParamsSchema = z
	.object({
		max_nodes: z.number().optional().describe("Maximum nodes to include"),
		options: z.object({}).passthrough().optional().describe("Snapshot options"),
	})
	.passthrough();

export const SnapshotQueryFilterSchema = z
	.object({
		role: z
			.union([z.string(), z.array(z.string())])
			.optional()
			.describe("Filter by ARIA role"),
		tag: z
			.union([z.string(), z.array(z.string())])
			.optional()
			.describe("Filter by HTML tag"),
		text: z
			.string()
			.optional()
			.describe("Filter by text content (case-insensitive substring)"),
		name: z
			.string()
			.optional()
			.describe("Filter by accessible name (case-insensitive substring)"),
		interactiveOnly: z
			.boolean()
			.optional()
			.describe("Only include interactive elements"),
		href: z
			.string()
			.optional()
			.describe("Filter by href pattern (case-insensitive substring)"),
		src: z
			.string()
			.optional()
			.describe("Filter by src pattern (case-insensitive substring)"),
		limit: z
			.number()
			.positive()
			.optional()
			.describe("Maximum filtered nodes to return"),
	})
	.passthrough();

export const PageSnapshotQueryParamsSchema = z
	.object({
		filter: SnapshotQueryFilterSchema.optional().describe(
			"Semantic filter criteria",
		),
		max_nodes: z
			.number()
			.optional()
			.describe("Maximum nodes to collect before filtering"),
	})
	.passthrough();

export const TabSnapshotQueryParamsSchema =
	PageSnapshotQueryParamsSchema.extend({
		tabId: z.number().describe("Tab ID"),
	});

// ─── Filesystem schemas ────────────────────────────────────────

export const FsPathParamsSchema = z.object({
	path: z.string().describe("File or directory path"),
});

export const FsCopyParamsSchema = z.object({
	from: z.string().describe("Source path"),
	to: z.string().describe("Destination path"),
});

export const FsWriteParamsSchema = z.object({
	path: z.string().describe("File path to write to"),
	data: z.string().describe("Data to write"),
});

export const FsReadRangeParamsSchema = z.object({
	path: z.string().describe("File path to read from"),
	offset: bigintLike().describe("Byte offset to start reading"),
	len: z.number().describe("Number of bytes to read"),
});

export const FsUpdateParamsSchema = z.object({
	path: z.string().describe("File path to update"),
	offset: bigintLike().describe("Byte offset to start writing"),
	data: z.string().describe("Data to write"),
});

export const FsHashParamsSchema = z.object({
	path: z.string().describe("File path to hash"),
	algo: z
		.string()
		.default("sha256")
		.describe("Hash algorithm (e.g. sha256, md5)"),
});

// ─── Chrome passthrough schemas ────────────────────────────────

export const ChromeRuntimeSendMessageParamsSchema = z.record(z.unknown());
export const ChromeTabsQueryParamsSchema = z.record(z.unknown());
export const ChromeTabsCreateParamsSchema = z.record(z.unknown());
export const ChromeTabsUpdateParamsSchema = z.record(z.unknown());
export const ChromeTabsRemoveParamsSchema = z.union([
	z.number(),
	z.record(z.unknown()),
]);
export const ChromeTabsGetParamsSchema = z.union([
	z.number(),
	z.record(z.unknown()),
]);
export const ChromeTabsReloadParamsSchema = z.record(z.unknown());
export const ChromeTabsSendMessageParamsSchema = z.record(z.unknown());

export const ChromeAlarmsCreateParamsSchema = z.record(z.unknown());
export const ChromeAlarmsClearParamsSchema = z.union([
	z.string(),
	z.record(z.unknown()),
]);

export const ChromeActionSetBadgeTextParamsSchema = z.record(z.unknown());
export const ChromeActionSetBadgeBackgroundColorParamsSchema = z.record(
	z.unknown(),
);
export const ChromeActionSetTitleParamsSchema = z.record(z.unknown());
export const ChromeActionSetIconParamsSchema = z.record(z.unknown());

export const ChromeContextMenusCreateParamsSchema = z.record(z.unknown());
export const ChromeContextMenusRemoveParamsSchema = z.union([
	z.string(),
	z.number(),
	z.record(z.unknown()),
]);

export const ChromeWindowsGetAllParamsSchema = z.record(z.unknown());
export const ChromeWindowsCreateParamsSchema = z.record(z.unknown());
export const ChromeWindowsUpdateParamsSchema = z.record(z.unknown());
export const ChromeWindowsRemoveParamsSchema = z.union([
	z.number(),
	z.record(z.unknown()),
]);

export const ChromeSidePanelSetOptionsParamsSchema = z.record(z.unknown());

export const ChromeCookiesGetParamsSchema = z.record(z.unknown());
export const ChromeCookiesSetParamsSchema = z.record(z.unknown());
export const ChromeCookiesRemoveParamsSchema = z.record(z.unknown());
export const ChromeCookiesGetAllParamsSchema = z.record(z.unknown());

/** Opaque argument array for native-parity Chrome API transport. */
export const NativeArgsSchema = z.array(z.unknown());

export const ChromeBookmarksSearchParamsSchema = z.union([
	z.string(),
	z.record(z.unknown()),
]);
export const ChromeBookmarksCreateParamsSchema = z.record(z.unknown());
export const ChromeBookmarksRemoveParamsSchema = z.union([
	z.string(),
	z.record(z.unknown()),
]);

export const ChromeHistorySearchParamsSchema = z.record(z.unknown());
export const ChromeHistoryDeleteUrlParamsSchema = z.union([
	z.string(),
	z.record(z.unknown()),
]);

export const ChromeNotificationsCreateParamsSchema = z.record(z.unknown());
export const ChromeNotificationsClearParamsSchema = z.union([
	z.string(),
	z.record(z.unknown()),
]);

export const ChromeScriptingExecuteScriptParamsSchema = z.record(z.unknown());

export const ChromeTabGroupsQueryParamsSchema = z.record(z.unknown());
export const ChromeTabGroupsGetParamsSchema = z.union([
	z.number(),
	z.record(z.unknown()),
]);
export const ChromeTabGroupsUpdateParamsSchema = z.record(z.unknown());

export const ChromeTabsGroupParamsSchema = z.record(z.unknown());
export const ChromeTabsUngroupParamsSchema = z.union([
	z.number(),
	z.record(z.unknown()),
]);

export const ChromeSessionsGetRecentlyClosedParamsSchema = z.record(
	z.unknown(),
);
export const ChromeSessionsRestoreParamsSchema = z.union([
	z.string(),
	z.number(),
	z.record(z.unknown()),
]);
export const ChromeSessionsGetDevicesParamsSchema = z.record(z.unknown());

export const ChromeDownloadsDownloadParamsSchema = z.record(z.unknown());
export const ChromeDownloadsSearchParamsSchema = z.record(z.unknown());
export const ChromeDownloadsEraseParamsSchema = z.record(z.unknown());
export const ChromeDownloadsPauseParamsSchema = z.union([
	z.number(),
	z.record(z.unknown()),
]);
export const ChromeDownloadsResumeParamsSchema = z.union([
	z.number(),
	z.record(z.unknown()),
]);
export const ChromeDownloadsCancelParamsSchema = z.union([
	z.number(),
	z.record(z.unknown()),
]);
export const ChromeDownloadsOpenParamsSchema = z.union([
	z.number(),
	z.record(z.unknown()),
]);
export const ChromeDownloadsShowParamsSchema = z.union([
	z.number(),
	z.record(z.unknown()),
]);

export const ChromeSystemCpuGetInfoParamsSchema = z.record(z.unknown());
export const ChromeSystemMemoryGetInfoParamsSchema = z.record(z.unknown());
export const ChromeSystemStorageGetInfoParamsSchema = z.record(z.unknown());

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

// ─── Return value schemas ──────────────────────────────────────

export const PageActionResultSchema = z.object({
	ok: z.literal(true).describe("Whether the action succeeded"),
	action: z.string().describe("Action identifier (e.g. 'page_fill')"),
	refId: refIdString()
		.optional()
		.describe("Element reference ID that was acted upon (e.g. e2)"),
	tag: z.string().optional().describe("HTML tag name of the element"),
	role: z.string().optional().describe("ARIA role of the element"),
	name: z.string().optional().describe("Accessible name of the element"),
	value: z
		.string()
		.optional()
		.describe("Final value of the element after the action"),
	checked: z.boolean().optional().describe("Checked state after the action"),
	disabled: z.boolean().optional().describe("Whether the element is disabled"),
	readOnly: z.boolean().optional().describe("Whether the element is read-only"),
	text: z.string().optional().describe("Text content of the element"),
	key: z
		.string()
		.optional()
		.describe("Key that was pressed (for press actions)"),
	direction: z
		.string()
		.optional()
		.describe("Scroll direction (for scroll actions)"),
	amount: z
		.number()
		.optional()
		.describe("Scroll amount in pixels (for scroll actions)"),
	fileCount: z
		.number()
		.optional()
		.describe("Number of files attached (for setFiles actions)"),
	fileNames: z
		.array(z.string())
		.optional()
		.describe("Names of attached files (for setFiles actions)"),
	observationId: z
		.string()
		.optional()
		.describe(
			"Opaque ID of the observation lease authorizing this action (snapshot-scoped)",
		),
	dispatched: z
		.literal(true)
		.optional()
		.describe(
			"True if the action was dispatched to the DOM. Does NOT prove the application accepted it.",
		),
	verification: z
		.literal("required")
		.optional()
		.describe(
			"Always 'required': a fresh observation is required to verify the effect.",
		),
});

export type PageActionResult = z.infer<typeof PageActionResultSchema>;

/** @deprecated Use PageActionResultSchema directly; handlers no longer return null. */
export const MutationReturnSchema = z.union([PageActionResultSchema, z.null()]);

export const FetchValueSchema = z.object({
	status: z.number().describe("HTTP response status code"),
	ok: z.boolean().describe("Whether the response status is 2xx"),
	headers: z.record(z.string()).describe("Response headers as key-value pairs"),
	body: z
		.string()
		.optional()
		.describe("Response body (omitted when bodyEncoding is handle)"),
	bodyEncoding: z
		.enum(["text", "base64", "handle"])
		.describe("Encoding of the body field"),
	handle: z
		.string()
		.optional()
		.describe("Binary handle when bodyEncoding is handle"),
	byteLength: z.number().describe("Length of the body in bytes"),
	contentType: z.string().describe("Response Content-Type header"),
	finalUrl: z.string().describe("Final URL after redirects"),
});

export const DomSnapshotValueSchema = z.object({
	data: z.object({}).passthrough().describe("Structured snapshot data"),
	text: z.string().describe("Plain text representation of the snapshot"),
});

export const PageHealthParamsSchema = z.object({});

export const PageHealthResultSchema = z.object({
	tabId: z.number(),
	url: z.string(),
	title: z.string(),
	contentScript: z.enum(["connected", "missing"]),
	domApis: z.enum(["ok", "blocked"]),
	mutationsReady: z.boolean(),
	hint: z.string().optional(),
	recovery: z.array(z.string()).optional(),
});

export const TabEvaluateResultSchema = JsonSerializableResultSchema;

export const SnapshotNodeSchema = z.object({
	refId: refIdString().describe("Element reference ID (e.g. e2)"),
	role: z.string().describe("ARIA role of the element"),
	tag: z.string().describe("HTML tag name"),
	name: z.string().optional().describe("Accessible name of the element"),
	text: z.string().optional().describe("Visible text content of the element"),
	value: z.string().optional().describe("Element value"),
	checked: z.boolean().optional().describe("Checked state"),
	disabled: z.boolean().optional().describe("Whether the element is disabled"),
	readOnly: z.boolean().optional().describe("Whether the element is read-only"),
	href: z.string().optional().describe("Absolute URL for link elements"),
	src: z.string().optional().describe("Absolute URL for image elements"),
	alt: z.string().optional().describe("Alternative text for image elements"),
	title: z.string().optional().describe("Title attribute"),
	parentRefId: refIdString()
		.optional()
		.describe("Reference ID of the parent container element"),
	postId: z
		.string()
		.optional()
		.describe("Stable post identifier from data-post-id attribute"),
	permalink: z
		.string()
		.optional()
		.describe("Stable permalink URL from anchor element"),
	imageUrls: z
		.array(z.string())
		.optional()
		.describe("Image URLs contained within this element"),
});

export const SnapshotResultSchema = z.object({
	text: z.string().describe("Plain text representation of the page"),
	nodes: z.array(SnapshotNodeSchema).describe("Array of interactive nodes"),
	url: z.string().describe("Current page URL"),
	title: z.string().describe("Current page title"),
	viewport: z
		.object({
			width: z.number().describe("Viewport width in pixels"),
			height: z.number().describe("Viewport height in pixels"),
		})
		.describe("Viewport dimensions"),
	observationId: z
		.string()
		.optional()
		.describe(
			"Opaque ID of the observation lease granted by this snapshot. Pass to subsequent actions to prove they act on fresh observations.",
		),
});

export const ChromeTabSchema = z
	.object({
		id: z.number().optional().describe("Tab ID"),
		tabId: z.number().optional().describe("Tab ID (added by runner)"),
		index: z.number().optional().describe("Tab index in the window"),
		windowId: z.number().optional().describe("Window ID"),
		url: z.string().optional().describe("Tab URL"),
		title: z.string().optional().describe("Tab title"),
		status: z.string().optional().describe("Tab status (loading or complete)"),
		active: z.boolean().optional().describe("Whether the tab is active"),
		pinned: z.boolean().optional().describe("Whether the tab is pinned"),
		highlighted: z
			.boolean()
			.optional()
			.describe("Whether the tab is highlighted"),
		incognito: z.boolean().optional().describe("Whether the tab is incognito"),
		favIconUrl: z.string().optional().describe("Favicon URL"),
		audible: z.boolean().optional().describe("Whether the tab is audible"),
		groupId: z.number().optional().describe("Group ID"),
		openerTabId: z.number().optional().describe("Opener tab ID"),
		discarded: z.boolean().optional().describe("Whether the tab is discarded"),
		autoDiscardable: z
			.boolean()
			.optional()
			.describe("Whether the tab is auto-discardable"),
		width: z.number().optional().describe("Tab width"),
		height: z.number().optional().describe("Tab height"),
		sessionId: z.string().optional().describe("Session ID"),
	})
	.passthrough();
export const ChromeTabArraySchema = z.array(ChromeTabSchema);

export const ChromeWindowSchema = z
	.object({
		id: z.number().optional().describe("Window ID"),
		focused: z.boolean().optional().describe("Whether the window is focused"),
		top: z.number().optional().describe("Window top position"),
		left: z.number().optional().describe("Window left position"),
		width: z.number().optional().describe("Window width"),
		height: z.number().optional().describe("Window height"),
		tabs: ChromeTabArraySchema.optional().describe(
			"Array of tabs in the window",
		),
		incognito: z
			.boolean()
			.optional()
			.describe("Whether the window is incognito"),
		type: z.string().optional().describe("Window type"),
		state: z.string().optional().describe("Window state"),
		alwaysOnTop: z
			.boolean()
			.optional()
			.describe("Whether the window is always on top"),
		sessionId: z.string().optional().describe("Session ID"),
	})
	.passthrough();
export const ChromeWindowArraySchema = z.array(ChromeWindowSchema);

export const ChromeCookieSchema = z
	.object({
		name: z.string().describe("Cookie name"),
		value: z.string().describe("Cookie value"),
		domain: z.string().optional().describe("Cookie domain"),
		hostOnly: z
			.boolean()
			.optional()
			.describe("Whether the cookie is host-only"),
		path: z.string().optional().describe("Cookie path"),
		secure: z.boolean().optional().describe("Whether the cookie is secure"),
		httpOnly: z
			.boolean()
			.optional()
			.describe("Whether the cookie is HTTP-only"),
		sameSite: z.string().optional().describe("SameSite policy"),
		session: z
			.boolean()
			.optional()
			.describe("Whether the cookie is a session cookie"),
		expirationDate: z
			.number()
			.optional()
			.describe("Expiration date as Unix timestamp"),
		storeId: z.string().optional().describe("Store ID"),
	})
	.nullable();
export const ChromeCookieArraySchema = z.array(
	ChromeCookieSchema.nullable().unwrap(),
);

export const ChromeBookmarkSchema = z
	.object({
		id: z.string().describe("Bookmark ID"),
		parentId: z.string().optional().describe("Parent folder ID"),
		index: z.number().optional().describe("Bookmark index"),
		url: z.string().optional().describe("Bookmark URL"),
		title: z.string().describe("Bookmark title"),
		dateAdded: z.number().optional().describe("Date added"),
		dateGroupModified: z.number().optional().describe("Date group modified"),
		children: z
			.array(z.object({ id: z.string() }).passthrough())
			.optional()
			.describe("Child bookmarks"),
	})
	.passthrough();
export const ChromeBookmarkArraySchema = z.array(ChromeBookmarkSchema);

export const ChromeHistoryItemSchema = z
	.object({
		id: z.string().describe("History item ID"),
		url: z.string().optional().describe("URL"),
		title: z.string().optional().describe("Title"),
		lastVisitTime: z.number().optional().describe("Last visit time"),
		visitCount: z.number().optional().describe("Visit count"),
		typedCount: z.number().optional().describe("Typed count"),
	})
	.passthrough();
export const ChromeHistoryArraySchema = z.array(ChromeHistoryItemSchema);

export const ChromeScriptResultItemSchema = z.object({
	frameId: z.number().describe("Frame ID"),
	result: z.unknown().optional().describe("Script result"),
});
export const ChromeScriptResultSchema = z.array(ChromeScriptResultItemSchema);

export const ChromeNotificationIdSchema = z.string();
export const ChromeNotificationClearSchema = z.boolean();
export const ChromeMenuItemIdSchema = z.union([z.string(), z.number()]);
export const ChromeAlarmsClearSchema = z.boolean();

export const ChromeTabGroupSchema = z
	.object({
		id: z.number().optional().describe("Group ID"),
		collapsed: z
			.boolean()
			.optional()
			.describe("Whether the group is collapsed"),
		color: z.string().optional().describe("Group color"),
		title: z.string().optional().describe("Group title"),
		windowId: z.number().optional().describe("Window ID"),
	})
	.passthrough();
export const ChromeTabGroupArraySchema = z.array(ChromeTabGroupSchema);

export const ChromeSessionSchema = z
	.object({
		lastModified: z.number().optional().describe("Last modified time"),
		tab: ChromeTabSchema.optional().describe("Tab info"),
		window: ChromeWindowSchema.optional().describe("Window info"),
	})
	.passthrough();
export const ChromeSessionArraySchema = z.array(ChromeSessionSchema);

export const ChromeDeviceSchema = z
	.object({
		deviceName: z.string().optional().describe("Device name"),
		sessions: ChromeSessionArraySchema.optional().describe("Sessions"),
	})
	.passthrough();
export const ChromeDeviceArraySchema = z.array(ChromeDeviceSchema);

export const ChromeDownloadSchema = z
	.object({
		id: z.number().optional().describe("Download ID"),
		url: z.string().optional().describe("Download URL"),
		filename: z.string().optional().describe("Filename"),
		startTime: z.string().optional().describe("Start time"),
		endTime: z.string().optional().describe("End time"),
		state: z.string().optional().describe("Download state"),
		danger: z.string().optional().describe("Danger type"),
		paused: z.boolean().optional().describe("Whether the download is paused"),
		error: z.string().optional().describe("Error message"),
		bytesReceived: z.number().optional().describe("Bytes received"),
		totalBytes: z.number().optional().describe("Total bytes"),
		fileSize: z.number().optional().describe("File size"),
		mime: z.string().optional().describe("MIME type"),
		incognito: z
			.boolean()
			.optional()
			.describe("Whether the download is incognito"),
		referrer: z.string().optional().describe("Referrer URL"),
		byExtensionId: z.string().optional().describe("Extension ID"),
		byExtensionName: z.string().optional().describe("Extension name"),
	})
	.passthrough();
export const ChromeDownloadArraySchema = z.array(ChromeDownloadSchema);
export const ChromeDownloadIdSchema = z.number();

export const ChromeSystemCpuInfoSchema = z.object({
	archName: z.string().describe("CPU architecture"),
	modelName: z.string().describe("CPU model"),
	numOfProcessors: z.number().describe("Number of processors"),
	features: z.array(z.string()).describe("CPU features"),
});
export const ChromeSystemMemoryInfoSchema = z.object({
	capacity: z.number().describe("Total memory capacity"),
	availableCapacity: z.number().describe("Available memory capacity"),
});
export const ChromeSystemStorageInfoSchema = z.array(
	z.object({
		id: z.string().describe("Storage ID"),
		name: z.string().describe("Storage name"),
		type: z.string().describe("Storage type"),
		capacity: z.number().describe("Storage capacity"),
	}),
);

// ─── Type-satisfaction checks ──────────────────────────────────
// Ensure zod-inferred types align with ts-rs generated types.

type _AssertFetch =
	z.infer<typeof FetchParamsSchema> extends FetchParams ? true : never;
type _AssertFetchReverse =
	FetchParams extends z.infer<typeof FetchParamsSchema> ? true : never;

type _AssertStorageGet =
	z.infer<typeof StorageGetParamsSchema> extends StorageGetParams
		? true
		: never;
type _AssertStorageSet =
	z.infer<typeof StorageSetParamsSchema> extends StorageSetParams
		? true
		: never;
type _AssertStorageDelete =
	z.infer<typeof StorageDeleteParamsSchema> extends StorageDeleteParams
		? true
		: never;

type _AssertSleep =
	z.infer<typeof SleepParamsSchema> extends SleepParams ? true : never;
type _AssertSleepReverse =
	SleepParams extends z.infer<typeof SleepParamsSchema> ? true : never;

type _AssertPageGoto =
	z.infer<typeof PageGotoParamsSchema> extends PageGotoParams ? true : never;
type _AssertPageGotoReverse =
	PageGotoParams extends z.infer<typeof PageGotoParamsSchema> ? true : never;

type _AssertPagePress =
	z.infer<typeof PagePressParamsSchema> extends PagePressParams ? true : never;
type _AssertPagePressReverse =
	PagePressParams extends z.infer<typeof PagePressParamsSchema> ? true : never;

type _AssertPageScroll =
	z.infer<typeof PageScrollParamsSchema> extends PageScrollParams
		? true
		: never;
type _AssertPageScrollReverse =
	PageScrollParams extends z.infer<typeof PageScrollParamsSchema>
		? true
		: never;

type _AssertPageScrollTo =
	z.infer<typeof PageScrollToParamsSchema> extends PageScrollToParams
		? true
		: never;
type _AssertPageScrollToReverse =
	PageScrollToParams extends z.infer<typeof PageScrollToParamsSchema>
		? true
		: never;

type _AssertPageFind =
	z.infer<typeof PageFindParamsSchema> extends PageFindParams ? true : never;
type _AssertPageFindReverse =
	PageFindParams extends z.infer<typeof PageFindParamsSchema> ? true : never;

type _AssertPageWaitFor =
	z.infer<typeof PageWaitForParamsSchema> extends PageWaitForParams
		? true
		: never;
type _AssertPageWaitForReverse =
	PageWaitForParams extends z.infer<typeof PageWaitForParamsSchema>
		? true
		: never;

type _AssertPageWait =
	z.infer<typeof PageWaitParamsSchema> extends PageWaitParams ? true : never;
type _AssertPageWaitReverse =
	PageWaitParams extends z.infer<typeof PageWaitParamsSchema> ? true : never;

type _AssertPageFill =
	z.infer<typeof PageFillParamsSchema> extends PageFillParams ? true : never;
type _AssertPageSetFiles =
	z.infer<typeof PageSetFilesParamsSchema> extends PageSetFilesParams
		? true
		: never;
type _AssertPageSetFilesReverse =
	PageSetFilesParams extends z.infer<typeof PageSetFilesParamsSchema>
		? true
		: never;
type _AssertPageType =
	z.infer<typeof PageTypeParamsSchema> extends PageTypeParams ? true : never;
type _AssertPageCheck =
	z.infer<typeof PageCheckParamsSchema> extends PageCheckParams ? true : never;
type _AssertPageSelect =
	z.infer<typeof PageSelectParamsSchema> extends PageSelectParams
		? true
		: never;

type _AssertPageExtract =
	z.infer<typeof PageExtractParamsSchema> extends PageExtractParams
		? true
		: never;
type _AssertPageExtractReverse =
	PageExtractParams extends z.infer<typeof PageExtractParamsSchema>
		? true
		: never;

type _AssertFsPath =
	z.infer<typeof FsPathParamsSchema> extends FsPathParams ? true : never;
type _AssertFsPathReverse =
	FsPathParams extends z.infer<typeof FsPathParamsSchema> ? true : never;

type _AssertFsCopy =
	z.infer<typeof FsCopyParamsSchema> extends FsCopyParams ? true : never;
type _AssertFsCopyReverse =
	FsCopyParams extends z.infer<typeof FsCopyParamsSchema> ? true : never;

type _AssertFsWrite =
	z.infer<typeof FsWriteParamsSchema> extends FsWriteParams ? true : never;
type _AssertFsWriteReverse =
	FsWriteParams extends z.infer<typeof FsWriteParamsSchema> ? true : never;

type _AssertFsReadRange =
	z.infer<typeof FsReadRangeParamsSchema> extends FsReadRangeParams
		? true
		: never;
type _AssertFsReadRangeReverse =
	FsReadRangeParams extends z.infer<typeof FsReadRangeParamsSchema>
		? true
		: never;

type _AssertFsUpdate =
	z.infer<typeof FsUpdateParamsSchema> extends FsUpdateParams ? true : never;
type _AssertFsUpdateReverse =
	FsUpdateParams extends z.infer<typeof FsUpdateParamsSchema> ? true : never;

type _AssertFsHash =
	z.infer<typeof FsHashParamsSchema> extends FsHashParams ? true : never;
type _AssertFsHashReverse =
	FsHashParams extends z.infer<typeof FsHashParamsSchema> ? true : never;

type _AssertDomSnapshot =
	z.infer<typeof DomSnapshotParamsSchema> extends DomSnapshotParams
		? true
		: never;
type _AssertDomSnapshotReverse =
	DomSnapshotParams extends z.infer<typeof DomSnapshotParamsSchema>
		? true
		: never;

type _AssertStorageGetReverse =
	StorageGetParams extends z.infer<typeof StorageGetParamsSchema>
		? true
		: never;
type _AssertStorageSetReverse =
	StorageSetParams extends z.infer<typeof StorageSetParamsSchema>
		? true
		: never;
type _AssertStorageDeleteReverse =
	StorageDeleteParams extends z.infer<typeof StorageDeleteParamsSchema>
		? true
		: never;
