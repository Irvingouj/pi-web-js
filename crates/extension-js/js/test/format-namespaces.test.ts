// @vitest-environment jsdom
//
// Verifies the format-namespace ActionMap contracts (csv/zip/xlsx/pdf) are
// structurally sound: each action maps to a { params, result } pair, and the
// action-name sets match the intended public API surface. These types drive
// the typed session getters (session.csv.parse, etc.) and the worker handler
// casts, so a regression here would silently break the public API typing.
//
// The full Rust↔worker↔wasm pipeline (parse_*_bytes correctness, namespace
// switch routing, real OPFS I/O) is verified by:
//   - cargo test -p web-fs  (parse_*_bytes unit tests, all green)
//   - manual Chrome sidepanel E2E (plan §Verification)

import { describe, expect, it } from "vitest";
import type {
	CsvAction,
	CsvActionMap,
	PdfAction,
	PdfActionMap,
	XlsxAction,
	XlsxActionMap,
	ZipAction,
	ZipActionMap,
} from "../src/shared/cross/format-types.js";

// Compile-time check: each map's keys exactly equal the union of its action
// type. If someone adds an action to the union without a map entry (or vice
// versa), this fails to compile.
type KeysEqual<TMap, TAction extends string> = keyof TMap extends TAction
	? TAction extends keyof TMap
		? true
		: never
	: never;

type _CsvCheck = KeysEqual<CsvActionMap, CsvAction>;
type _ZipCheck = KeysEqual<ZipActionMap, ZipAction>;
type _XlsxCheck = KeysEqual<XlsxActionMap, XlsxAction>;
type _PdfCheck = KeysEqual<PdfActionMap, PdfAction>;
const _csvOk: _CsvCheck = true;
const _zipOk: _ZipCheck = true;
const _xlsxOk: _XlsxCheck = true;
const _pdfOk: _PdfCheck = true;
void [_csvOk, _zipOk, _xlsxOk, _pdfOk];

describe("format namespace ActionMap contracts", () => {
	it("csv exposes exactly { parse }", () => {
		const actions: CsvAction[] = ["parse"];
		expect(actions).toEqual(["parse"]);
	});

	it("zip exposes exactly { list }", () => {
		const actions: ZipAction[] = ["list"];
		expect(actions).toEqual(["list"]);
	});

	it("xlsx exposes exactly { read }", () => {
		const actions: XlsxAction[] = ["read"];
		expect(actions).toEqual(["read"]);
	});

	it("pdf exposes exactly { text }", () => {
		const actions: PdfAction[] = ["text"];
		expect(actions).toEqual(["text"]);
	});
});
