// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { buildSnapshotInTab } from "../src/main/runner/dom/snapshot.js";
import {
	collectInlineSnapshot,
	collectInlineSnapshot as inlineSnapshot,
} from "../src/shared/cross/collect-inline-snapshot.js";

describe("inline snapshot parity", () => {
	it("buildSnapshotInTab matches collectInlineSnapshot", () => {
		document.body.innerHTML =
			'<input type="text" value="hello" aria-label="Search" />';
		expect(buildSnapshotInTab(500)).toEqual(collectInlineSnapshot(500));
	});

	it("content-script inlineSnapshot matches collectInlineSnapshot", () => {
		document.body.innerHTML = "<button>Go</button>";
		expect(inlineSnapshot(500)).toEqual(collectInlineSnapshot(500));
	});
});
