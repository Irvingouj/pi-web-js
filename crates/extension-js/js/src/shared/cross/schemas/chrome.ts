import { z } from "zod";

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
