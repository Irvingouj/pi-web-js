// Action maps and typed call messages for non-fs file-format namespaces
// (csv / zip / xlsx / pdf). Each entry binds an action name to its typed
// params and result. The envelope carries the precise param type end-to-end
// (no `unknown`): a CsvCallMessage<"parse"> has `params: FsPathParams`, not
// `params: unknown`. This is the typed envelope fsCall should have had.
import type {
	FsPathParams,
	FsStringResult,
} from "../../../pkg/extension_js.js";

export type CsvAction = "parse";
export type CsvActionMap = {
	parse: { params: FsPathParams; result: FsStringResult };
};

export type ZipAction = "list";
export type ZipActionMap = {
	list: { params: FsPathParams; result: FsStringResult };
};

export type XlsxAction = "read";
export type XlsxActionMap = {
	read: { params: FsPathParams; result: FsStringResult };
};

export type PdfAction = "text";
export type PdfActionMap = {
	text: { params: FsPathParams; result: FsStringResult };
};

// Typed envelope: for a given namespace action map and action, params are the
// map entry's precise params (not unknown). The discriminated union over all
// actions in a namespace collapses to the right param type per `action`.
export type FormatCallMessage<
	TType extends string,
	TMap extends Record<string, { params: unknown; result: unknown }>,
> = {
	type: TType;
	id: string;
	action: keyof TMap & string;
	params: TMap[keyof TMap]["params"];
};

export type CsvCallMessage = FormatCallMessage<"csvCall", CsvActionMap>;
export type ZipCallMessage = FormatCallMessage<"zipCall", ZipActionMap>;
export type XlsxCallMessage = FormatCallMessage<"xlsxCall", XlsxActionMap>;
export type PdfCallMessage = FormatCallMessage<"pdfCall", PdfActionMap>;
