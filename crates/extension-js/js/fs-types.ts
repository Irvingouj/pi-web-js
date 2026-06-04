import type {
	FsBoolResult,
	FsCopyParams,
	FsExistsResult,
	FsHashParams,
	FsHashResult,
	FsListResult,
	FsPathParams,
	FsReadRangeDataParams,
	FsReadRangeParams,
	FsStatResult,
	FsStringResult,
	FsWriteParams,
} from "./extension_js.js";

export type FsActionMap = {
	exists: { params: FsPathParams; result: FsExistsResult };
	stat: { params: FsPathParams; result: FsStatResult };
	read: { params: FsPathParams; result: FsStringResult };
	readText: { params: FsPathParams; result: FsStringResult };
	readBase64: { params: FsPathParams; result: FsStringResult };
	list: { params: FsPathParams; result: FsListResult };
	mkdir: { params: FsPathParams; result: FsBoolResult };
	delete: { params: FsPathParams; result: FsBoolResult };
	copy: { params: FsCopyParams; result: FsBoolResult };
	move: { params: FsCopyParams; result: FsBoolResult };
	write: { params: FsWriteParams; result: FsBoolResult };
	writeText: { params: FsWriteParams; result: FsBoolResult };
	writeBase64: { params: FsWriteParams; result: FsBoolResult };
	append: { params: FsWriteParams; result: FsBoolResult };
	appendText: { params: FsWriteParams; result: FsBoolResult };
	appendBase64: { params: FsWriteParams; result: FsBoolResult };
	readRange: { params: FsReadRangeParams; result: FsStringResult };
	update: { params: FsReadRangeDataParams; result: FsBoolResult };
	hash: { params: FsHashParams; result: FsHashResult };
};

export type FsAction = keyof FsActionMap;
