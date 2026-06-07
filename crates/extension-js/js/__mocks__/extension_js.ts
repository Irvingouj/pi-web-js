export interface CellResult {
	status: "ok" | "err";
	stdout: string[];
	stderr: string[];
	result: string | null;
	error: { message: string } | null;
	execution_count: number;
}

export interface WasmGlobalsSnapshot {
	variables: Array<{
		name: string;
		type: string;
		value: string | null;
		keys: string[] | null;
	}>;
	execution_count: number;
}

export interface FsPathParams {
	path: string;
}

export interface FsExistsResult {
	exists: boolean;
}

export interface FsBoolResult {
	ok: boolean;
}

export interface FsStringResult {
	data: string;
}

export interface FsListEntry {
	name: string;
	kind: string;
}

export interface FsListResult {
	entries: FsListEntry[];
}

export interface FsStatResult {
	path: string;
	name: string;
	kind: string;
	size: number;
	mime: string | null;
	created_at: number | null;
	modified_at: number | null;
}

export interface FsHashParams {
	path: string;
	algo: string;
}

export interface FsHashResult {
	hash: string;
}

export interface FsCopyParams {
	from: string;
	to: string;
}

export interface FsWriteParams {
	path: string;
	data: string;
}

export interface FsReadRangeParams {
	path: string;
	offset: number;
	len: number;
}

export interface FsReadRangeDataParams {
	path: string;
	offset: number;
	data: string;
}

export class ExtensionSession {
	free(): void {}
	[Symbol.dispose](): void {}
	fsAppend(_params: FsWriteParams): Promise<FsBoolResult> {
		return Promise.resolve({ ok: true });
	}
	fsAppendBase64(_params: FsWriteParams): Promise<FsBoolResult> {
		return Promise.resolve({ ok: true });
	}
	fsAppendText(_params: FsWriteParams): Promise<FsBoolResult> {
		return Promise.resolve({ ok: true });
	}
	fsCopy(_params: FsCopyParams): Promise<FsBoolResult> {
		return Promise.resolve({ ok: true });
	}
	fsDelete(_params: FsPathParams): Promise<FsBoolResult> {
		return Promise.resolve({ ok: true });
	}
	fsExists(_params: FsPathParams): Promise<FsExistsResult> {
		return Promise.resolve({ exists: true });
	}
	fsHash(_params: FsHashParams): Promise<FsHashResult> {
		return Promise.resolve({ hash: "mock" });
	}
	fsList(_params: FsPathParams): Promise<FsListResult> {
		return Promise.resolve({ entries: [] });
	}
	fsMkdir(_params: FsPathParams): Promise<FsBoolResult> {
		return Promise.resolve({ ok: true });
	}
	fsMove(_params: FsCopyParams): Promise<FsBoolResult> {
		return Promise.resolve({ ok: true });
	}
	fsRead(_params: FsPathParams): Promise<FsStringResult> {
		return Promise.resolve({ data: "mock" });
	}
	fsReadBase64(_params: FsPathParams): Promise<FsStringResult> {
		return Promise.resolve({ data: "mock" });
	}
	fsReadRange(_params: FsReadRangeParams): Promise<FsStringResult> {
		return Promise.resolve({ data: "mock" });
	}
	fsReadText(_params: FsPathParams): Promise<FsStringResult> {
		return Promise.resolve({ data: "mock" });
	}
	fsStat(_params: FsPathParams): Promise<FsStatResult> {
		return Promise.resolve({
			path: "",
			name: "",
			kind: "file",
			size: 0,
			mime: null,
			created_at: null,
			modified_at: null,
		});
	}
	fsUpdate(_params: FsReadRangeDataParams): Promise<FsBoolResult> {
		return Promise.resolve({ ok: true });
	}
	fsWrite(_params: FsWriteParams): Promise<FsBoolResult> {
		return Promise.resolve({ ok: true });
	}
	fsWriteBase64(_params: FsWriteParams): Promise<FsBoolResult> {
		return Promise.resolve({ ok: true });
	}
	fsWriteText(_params: FsWriteParams): Promise<FsBoolResult> {
		return Promise.resolve({ ok: true });
	}
	inspect_globals(): WasmGlobalsSnapshot {
		return { variables: [], execution_count: 0 };
	}
	apiDocs(_format: string): string {
		return JSON.stringify([
			{
				public_name: "fs.exists",
				namespace: "fs",
				name: "exists",
				action: "fs_exists",
				description: "Check if a path exists.",
				params: [],
				returns: { js_type: "boolean", description: "Whether the path exists." },
				source: "rust_core",
			},
			{
				public_name: "page.goto",
				namespace: "page",
				name: "goto",
				action: "page_goto",
				description: "Navigate to a URL.",
				params: [{ name: "url", js_type: "string", required: true, description: "The URL to navigate to." }],
				returns: { js_type: "object", description: "Navigation result." },
				source: "extension",
			},
		]);
	}
	load_library(_source: string): CellResult {
		return {
			status: "ok",
			stdout: [],
			stderr: [],
			result: null,
			error: null,
			execution_count: 0,
		};
	}
	reset(): void {}
	runCellAsync(
		_code: string,
		_stdin: string,
		_run_id: string,
	): Promise<CellResult> {
		return Promise.resolve({
			status: "ok",
			stdout: [],
			stderr: [],
			result: null,
			error: null,
			execution_count: 0,
		});
	}
	set_fuel_limit(_limit: number): void {}
	setAborted(_value: boolean): void {}
	stopWith(): void {}
}

export function setLogLevel(_level: number): void {
	// mock
}

export function registerJsCall(_entry: unknown, _callback: unknown): void {
	// mock
}

export function registerJsCallBatch(_items: unknown[]): void {
	// mock
}

export function registerSharedDispatch(_callback: unknown): void {
	// mock
}

export function importManifestEntries(_entries: unknown[]): void {
	// mock
}
