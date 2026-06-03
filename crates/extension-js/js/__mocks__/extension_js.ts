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
	fsAppend(params: FsWriteParams): Promise<FsBoolResult> {
		return Promise.resolve({ ok: true });
	}
	fsAppendBase64(params: FsWriteParams): Promise<FsBoolResult> {
		return Promise.resolve({ ok: true });
	}
	fsAppendText(params: FsWriteParams): Promise<FsBoolResult> {
		return Promise.resolve({ ok: true });
	}
	fsCopy(params: FsCopyParams): Promise<FsBoolResult> {
		return Promise.resolve({ ok: true });
	}
	fsDelete(params: FsPathParams): Promise<FsBoolResult> {
		return Promise.resolve({ ok: true });
	}
	fsExists(params: FsPathParams): Promise<FsExistsResult> {
		return Promise.resolve({ exists: true });
	}
	fsHash(params: FsHashParams): Promise<FsHashResult> {
		return Promise.resolve({ hash: "mock" });
	}
	fsList(params: FsPathParams): Promise<FsListResult> {
		return Promise.resolve({ entries: [] });
	}
	fsMkdir(params: FsPathParams): Promise<FsBoolResult> {
		return Promise.resolve({ ok: true });
	}
	fsMove(params: FsCopyParams): Promise<FsBoolResult> {
		return Promise.resolve({ ok: true });
	}
	fsRead(params: FsPathParams): Promise<FsStringResult> {
		return Promise.resolve({ data: "mock" });
	}
	fsReadBase64(params: FsPathParams): Promise<FsStringResult> {
		return Promise.resolve({ data: "mock" });
	}
	fsReadRange(params: FsReadRangeParams): Promise<FsStringResult> {
		return Promise.resolve({ data: "mock" });
	}
	fsReadText(params: FsPathParams): Promise<FsStringResult> {
		return Promise.resolve({ data: "mock" });
	}
	fsStat(params: FsPathParams): Promise<FsStatResult> {
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
	fsUpdate(params: FsReadRangeDataParams): Promise<FsBoolResult> {
		return Promise.resolve({ ok: true });
	}
	fsWrite(params: FsWriteParams): Promise<FsBoolResult> {
		return Promise.resolve({ ok: true });
	}
	fsWriteBase64(params: FsWriteParams): Promise<FsBoolResult> {
		return Promise.resolve({ ok: true });
	}
	fsWriteText(params: FsWriteParams): Promise<FsBoolResult> {
		return Promise.resolve({ ok: true });
	}
	inspect_globals(): WasmGlobalsSnapshot {
		return { variables: [], execution_count: 0 };
	}
	load_library(source: string): CellResult {
		return {
			status: "ok",
			stdout: [],
			stderr: [],
			result: null,
			error: null,
			execution_count: 0,
		};
	}
	constructor() {}
	reset(): void {}
	runCellAsync(
		code: string,
		stdin: string,
		run_id: string,
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
	set_fuel_limit(limit: number): void {}
	stopWith(): void {}
}

export function generateApiDocs(format: string): string {
	return "mock docs";
}

export function setLogLevel(level: number): void {
	// mock
}
