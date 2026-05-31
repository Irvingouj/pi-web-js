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
	PageSelectParams,
	PageTypeParams,
	PageWaitForParams,
	PageWaitParams,
	SleepParams,
	StorageDeleteParams,
	StorageGetParams,
	StorageSetParams,
} from "./generated.js";

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

export const StorageSetManyParamsSchema = z.record(z.unknown());
export const StorageGetManyParamsSchema = z.record(z.unknown());
export const StorageGetAllParamsSchema = z.object({});
export const StorageDeleteManyParamsSchema = z.record(z.unknown());
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
	timeout: z.bigint().default(30000n),
});

export const SleepParamsSchema = z.object({
	duration: z.bigint(),
});

// ─── Page action schemas ───────────────────────────────────────

export const PageUrlParamsSchema = z.object({});
export const PageTitleParamsSchema = z.object({});

export const PageGotoParamsSchema = z.object({
	url: z.string(),
});

export const PageBackParamsSchema = z.object({});
export const PageForwardParamsSchema = z.object({});
export const PageReloadParamsSchema = z.object({});

export const PageWaitParamsSchema = z.object({
	duration: z.bigint().default(1000n),
});

export const PageClickParamsSchema = z.record(z.unknown());
export const PageFillParamsSchema = z.record(z.unknown());
export const PageTypeParamsSchema = z.record(z.unknown());
export const PageAppendParamsSchema = z.record(z.unknown());

export const PagePressParamsSchema = z.object({
	key: z.string(),
});

export const PageSelectParamsSchema = z.record(z.unknown());
export const PageCheckParamsSchema = z.record(z.unknown());
export const PageHoverParamsSchema = z.record(z.unknown());
export const PageUnhoverParamsSchema = z.object({});

export const PageScrollParamsSchema = z.object({
	direction: z.string().default("down"),
	amount: z.number().default(300),
});

export const PageScrollToParamsSchema = z.record(z.unknown());
export const PageDblClickParamsSchema = z.record(z.unknown());

export const PageFindParamsSchema = z.object({
	selector: z.string(),
});

export const PageWaitForParamsSchema = z.object({
	selector: z.string(),
	timeout: z.bigint().default(30000n),
});

export const PageExtractParamsSchema = z.object({
	fields: z.array(z.string()),
});

export const PageCloseParamsSchema = z.union([
	z.number(),
	z.array(z.unknown()),
	z.record(z.unknown()),
]);
export const PageActiveTabParamsSchema = z.object({});

// ─── Tab action schemas ────────────────────────────────────────

export const TabQueryParamsSchema = z.record(z.unknown());
export const TabCreateParamsSchema = z.record(z.unknown());
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

export const TabClickParamsSchema = z.record(z.unknown());
export const TabFillParamsSchema = z.record(z.unknown());
export const TabScrollToParamsSchema = z.record(z.unknown());
export const TabTypeParamsSchema = z.record(z.unknown());
export const TabPressParamsSchema = z.record(z.unknown());
export const TabSelectParamsSchema = z.record(z.unknown());
export const TabCheckParamsSchema = z.record(z.unknown());
export const TabHoverParamsSchema = z.record(z.unknown());
export const TabUnhoverParamsSchema = z.record(z.unknown());
export const TabScrollParamsSchema = z.record(z.unknown());
export const TabDblClickParamsSchema = z.record(z.unknown());

export const TabEvaluateParamsSchema = z.record(z.unknown());
export const TabBackParamsSchema = z.record(z.unknown());
export const TabWaitForLoadParamsSchema = z.record(z.unknown());
export const TabFetchParamsSchema = z.record(z.unknown());

export const TabSnapshotParamsSchema = z.record(z.unknown());
export const TabSnapshotTextParamsSchema = z.record(z.unknown());
export const TabSnapshotDataParamsSchema = z.record(z.unknown());

// ─── Sidepanel action schemas ──────────────────────────────────

export const SidepanelClickParamsSchema = z.union([
	z.string(),
	z.record(z.unknown()),
]);
export const SidepanelDblClickParamsSchema = z.union([
	z.string(),
	z.record(z.unknown()),
]);
export const SidepanelFillParamsSchema = z.record(z.unknown());
export const SidepanelTypeParamsSchema = z.record(z.unknown());
export const SidepanelPressParamsSchema = z.record(z.unknown());
export const SidepanelSelectParamsSchema = z.record(z.unknown());
export const SidepanelCheckParamsSchema = z.record(z.unknown());
export const SidepanelHoverParamsSchema = z.union([
	z.string(),
	z.record(z.unknown()),
]);
export const SidepanelUnhoverParamsSchema = z.union([
	z.string(),
	z.record(z.unknown()),
]);
export const SidepanelScrollParamsSchema = z.record(z.unknown());
export const SidepanelScrollToParamsSchema = z.union([
	z.string(),
	z.record(z.unknown()),
]);
export const SidepanelAppendParamsSchema = z.record(z.unknown());

export const SidepanelUrlParamsSchema = z.object({});
export const SidepanelTitleParamsSchema = z.object({});
export const SidepanelWaitParamsSchema = z.object({
	duration: z.bigint().default(1000n),
});

export const SidepanelSnapshotParamsSchema = z.object({
	interactive_only: z.boolean().default(false),
	max_nodes: z.bigint().default(500n),
});
export const SidepanelSnapshotTextParamsSchema = z.object({
	interactive_only: z.boolean().default(false),
	max_nodes: z.bigint().default(500n),
});
export const SidepanelSnapshotDataParamsSchema = z.object({
	interactive_only: z.boolean().default(false),
	max_nodes: z.bigint().default(500n),
});

// ─── DOM schemas ───────────────────────────────────────────────

export const DomSnapshotParamsSchema = z.object({
	interactive_only: z.boolean().default(false),
	max_nodes: z.bigint().default(500n),
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
	offset: z.bigint(),
	len: z.number(),
});

export const FsUpdateParamsSchema = z.object({
	path: z.string(),
	offset: z.bigint(),
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
	refId: z.number(),
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
