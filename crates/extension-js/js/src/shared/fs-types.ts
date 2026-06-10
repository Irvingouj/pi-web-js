import type {
	FsBoolResult,
	FsCopyParams,
	FsExistsResult,
	FsHashParams,
	FsHashResult,
	FsListResult,
	FsPathParams,
	FsReadRangeParams,
	FsReadRangeDataParams,
	FsStatResult,
	FsStringResult,
	FsWriteParams,
	FsWriteResult,
} from "../../pkg/extension_js.js";

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
	write: { params: FsWriteParams; result: FsWriteResult };
	writeText: { params: FsWriteParams; result: FsWriteResult };
	writeBase64: { params: FsWriteParams; result: FsWriteResult };
	append: { params: FsWriteParams; result: FsWriteResult };
	appendText: { params: FsWriteParams; result: FsWriteResult };
	appendBase64: { params: FsWriteParams; result: FsWriteResult };
	readRange: { params: FsReadRangeParams; result: FsStringResult };
	update: { params: FsReadRangeDataParams; result: FsBoolResult };
	hash: { params: FsHashParams; result: FsHashResult };
};

export type FsAction = keyof FsActionMap;
