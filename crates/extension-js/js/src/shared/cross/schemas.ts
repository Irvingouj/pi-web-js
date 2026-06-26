/** Schemas barrel — re-exports all domain schemas. Import path unchanged. */
import type { z } from "zod";

export * from "./schemas/chrome.js";
export * from "./schemas/clipboard.js";
export * from "./schemas/fs.js";
export * from "./schemas/helpers.js";
export * from "./schemas/host.js";
export * from "./schemas/network.js";
export * from "./schemas/page.js";
export * from "./schemas/returns.js";
export * from "./schemas/sidepanel.js";
export * from "./schemas/snapshot.js";
export * from "./schemas/storage.js";
export * from "./schemas/tab.js";

// ─── Type-satisfaction checks ──────────────────────────────────
// These reference schemas across domains; kept in the barrel with cross-domain imports.
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
} from "./generated.js";
import type {
	FsCopyParamsSchema,
	FsHashParamsSchema,
	FsPathParamsSchema,
	FsReadRangeParamsSchema,
	FsUpdateParamsSchema,
	FsWriteParamsSchema,
} from "./schemas/fs.js";
import type {
	FetchParamsSchema,
	SleepParamsSchema,
} from "./schemas/network.js";
import type {
	PageCheckParamsSchema,
	PageDomParamsSchema,
	PageExtractParamsSchema,
	PageFillParamsSchema,
	PageFindParamsSchema,
	PageGotoParamsSchema,
	PagePressParamsSchema,
	PageScrollParamsSchema,
	PageScrollToParamsSchema,
	PageSelectParamsSchema,
	PageSetFilesParamsSchema,
	PageTypeParamsSchema,
	PageWaitForParamsSchema,
	PageWaitParamsSchema,
} from "./schemas/page.js";
import type { DomSnapshotParamsSchema } from "./schemas/snapshot.js";
import type {
	StorageDeleteParamsSchema,
	StorageGetParamsSchema,
	StorageSetParamsSchema,
} from "./schemas/storage.js";

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

type _AssertPageDom =
	z.infer<typeof PageDomParamsSchema> extends PageDomParams ? true : never;
type _AssertPageDomReverse =
	PageDomParams extends z.infer<typeof PageDomParamsSchema> ? true : never;

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
