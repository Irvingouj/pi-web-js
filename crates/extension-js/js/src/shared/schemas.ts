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
	key: z.string(),
});

export const StorageSetParamsSchema = z.object({
	key: z.string(),
	value: z.string(),
});

export const StorageDeleteParamsSchema = z.object({
	key: z.string(),
});

export const StorageListParamsSchema = z.object({});

const storageSetManyShape = z.object({
	items: z.record(z.unknown()),
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
	keys: z.array(z.string()),
	defaults: z.record(z.unknown()).optional(),
});
export type StorageGetManyParams = z.infer<typeof storageGetManyShape>;
export const StorageGetManyParamsSchema = z.preprocess(
	(val) => (Array.isArray(val) ? { keys: val } : val),
	storageGetManyShape,
) as z.ZodType<StorageGetManyParams>;

export const StorageGetAllParamsSchema = z.object({});

const storageDeleteManyShape = z.object({
	keys: z.array(z.string()),
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

export const FetchParamsSchema = z.object({
	url: z.string(),
	method: z.string().default("GET"),
	headers: z.record(z.string()).default({}),
	body: z.string().nullable().default(null),
	timeout: bigintLike().default(30000n),
});

export const SleepParamsSchema = z.object({
	duration: bigintLike(),
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
				__invalidPositional: z.union([z.string(), z.number()]).optional(),
				refId: refIdString().optional(),
				label: z.string().optional(),
				...extra,
			})
			.superRefine(requireRefIdOrLabel),
	);

const tabIdField = { tabId: z.union([z.number(), z.bigint()]).optional() };

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
				__invalidPositional: z.union([z.string(), z.number()]).optional(),
				...tabIdField,
				refId: refIdString().optional(),
				label: z.string().optional(),
				...extra,
			})
			.superRefine(requireRefIdOrLabel),
	);

// ─── Page action schemas ───────────────────────────────────────

export const PageUrlParamsSchema = z.object({});
export const PageTitleParamsSchema = z.object({});

export const PageGotoParamsSchema = z.object({
	url: z.string(),
	timeout: bigintLike().optional(),
});

export const PageBackParamsSchema = z.object({});
export const PageForwardParamsSchema = z.object({});
export const PageReloadParamsSchema = z.object({});

export const PageWaitParamsSchema = z.object({
	duration: bigintLike().default(1000n),
});

export const PageClickParamsSchema = elementTargetParams();
export const PageFillParamsSchema = elementTargetParams({ value: z.string() });
export const PageTypeParamsSchema = elementTargetParams({ text: z.string() });
export const PageAppendParamsSchema = elementTargetParams({ text: z.string() });

export const PagePressParamsSchema = z.object({
	key: z.string(),
});

export const PageSelectParamsSchema = elementTargetParams({ value: z.string() });
export const PageCheckParamsSchema = elementTargetParams({
	checked: z.boolean().optional(),
});
export const PageHoverParamsSchema = elementTargetParams();
export const PageUnhoverParamsSchema = z.object({});

export const PageScrollParamsSchema = z.object({
	direction: z.string().default("down"),
	amount: z.number().default(300),
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
			__invalidPositional: z.union([z.string(), z.number()]).optional(),
			refId: refIdString().optional(),
			label: z.string().optional(),
			x: z.number().optional(),
			y: z.number().optional(),
		})
		.superRefine(requireRefIdLabelOrCoordinates),
);
export const PageDblClickParamsSchema = elementTargetParams();

export const PageFindParamsSchema = z.object({
	selector: z.string(),
});

export const PageWaitForParamsSchema = z.object({
	selector: z.string(),
	timeout: bigintLike().default(30000n),
});

const pageExtractShape = z.object({
	fields: z.array(z.string()),
});
export const PageExtractParamsSchema = z.preprocess(
	(val) => (Array.isArray(val) ? { fields: val } : val),
	pageExtractShape,
) as z.ZodType<PageExtractParams>;

export const PageCloseParamsSchema = z.union([
	z.number(),
	z.array(z.unknown()),
	z.record(z.unknown()),
]);
export const PageActiveTabParamsSchema = z.object({});

// ─── Tab action schemas ────────────────────────────────────────

export const TabQueryParamsSchema = z.record(z.unknown());
export const TabCreateParamsSchema = z.preprocess(
	(val) => (typeof val === "string" ? { url: val } : val),
	z.object({
		url: z.string().optional(),
		active: z.boolean().optional(),
	}),
);
export const TabActivateParamsSchema = z.union([
	z.number(),
	z.array(z.unknown()),
	z.record(z.unknown()),
]);
export const TabCloseParamsSchema = z.union([
	z.number(),
	z.array(z.unknown()),
	z.record(z.unknown()),
]);
export const TabExecuteScriptParamsSchema = z.record(z.unknown());

export const TabClickParamsSchema = tabElementTargetParams();
export const TabFillParamsSchema = tabElementTargetParams({ value: z.string() });
export const TabScrollToParamsSchema = z.preprocess(
	(val) => {
		if (typeof val === "string" || typeof val === "number") {
			return { __invalidPositional: val };
		}
		return val;
	},
	z
		.object({
			__invalidPositional: z.union([z.string(), z.number()]).optional(),
			...tabIdField,
			refId: refIdString().optional(),
			label: z.string().optional(),
			x: z.number().optional(),
			y: z.number().optional(),
		})
		.superRefine(requireRefIdLabelOrCoordinates),
);
export const TabTypeParamsSchema = tabElementTargetParams({ text: z.string() });
export const TabPressParamsSchema = z.object({
	...tabIdField,
	key: z.string(),
});
export const TabSelectParamsSchema = tabElementTargetParams({ value: z.string() });
export const TabCheckParamsSchema = tabElementTargetParams({
	checked: z.boolean().optional(),
});
export const TabHoverParamsSchema = tabElementTargetParams();
export const TabUnhoverParamsSchema = z.object({
	...tabIdField,
});
export const TabScrollParamsSchema = z.object({
	...tabIdField,
	direction: z.string().default("down"),
	amount: z.number().default(300),
});
export const TabDblClickParamsSchema = tabElementTargetParams();

export const TabEvaluateParamsSchema = z.record(z.unknown());
export const TabBackParamsSchema = z.record(z.unknown());
export const TabWaitForLoadParamsSchema = z.record(z.unknown());
export const TabFetchParamsSchema = z.record(z.unknown());

export const TabSnapshotParamsSchema = z.record(z.unknown());
export const TabSnapshotTextParamsSchema = z.record(z.unknown());
export const TabSnapshotDataParamsSchema = z.record(z.unknown());

// ─── Sidepanel action schemas ──────────────────────────────────

export const SidepanelClickParamsSchema = elementTargetParams();
export const SidepanelDblClickParamsSchema = elementTargetParams();
export const SidepanelFillParamsSchema = elementTargetParams({
	value: z.string().optional(),
});
export const SidepanelTypeParamsSchema = elementTargetParams({
	text: z.string().optional(),
});
export const SidepanelPressParamsSchema = z.object({
	key: z.string().optional(),
});
export const SidepanelSelectParamsSchema = elementTargetParams({
	value: z.string().optional(),
});
export const SidepanelCheckParamsSchema = elementTargetParams({
	checked: z.boolean().optional(),
});
export const SidepanelHoverParamsSchema = elementTargetParams();
export const SidepanelUnhoverParamsSchema = z.object({});
export const SidepanelScrollParamsSchema = z.object({
	direction: z.string().optional(),
	amount: z.number().optional(),
});
export const SidepanelScrollToParamsSchema = elementTargetParams();
export const SidepanelAppendParamsSchema = elementTargetParams({
	text: z.string().optional(),
});

export const SidepanelUrlParamsSchema = z.object({});
export const SidepanelTitleParamsSchema = z.object({});
export const SidepanelWaitParamsSchema = z.object({
	duration: bigintLike().default(1000n),
});

export const SidepanelSnapshotParamsSchema = z.object({
	interactive_only: z.boolean().default(false),
	max_nodes: bigintLike().default(500n),
});
export const SidepanelSnapshotTextParamsSchema = z.object({
	interactive_only: z.boolean().default(false),
	max_nodes: bigintLike().default(500n),
});
export const SidepanelSnapshotDataParamsSchema = z.object({
	interactive_only: z.boolean().default(false),
	max_nodes: bigintLike().default(500n),
});

// ─── DOM schemas ───────────────────────────────────────────────

export const DomSnapshotParamsSchema = z.object({
	interactive_only: z.boolean().default(false),
	max_nodes: bigintLike().default(500n),
});

export const DomFormatParamsSchema = z.object({
	snapshot: z.unknown(),
	format: z.string().optional(),
});

// ─── Page snapshot schemas ─────────────────────────────────────

export const PageSnapshotParamsSchema = z.record(z.unknown());
export const PageSnapshotTextParamsSchema = z.record(z.unknown());
export const PageSnapshotDataParamsSchema = z.record(z.unknown());

// ─── Filesystem schemas ────────────────────────────────────────

export const FsPathParamsSchema = z.object({
	path: z.string(),
});

export const FsCopyParamsSchema = z.object({
	from: z.string(),
	to: z.string(),
});

export const FsWriteParamsSchema = z.object({
	path: z.string(),
	data: z.string(),
});

export const FsReadRangeParamsSchema = z.object({
	path: z.string(),
	offset: bigintLike(),
	len: z.number(),
});

export const FsUpdateParamsSchema = z.object({
	path: z.string(),
	offset: bigintLike(),
	data: z.string(),
});

export const FsHashParamsSchema = z.object({
	path: z.string(),
	algo: z.string().default("sha256"),
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

export const HostCallParamsSchema = z.record(z.unknown());

// ─── Return value schemas ──────────────────────────────────────

export const FetchValueSchema = z.object({
	status: z.number(),
	ok: z.boolean(),
	headers: z.record(z.string()),
	body: z.string(),
});

export const DomSnapshotValueSchema = z.object({
	data: z.unknown(),
	text: z.string(),
});

export const SnapshotNodeSchema = z.object({
	refId: refIdString(),
	role: z.string(),
	tag: z.string(),
	name: z.string().optional(),
});

export const SnapshotResultSchema = z.object({
	text: z.string(),
	nodes: z.array(SnapshotNodeSchema),
	url: z.string(),
	title: z.string(),
	viewport: z.object({
		width: z.number(),
		height: z.number(),
	}),
});

export const ChromeTabSchema = z.record(z.unknown());
export const ChromeTabArraySchema = z.array(ChromeTabSchema);
export const ChromeWindowSchema = z.record(z.unknown());
export const ChromeWindowArraySchema = z.array(ChromeWindowSchema);
export const ChromeCookieSchema = z.record(z.unknown()).nullable();
export const ChromeCookieArraySchema = z.array(z.record(z.unknown()));
export const ChromeBookmarkArraySchema = z.array(z.record(z.unknown()));
export const ChromeHistoryArraySchema = z.array(z.record(z.unknown()));
export const ChromeScriptResultSchema = z.array(z.record(z.unknown()));
export const ChromeNotificationIdSchema = z.string();
export const ChromeNotificationClearSchema = z.boolean();
export const ChromeMenuItemIdSchema = z.union([z.string(), z.number()]);
export const ChromeAlarmsClearSchema = z.boolean();
export const ChromeTabGroupSchema = z.record(z.unknown());
export const ChromeTabGroupArraySchema = z.array(ChromeTabGroupSchema);
export const ChromeSessionArraySchema = z.array(z.record(z.unknown()));
export const ChromeDeviceArraySchema = z.array(z.record(z.unknown()));
export const ChromeDownloadSchema = z.record(z.unknown());
export const ChromeDownloadArraySchema = z.array(ChromeDownloadSchema);
export const ChromeDownloadIdSchema = z.number();
export const ChromeSystemCpuInfoSchema = z.record(z.unknown());
export const ChromeSystemMemoryInfoSchema = z.record(z.unknown());
export const ChromeSystemStorageInfoSchema = z.array(z.record(z.unknown()));

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
