// TypeScript type mirrors for web-js-core command params and result types.
// Manually maintained — keep in sync with web-js-core/src/command_params.rs
// and web-js-base/src/types.rs.

export type TreeSnapshot = {
	version: string;
	url: string | null;
	title: string | null;
	viewport: {
		width: number;
		height: number;
		scrollX: number;
		scrollY: number;
	} | null;
	nodes: SemanticNode[];
	outline?: OutlineNode[];
};

export type SemanticNode = {
	refId: string;
	role: string;
	name?: string;
	description?: string;
	tag: string;
	id?: string;
	classes?: string[];
	value?: string;
	placeholder?: string;
	href?: string;
	states: Record<string, boolean | undefined>;
	inputType?: string;
	rect?: {
		x: number;
		y: number;
		width: number;
		height: number;
		top: number;
		right: number;
		bottom: number;
		left: number;
	};
	inViewport: boolean;
	visible: boolean;
	path?: string;
};

export type OutlineNode = {
	role: string;
	name: string;
	ref_id: string;
};

export type CommandParams =
	| FetchParams
	| SleepParams
	| PageClickParams
	| PageDblClickParams
	| PageFillParams
	| PageSetFilesParams
	| PageTypeParams
	| PagePressParams
	| PageSelectParams
	| PageSelectOptionParams
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
	| TabSetFilesParams
	| TabEvaluateParams
	| TabBackParams
	| TabWaitForLoadParams
	| TabScrollToParams
	| TabTypeParams
	| TabPressParams
	| TabSelectParams
	| TabSelectOptionParams
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
};

export type CellError =
	| {
			kind: "compile";
			name: string | null;
			message: string;
			line: number | null;
	  }
	| {
			kind: "runtime";
			name: string | null;
			message: string;
			line: number | null;
			action: string | null;
			code: string | null;
			stack: string | null;
	  }
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
	store?: boolean;
};

export type FsCopyParams = { from: string; to: string };

export type FsHashParams = { path: string; algo: string };

export type FsPathParams = { path: string };

export type FsReadRangeParams = { path: string; offset: bigint; len: number };

export type FsUpdateParams = { path: string; offset: bigint; data: string };

export type FsWriteParams = { path: string; data: string };

export type PageAppendParams = {
	refId?: string;
	label?: string;
	text: string;
};

export type PageCheckParams = {
	refId?: string;
	label?: string;
	checked: boolean;
};

export type PageClickParams = { refId?: string; label?: string };

export type PageDblClickParams = { refId?: string; label?: string };

export type PageExtractParams = { fields: string[] };

export type PageFillParams = {
	refId?: string;
	label?: string;
	value: string;
};

export type SetFileSource = {
	name?: string;
	mimeType?: string;
	url?: string;
	path?: string;
	handle?: string;
};

export type PageSetFilesParams = {
	refId?: string;
	label?: string;
	files: SetFileSource[];
};

export type PageFindParams = { selector: string };

export type PageDomParams = {
	selector: string;
	depth: number;
	includeHidden: boolean;
};

export type PageGotoParams = {
	url: string;
	timeout?: bigint;
	waitUntil?: "load" | "networkidle";
};

export type SnapshotFilter = {
	role?: string | string[];
	tag?: string | string[];
	text?: string;
	name?: string;
	interactiveOnly?: boolean;
	href?: string;
	src?: string;
	limit?: number;
};

export type PageSnapshotQueryParams = {
	filter?: SnapshotFilter;
	max_nodes?: number;
};

export type TabSnapshotQueryParams = {
	filter?: SnapshotFilter;
	max_nodes?: number;
	tabId: number;
};

export type PageHoverParams = { refId?: string; label?: string };
export type PageSubmitParams = { refId?: string; label?: string };
export type PageCheckRadioParams = { name: string; value: string };

export type PagePressParams = { refId?: string; label?: string; key: string };

export type PageScrollParams = { direction: string; amount: number };

export type PageScrollToParams = {
	refId?: string;
	label?: string;
	x?: number;
	y?: number;
};

export type PageSelectParams = {
	refId?: string;
	label?: string;
	value: string | string[];
};

export type PageSelectOptionParams = {
	refId?: string;
	label?: string;
	value: string;
};

export type PageTypeParams = {
	refId?: string;
	label?: string;
	text: string;
};

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

export type TabSetFilesParams = {
	tabId?: number;
	refId?: string;
	label?: string;
	files: SetFileSource[];
};

export type TabHoverParams = { tabId: bigint; refId: string };

export type TabPressParams = { tabId: bigint; key: string };

export type TabScrollParams = {
	tabId: bigint;
	direction: string;
	amount: number;
};

export type TabScrollToParams = {
	tabId: bigint;
	x?: number;
	y?: number;
	refId?: string;
	label?: string;
};

export type TabSelectParams = { tabId: bigint; refId: string; value: string };
export type TabSelectOptionParams = { tabId: bigint; refId: string; value: string };

export type TabTypeParams = { tabId: bigint; refId: string; text: string };

export type TabUnhoverParams = { tabId: bigint };

export type TabWaitForLoadParams = { tabId: bigint; timeout: bigint };
