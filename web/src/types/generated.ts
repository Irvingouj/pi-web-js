// TypeScript type mirrors for web-js-core command params and result types.
// Manually maintained — keep in sync with web-js-core/src/command_params.rs
// and web-js-base/src/types.rs.

import type { TreeSnapshot } from "@pi-oxide/dom-semantic-tree";

export type CommandParams =
	| FetchParams
	| SleepParams
	| PageClickParams
	| PageDblClickParams
	| PageFillParams
	| PageTypeParams
	| PagePressParams
	| PageSelectParams
	| PageCheckParams
	| PageHoverParams
	| PageScrollParams
	| PageScrollToParams
	| PageGotoParams
	| PageFindParams
	| PageWaitForParams
	| PageExtractParams
	| PageAppendParams
	| PageWaitParams
	| StorageGetParams
	| StorageSetParams
	| StorageDeleteParams
	| DomSnapshotParams
	| DomFormatParams
	| TabClickParams
	| TabFillParams
	| TabEvaluateParams
	| TabBackParams
	| TabWaitForLoadParams
	| TabScrollToParams
	| TabTypeParams
	| TabPressParams
	| TabSelectParams
	| TabCheckParams
	| TabHoverParams
	| TabUnhoverParams
	| TabScrollParams
	| TabDblClickParams
	| FsWriteParams
	| FsPathParams
	| FsCopyParams
	| FsUpdateParams
	| FsHashParams
	| FsReadRangeParams;

export type AsyncCommand = {
	call_id: number;
	action: string;
	params: CommandParams;
	run_id?: string;
};

export type CellError =
	| { kind: "compile"; message: string; line: number | null }
	| { kind: "runtime"; message: string; line: number | null }
	| { kind: "fuel_exhausted" }
	| { kind: "internal"; message: string };

export type CellStatus = "done" | "async_pending";

export type DomSnapshotParams = {
	interactive_only: boolean;
	max_nodes: bigint;
};

export type DomFormatParams = { snapshot: TreeSnapshot; format?: string };

export type FetchParams = {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: string | null;
	timeout: bigint;
};

export type FsCopyParams = { from: string; to: string };

export type FsHashParams = { path: string; algo: string };

export type FsPathParams = { path: string };

export type FsReadRangeParams = { path: string; offset: bigint; len: number };

export type FsUpdateParams = { path: string; offset: bigint; data: string };

export type FsWriteParams = { path: string; data: string };

export type PageAppendParams = { refId: string; label: string; text: string };

export type PageCheckParams = { refId: string; checked: boolean };

export type PageClickParams = { refId: string; label: string };

export type PageDblClickParams = { refId: string; label: string };

export type PageExtractParams = { fields: string[] };

export type PageFillParams = { refId: string; label: string; value: string };

export type PageFindParams = { selector: string };

export type PageGotoParams = { url: string };

export type PageHoverParams = { refId: string };

export type PagePressParams = { key: string };

export type PageScrollParams = { direction: string; amount: number };

export type PageScrollToParams = { refId: string };

export type PageSelectParams = { refId: string; value: string };

export type PageTypeParams = { refId: string; label: string; text: string };

export type PageWaitForParams = { selector: string; timeout: bigint };

export type PageWaitParams = { duration: bigint };

export type RunResult = {
	stdout: string[];
	stderr: string[];
	result: string | null;
	error: CellError | null;
	commands: CommandParams[];
	fuel_exhausted: boolean;
	execution_count: number;
	status: CellStatus;
	pending_commands: AsyncCommand[];
};

export type SleepParams = { duration: bigint };

export type StorageDeleteParams = { key: string };

export type StorageGetParams = { key: string };

export type StorageSetParams = { key: string; value: string };

export type TabBackParams = { tabId: bigint };

export type TabCheckParams = { tabId: bigint; refId: string; checked: boolean };

export type TabClickParams = { tabId: bigint; refId: string };

export type TabDblClickParams = { tabId: bigint; refId: string };

export type TabEvaluateParams = { tabId: bigint; script: string };

export type TabFillParams = { tabId: bigint; refId: string; value: string };

export type TabHoverParams = { tabId: bigint; refId: string };

export type TabPressParams = { tabId: bigint; key: string };

export type TabScrollParams = {
	tabId: bigint;
	direction: string;
	amount: number;
};

export type TabScrollToParams = {
	tabId: bigint;
	x: number;
	y: number;
	refId: string | null;
};

export type TabSelectParams = { tabId: bigint; refId: string; value: string };

export type TabTypeParams = { tabId: bigint; refId: string; text: string };

export type TabUnhoverParams = { tabId: bigint };

export type TabWaitForLoadParams = { tabId: bigint; timeout: bigint };
