// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DomNode } from "../src/content-script/dom-tree.js";
import { handlers } from "../src/content-script/handlers.js";
import {
	grantFromInlineSnapshot,
	resetLease,
} from "../src/content-script/observation-lease.js";
import {
	dispatchContentScriptCall,
	registerContentScriptSpec,
} from "../src/content-script/registry.js";
import { buildContentScriptSpecs } from "../src/content-script/schemas.js";
import type { InlineSnapshotNode } from "../src/shared/cross/collect-inline-snapshot.js";
import { collectInlineSnapshot } from "../src/shared/cross/collect-inline-snapshot.js";

// ---- test-only type for find output ----
interface FindNode {
	refId: string;
	tag: string;
	role: string;
	name?: string;
	text?: string;
	value?: string;
	checked?: boolean;
	disabled?: boolean;
	readOnly?: boolean;
	href?: string;
	src?: string;
	alt?: string;
	parentRefId?: string;
	postId?: string;
	permalink?: string;
	imageUrls?: string[];
	accept?: string;
	filesCount?: number;
	required?: boolean;
	invalid?: boolean;
	validationMessage?: string;
	controlType?: string;
	recommendedAction?: string;
	actionable?: boolean;
}

const mockAddListener = vi.fn();

declare global {
	var chrome: {
		runtime: {
			id: string;
			onMessage: { addListener: typeof mockAddListener };
		};
	};
}

// Set up global chrome before any dynamic import
globalThis.chrome = {
	runtime: {
		id: "test-extension-id",
		onMessage: {
			addListener: mockAddListener,
		},
	},
};

// Polyfill CSS.escape for jsdom test environments where it is unavailable
if (typeof globalThis.CSS === "undefined" || !globalThis.CSS.escape) {
	(globalThis as unknown as Record<string, unknown>).CSS = {
		escape: (s: string) => s.replace(/([.*+?^${}()|[\]\\])/g, "\\$1"),
	};
}

// Test setup: register content-script handlers via dynamic import.
// Exception to static-import rule: this import has side effects (registers
// onMessage listener) and must run after globalThis.chrome is set.
await import("../src/content-script/index.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupSpecs() {
	for (const spec of buildContentScriptSpecs()) {
		registerContentScriptSpec(spec);
	}
}

function snapshotNodes(maxNodes: number): InlineSnapshotNode[] {
	return collectInlineSnapshot(maxNodes).nodes;
}

async function domNodes(
	selector: string,
	opts?: { depth?: number; includeHidden?: boolean },
): Promise<DomNode[]> {
	const result = await dispatchContentScriptCall(
		"page_dom",
		"dom",
		handlers.dom,
		{
			selector,
			depth: opts?.depth ?? 10,
			includeHidden: opts?.includeHidden ?? false,
		},
	);
	if (!result.ok) throw new Error("dom dispatch failed");
	const data = result.value as { nodes: DomNode[] };
	return data.nodes;
}

async function findNodes(selector: string): Promise<FindNode[]> {
	const result = await dispatchContentScriptCall(
		"page_find",
		"find",
		handlers.find,
		{ selector },
	);
	if (!result.ok) throw new Error("find dispatch failed");
	return result.value as FindNode[];
}

/** Flatten dom nodes including children. */
function flattenDom(nodes: DomNode[]): DomNode[] {
	const out: DomNode[] = [];
	const walk = (list: DomNode[]): void => {
		for (const n of list) {
			out.push(n);
			if (n.children) walk(n.children);
		}
	};
	walk(nodes);
	return out;
}

// ---------------------------------------------------------------------------
// Group 1: visible-text invariant across surfaces
// ---------------------------------------------------------------------------

describe("visible-text invariant across surfaces", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		setupSpecs();
	});

	it("snapshot includes every visible sentinel and marks mustKeep; hidden sentinels absent", () => {
		document.body.innerHTML = `
			<div id="root">
				<div>TXT_SENTINEL_DIV</div>
				<span>TXT_SENTINEL_SPAN</span>
				<div role="presentation">TXT_SENTINEL_PRESENTATION</div>
				<div role="none">TXT_SENTINEL_NONE</div>
				<div aria-live="polite">TXT_SENTINEL_LIVE</div>
				<div role="status">TXT_SENTINEL_STATUS</div>
				<div role="alert">TXT_SENTINEL_ALERT</div>
				<section><div><span>TXT_SENTINEL_NESTED</span></div></section>
				<div style="display:none">TXT_HIDDEN_DISPLAY_NONE</div>
				<div aria-hidden="true">TXT_HIDDEN_ARIA</div>
				<div hidden>TXT_HIDDEN_ATTR</div>
				<div style="visibility:hidden">TXT_HIDDEN_VISIBILITY</div>
			</div>
		`;
		// inert must be set as a property (jsdom does not reflect the attribute)
		const inertDiv = document.createElement("div");
		inertDiv.inert = true;
		inertDiv.textContent = "TXT_HIDDEN_INERT";
		document.getElementById("root")!.appendChild(inertDiv);

		const visibleSentinels = [
			"TXT_SENTINEL_DIV",
			"TXT_SENTINEL_SPAN",
			"TXT_SENTINEL_PRESENTATION",
			"TXT_SENTINEL_NONE",
			"TXT_SENTINEL_LIVE",
			"TXT_SENTINEL_STATUS",
			"TXT_SENTINEL_ALERT",
			"TXT_SENTINEL_NESTED",
		];
		const hiddenSentinels = [
			"TXT_HIDDEN_DISPLAY_NONE",
			"TXT_HIDDEN_ARIA",
			"TXT_HIDDEN_ATTR",
			"TXT_HIDDEN_VISIBILITY",
			"TXT_HIDDEN_INERT",
		];

		const result = collectInlineSnapshot(1);
		for (const s of visibleSentinels) {
			expect(result.text, s).toContain(s);
			const node = result.nodes.find((n) => n.text?.includes(s));
			expect(node, s).toBeDefined();
			expect(node?.mustKeep, s).toBe(true);
		}
		for (const s of hiddenSentinels) {
			expect(result.text, s).not.toContain(s);
		}
	});

	it("dom with includeHidden=false includes the same visible sentinels (incl. aria-live/none/alert)", async () => {
		document.body.innerHTML = `
			<div id="root">
				<div>TXT_SENTINEL_DIV</div>
				<span>TXT_SENTINEL_SPAN</span>
				<div role="presentation">TXT_SENTINEL_PRESENTATION</div>
				<div role="none">TXT_SENTINEL_NONE</div>
				<div aria-live="polite">TXT_SENTINEL_LIVE</div>
				<div role="status">TXT_SENTINEL_STATUS</div>
				<div role="alert">TXT_SENTINEL_ALERT</div>
				<div style="display:none">TXT_HIDDEN_DISPLAY_NONE</div>
				<div hidden>TXT_HIDDEN_ATTR</div>
			</div>
		`;

		const nodes = flattenDom(
			await domNodes("#root", { depth: 10, includeHidden: false }),
		);
		const allText = nodes.map((n) => n.text ?? "").join(" ");
		expect(allText).toContain("TXT_SENTINEL_DIV");
		expect(allText).toContain("TXT_SENTINEL_SPAN");
		expect(allText).toContain("TXT_SENTINEL_PRESENTATION");
		expect(allText).toContain("TXT_SENTINEL_NONE");
		expect(allText).toContain("TXT_SENTINEL_LIVE");
		expect(allText).toContain("TXT_SENTINEL_STATUS");
		expect(allText).toContain("TXT_SENTINEL_ALERT");
		expect(allText).not.toContain("TXT_HIDDEN_DISPLAY_NONE");
		expect(allText).not.toContain("TXT_HIDDEN_ATTR");
	});

	it("find for a visible sentinel carries refId, tag, role, name, and text", async () => {
		document.body.innerHTML = `
			<button aria-label="Sentinel Btn">TXT_FIND_SENTINEL</button>
		`;
		const nodes = await findNodes("button");
		expect(nodes.length).toBe(1);
		const n = nodes[0];
		expect(n.refId).toMatch(/^e\d+$/);
		expect(n.tag).toBe("button");
		expect(n.role).toBe("button");
		expect(n.name).toBe("Sentinel Btn");
		// find now uses getOwnVisibleText via the shared pipeline (parity with
		// snapshot/dom); pin visible-text carry-through.
		expect(n.text).toContain("TXT_FIND_SENTINEL");
	});
});

// ---------------------------------------------------------------------------
// Group 2: pipeline preserves child traversal when parent is skipped
// ---------------------------------------------------------------------------

describe("pipeline preserves child traversal when parent is skipped", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		setupSpecs();
	});

	it("script subtree dropped, visible span under structural parent still emitted", () => {
		document.body.innerHTML = `
			<div id="wrapper">
				<script>var x = 1;</script>
				<div class="structural">
					<span id="PIPELINE_CHILD_VISIBLE">PIPELINE_CHILD_VISIBLE</span>
				</div>
			</div>
		`;

		const result = collectInlineSnapshot(100);
		// Script elements are never emitted as snapshot nodes
		expect(result.nodes.find((n) => n.tag === "script")).toBeUndefined();
		// Visible child text is captured
		expect(result.text).toContain("PIPELINE_CHILD_VISIBLE");
		const node = result.nodes.find((n) =>
			n.text?.includes("PIPELINE_CHILD_VISIBLE"),
		);
		expect(node).toBeDefined();
		expect(node?.mustKeep).toBe(true);
	});

	it("dom includeHidden=true reports hiddenReason for opacity-zero, inert, aria-hidden, display-none", async () => {
		// The draft names six HiddenReason variants. Snapshot excludes them
		// (covered in Group 1); DOM includeHidden=true must SURFACE them with a
		// classified hiddenReason rather than silently including unattributed.
		document.body.innerHTML = `
			<div id="root">
				<div id="h-disp" style="display:none">HD_DISPLAY</div>
				<div id="h-vis" style="visibility:hidden">HD_VISIBILITY</div>
				<div id="h-aria" aria-hidden="true">HD_ARIA</div>
				<div id="h-attr" hidden>HD_ATTR</div>
				<div id="h-op" style="opacity:0">HD_OPACITY</div>
			</div>
		`;
		const inertDiv = document.createElement("div");
		inertDiv.id = "h-inert";
		inertDiv.inert = true;
		inertDiv.textContent = "HD_INERT";
		document.getElementById("root")!.appendChild(inertDiv);

		const nodes = flattenDom(
			await domNodes("#root > *", { depth: 0, includeHidden: true }),
		);
		const reasonFor = (id: string): string | undefined =>
			nodes.find(
				(n) =>
					n.tag === id ||
					`#` + (n.attributes?.id ?? "") === id ||
					n.text?.includes(id.replace(",", "")),
			)?.hiddenReason;
		// More precise lookup by element + attribute id.
		const byAttrId = (id: string): DomNode | undefined =>
			nodes.find((n) => n.attributes?.id === id);
		expect(byAttrId("h-disp")?.hidden).toBe(true);
		expect(byAttrId("h-disp")?.hiddenReason).toBe("display-none");
		expect(byAttrId("h-vis")?.hiddenReason).toBe("visibility-hidden");
		expect(byAttrId("h-aria")?.hiddenReason).toBe("aria-hidden");
		expect(byAttrId("h-attr")?.hiddenReason).toBe("hidden-attr");
		expect(byAttrId("h-op")?.hiddenReason).toBe("opacity-zero");
		expect(byAttrId("h-inert")?.hiddenReason).toBe("inert");
		// The five variants treated as truly-hidden (display:none, visibility:hidden,
		// aria-hidden, hidden attr, inert) are excluded when includeHidden=false.
		const trulyHidden = flattenDom(
			await domNodes("#h-disp, #h-vis, #h-aria, #h-attr, #h-inert", {
				depth: 0,
				includeHidden: false,
			}),
		);
		expect(trulyHidden.length).toBe(0);
		// opacity-zero is NOT treated as truly-hidden by the inclusion gate
		// (isSelfOrAncestorHidden checks only display/visibility/aria/hidden/inert),
		// so it is still emitted under includeHidden=false. Crucially, the contract
		// is that a node we decided to include must NOT self-describe as hidden —
		// so hidden/hiddenReason stay absent here even though includeHidden=true
		// would classify it as opacity-zero.
		const opacityOnly = flattenDom(
			await domNodes("#h-op", { depth: 0, includeHidden: false }),
		);
		expect(opacityOnly.length).toBe(1);
		expect(opacityOnly[0]?.hidden).toBeUndefined();
		expect(opacityOnly[0]?.hiddenReason).toBeUndefined();
	});

	it("dom and find do not leak script/style/noscript/template source as visible text (EXCLUDED_TAGS parity)", async () => {
		// Snapshot drops all EXCLUDED_TAGS entirely. dom (a tree walk) must do the
		// same — script/style/noscript/template should not appear as DOM nodes.
		// find honors the agent's selector (explicit opt-in), so the node is
		// emitted, but its raw source must NOT leak as `text` per the Snapshot
		// Text Rule. Complete enumeration of the 4-member EXCLUDED_TAGS set.
		document.body.innerHTML = `
			<div id="root">
				<script>var SECRET_SOURCE = 1;</script>
				<style>body { color: red; }</style>
				<noscript>fallback text</noscript>
				<template><span>template content</span></template>
				<span>VISIBLE_TEXT</span>
			</div>
		`;

		// dom: all 4 excluded tags absent entirely
		const dom = flattenDom(
			await domNodes("#root > *", { depth: 0, includeHidden: true }),
		);
		expect(dom.find((n) => n.tag === "script")).toBeUndefined();
		expect(dom.find((n) => n.tag === "style")).toBeUndefined();
		expect(dom.find((n) => n.tag === "noscript")).toBeUndefined();
		expect(dom.find((n) => n.tag === "template")).toBeUndefined();
		const domText = dom.map((n) => n.text ?? "").join(" ");
		expect(domText).not.toContain("SECRET_SOURCE");
		expect(domText).not.toContain("fallback text");
		expect(domText).not.toContain("template content");
		expect(domText).toContain("VISIBLE_TEXT");

		// find: agent opted in via selector; node present but text stripped
		const found = await findNodes("script");
		expect(found.length).toBe(1);
		expect(found[0]?.tag).toBe("script");
		expect(found[0]?.text).toBeUndefined();
		expect(found[0]?.mustKeep).not.toBe(true);
	});
});
// ---------------------------------------------------------------------------

describe("mustKeep beats filters and limits", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		setupSpecs();
	});

	it("interactiveOnly + limit:1 still returns all mustKeep visible-text nodes", async () => {
		// Buttons with text are BOTH mustKeep AND interactive. To isolate the
		// mustKeep-vs-interactive distinction, use text-only spans that are NOT
		// interactive plus non-text interactive controls.
		document.body.innerHTML = `
			<div>
				<button aria-label="B1"></button>
				<button aria-label="B2"></button>
				<button aria-label="B3"></button>
				<span>MUSTKEEP_TEXT_A</span>
				<span>MUSTKEEP_TEXT_B</span>
				<span>MUSTKEEP_TEXT_C</span>
			</div>
		`;

		const result = await dispatchContentScriptCall(
			"page_snapshot_query",
			"snapshot_query",
			handlers.snapshot_query,
			{ filter: { interactiveOnly: true, limit: 1 } },
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const data = result.value as { nodes: InlineSnapshotNode[] };
		// The three text spans are mustKeep and must survive even under
		// interactiveOnly + limit:1.
		const mustKeepNodes = data.nodes.filter(
			(n) => n.mustKeep === true && /^MUSTKEEP_TEXT_[ABC]$/.test(n.text ?? ""),
		);
		expect(mustKeepNodes.length).toBe(3);
		const texts = mustKeepNodes.map((n) => n.text);
		expect(texts).toContain("MUSTKEEP_TEXT_A");
		expect(texts).toContain("MUSTKEEP_TEXT_B");
		expect(texts).toContain("MUSTKEEP_TEXT_C");
		// Non-mustKeep are limited: at most 1 non-mustKeep node
		const nonMustKeep = data.nodes.filter((n) => n.mustKeep !== true);
		expect(nonMustKeep.length).toBeLessThanOrEqual(1);
	});

	it("interactiveOnly under a high limit returns ALL interactive controls", async () => {
		// Strengthened: with limit above the control count, every interactive
		// control passes the interactiveOnly filter (not just "at least one").
		document.body.innerHTML = `
			<div>
				<button aria-label="B1"></button>
				<button aria-label="B2"></button>
				<button aria-label="B3"></button>
			</div>
		`;
		const result = await dispatchContentScriptCall(
			"page_snapshot_query",
			"snapshot_query",
			handlers.snapshot_query,
			{ filter: { interactiveOnly: true, limit: 5 } },
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const data = result.value as { nodes: InlineSnapshotNode[] };
		const buttons = data.nodes.filter(
			(n) => n.tag === "button" && n.name !== undefined,
		);
		expect(buttons.length).toBe(3);
		for (const b of buttons) expect(b.actionable).not.toBe(false);
	});

	it("mustKeep does NOT beat role/tag/text filters (only interactiveOnly/limit)", async () => {
		// Pin the actual contract: AGENTS.md's mustKeep invariant covers capacity,
		// the interactiveOnly filter, dedupe, and rendering — NOT role/tag/text
		// filters. Those are content-shape filters and apply to mustKeep nodes
		// too. A mustKeep span with role=presentation queried via filter.role
		// is dropped by design; this test documents that intent so a future
		// change is deliberate.
		document.body.innerHTML = `
			<div>
				<span role="presentation">MUSTKEEP_PRESENTATION</span>
				<button>MUSTKEEP_BUTTON</button>
			</div>
		`;
		// Sanity: both leaves are mustKeep visible-text nodes before filtering.
		const all = await dispatchContentScriptCall(
			"page_snapshot_query",
			"snapshot_query",
			handlers.snapshot_query,
			{ filter: {} },
		);
		expect(all.ok).toBe(true);
		if (!all.ok) return;
		const allData = all.value as { nodes: InlineSnapshotNode[] };
		const mustKeepLeaves = allData.nodes.filter(
			(n) => n.mustKeep === true && n.text?.includes("MUSTKEEP_"),
		);
		expect(
			new Set(mustKeepLeaves.map((n) => n.text)).has("MUSTKEEP_PRESENTATION"),
		).toBe(true);
		expect(
			new Set(mustKeepLeaves.map((n) => n.text)).has("MUSTKEEP_BUTTON"),
		).toBe(true);

		// filter.role=["button"] drops the role=presentation mustKeep span —
		// mustKeep does not exempt role filters.
		const byRole = await dispatchContentScriptCall(
			"page_snapshot_query",
			"snapshot_query",
			handlers.snapshot_query,
			{ filter: { role: ["button"] } },
		);
		expect(byRole.ok).toBe(true);
		if (!byRole.ok) return;
		const roleData = byRole.value as { nodes: InlineSnapshotNode[] };
		const roleTexts = roleData.nodes.map((n) => n.text ?? "");
		expect(roleTexts).toContain("MUSTKEEP_BUTTON");
		expect(roleTexts).not.toContain("MUSTKEEP_PRESENTATION");

		// filter.tag=["span"] drops the <button> mustKeep node symmetrically.
		const byTag = await dispatchContentScriptCall(
			"page_snapshot_query",
			"snapshot_query",
			handlers.snapshot_query,
			{ filter: { tag: ["span"] } },
		);
		expect(byTag.ok).toBe(true);
		if (!byTag.ok) return;
		const tagData = byTag.value as { nodes: InlineSnapshotNode[] };
		const tagTexts = tagData.nodes.map((n) => n.text ?? "");
		expect(tagTexts).toContain("MUSTKEEP_PRESENTATION");
		expect(tagTexts).not.toContain("MUSTKEEP_BUTTON");
	});
});

// ---------------------------------------------------------------------------
// Group 4: form metadata parity across snapshot, DOM, and find
// ---------------------------------------------------------------------------

describe("form metadata parity across snapshot, DOM, and find", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		setupSpecs();
	});

	it("snapshot, dom, and find agree on value/checked/required/invalid/validationMessage", async () => {
		// Use e\d+ refIds so allocateRefId preserves them.
		document.body.innerHTML = `
			<form id="form">
				<input type="text" id="t1" value="hello" title="hint" data-ref-id="e1">
				<input type="text" id="t2" required data-ref-id="e2">
				<input type="checkbox" id="c1" checked data-ref-id="e3">
				<input type="radio" id="r1" checked data-ref-id="e4">
				<select id="s1" data-ref-id="e5">
					<option value="a">A</option>
					<option value="b" selected>B</option>
				</select>
				<input type="file" id="f1" accept=".pdf" data-ref-id="e6">
			</form>
		`;

		// Make t2 invalid
		const t2 = document.getElementById("t2") as HTMLInputElement;
		t2.setCustomValidity("must not be empty");

		const snap = snapshotNodes(100);
		const dom = flattenDom(
			await domNodes("#form", { depth: 3, includeHidden: true }),
		);
		const find = await findNodes("#form input, #form select");

		// text input value
		const snapText = snap.find((n) => n.refId === "e1");
		const domText = dom.find((n) => n.refId === "e1");
		const findText = find.find((n) => n.refId === "e1");
		expect(snapText?.value).toBe("hello");
		expect(domText?.value).toBe("hello");
		expect(findText?.value).toBe("hello");

		// title parity across all three surfaces (enriched by enrichInput)
		expect(snapText?.title).toBe("hint");
		expect(domText?.title).toBe("hint");
		expect(findText?.title).toBe("hint");

		// valid (affirmative) parity: t1 has no constraint violations, so all three
		// surfaces must report valid===true. Closes the W-D gap — the invalid path
		// is covered below, this pins the affirmative twin.
		expect(snapText?.valid).toBe(true);
		expect(domText?.valid).toBe(true);
		expect(findText?.valid).toBe(true);

		// checkbox checked
		const snapCheckbox = snap.find((n) => n.refId === "e3");
		const domCheckbox = dom.find((n) => n.refId === "e3");
		const findCheckbox = find.find((n) => n.refId === "e3");
		expect(snapCheckbox?.checked).toBe(true);
		expect(domCheckbox?.checked).toBe(true);
		expect(findCheckbox?.checked).toBe(true);

		// select value
		const snapSelect = snap.find((n) => n.refId === "e5");
		const domSelect = dom.find((n) => n.refId === "e5");
		const findSelect = find.find((n) => n.refId === "e5");
		expect(snapSelect?.value).toBe("b");
		expect(domSelect?.value).toBe("b");
		expect(findSelect?.value).toBe("b");

		// selected parity on the <option> itself (W-C). Snapshot drops options
		// via shouldInclude in most layouts, so this is dom/find parity; the
		// option carrying selected===true is the contract being pinned.
		const domOptB = dom.find((n) => n.tag === "option" && n.value === "b");
		const findOpts = await findNodes("#form option");
		const findOptB = findOpts.find((n) => n.value === "b");
		expect(domOptB?.selected).toBe(true);
		expect(findOptB?.selected).toBe(true);
		const domOptA = dom.find((n) => n.tag === "option" && n.value === "a");
		const findOptA = findOpts.find((n) => n.value === "a");
		expect(domOptA?.selected).toBe(false);
		expect(findOptA?.selected).toBe(false);

		// file input accept + filesCount
		const snapFile = snap.find((n) => n.refId === "e6");
		const domFile = dom.find((n) => n.refId === "e6");
		const findFile = find.find((n) => n.refId === "e6");
		expect(snapFile?.accept).toBe(".pdf");
		expect(snapFile?.filesCount).toBe(0);
		expect(domFile?.accept).toBe(".pdf");
		expect(domFile?.filesCount).toBe(0);
		expect(findFile?.accept).toBe(".pdf");
		expect(findFile?.filesCount).toBe(0);

		// required invalid input
		const snapRequired = snap.find((n) => n.refId === "e2");
		expect(snapRequired?.required).toBe(true);
		expect(snapRequired?.invalid).toBe(true);
		const domRequired = dom.find((n) => n.refId === "e2");
		expect(domRequired?.required).toBe(true);
		expect(domRequired?.invalid).toBe(true);
		const findRequired = find.find((n) => n.refId === "e2");
		expect(findRequired?.required).toBe(true);
		expect(findRequired?.invalid).toBe(true);
	});

	it("validation proxy present as controlType validation-proxy, actionable false in snapshot and dom", async () => {
		// Use e\d+ refIds so allocateRefId preserves them.
		document.body.innerHTML = `
			<div role="combobox" aria-label="Choose" data-ref-id="e10" aria-expanded="false">
				<input type="text" required aria-hidden="true" data-ref-id="e11" />
			</div>
		`;

		const snap = snapshotNodes(100);
		const snapProxy = snap.find((n) => n.refId === "e11");
		expect(snapProxy?.controlType).toBe("validation-proxy");
		expect(snapProxy?.actionable).toBe(false);

		const dom = flattenDom(
			await domNodes('[role="combobox"]', {
				depth: 3,
				includeHidden: true,
			}),
		);
		const domProxy = dom.find((n) => n.refId === "e11");
		expect(domProxy?.controlType).toBe("validation-proxy");
		expect(domProxy?.actionable).toBe(false);

		const snapCombo = snap.find((n) => n.refId === "e10");
		expect(snapCombo?.controlType).toBe("dropdown");
		expect(snapCombo?.recommendedAction).toBe("select_option");

		const domCombo = dom.find((n) => n.refId === "e10");
		// DOM already carries dropdown enrichment (enrichDropdown is called).
		expect(domCombo?.controlType).toBe("dropdown");
		expect(domCombo?.recommendedAction).toBe("select_option");
	});
});

// ---------------------------------------------------------------------------
// Group 5: clickability and dedupe behavior stays stable
// ---------------------------------------------------------------------------

describe("clickability and dedupe behavior stays stable", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		setupSpecs();
	});

	it("known clickable controls are actionable", () => {
		// jsaction must contain a "." in the action name to be detected.
		document.body.innerHTML = `
			<div role="menuitem" aria-label="Mark as read"></div>
			<div role="tab" aria-label="Promotions"></div>
			<span tabindex="0" aria-label="More"></span>
			<div jsaction="click:foo.bar" aria-label="Action"></div>
		`;
		const snap = collectInlineSnapshot(100);
		expect(snap.nodes.find((n) => n.name === "Mark as read")?.actionable).toBe(
			true,
		);
		expect(snap.nodes.find((n) => n.name === "Promotions")?.actionable).toBe(
			true,
		);
		expect(snap.nodes.find((n) => n.name === "More")?.actionable).toBe(true);
		expect(snap.nodes.find((n) => n.name === "Action")?.actionable).toBe(true);
	});

	it("dedupe removes low-confidence wrapper actionable but keeps node emitted", () => {
		document.body.innerHTML = `
			<span class="btn-group">
				<a href="/x" data-ref-id="a1">link</a>
			</span>
		`;
		const snap = collectInlineSnapshot(100);
		const wrapper = snap.nodes.find((n) => n.tag === "span");
		expect(wrapper).toBeDefined();
		expect(wrapper?.actionable).toBe(false);
		expect(wrapper?.recommendedAction).toBeUndefined();
		// Node is still emitted (not removed from list)
		const link = snap.nodes.find((n) => n.tag === "a");
		expect(link).toBeDefined();
		expect(link?.actionable).not.toBe(false);
	});

	it("mustKeep beats dedupe: text-bearing wrapper keeps mustKeep + text even when actionable is stripped", () => {
		// The fourth axis of the AGENTS.md invariant: mustKeep beats dedupe.
		// A wrapper that BOTH (a) is a low-confidence clickable wrapper AND
		// (b) carries visible text (mustKeep=true) must keep its text/mustKeep
		// even though dedupe strips actionable/recommendedAction/confidence.
		document.body.innerHTML = `
			<span class="btn-group" data-ref-id="e80">WRAP_TEXT
				<a href="/x" data-ref-id="e81">link</a>
			</span>
		`;
		const snap = collectInlineSnapshot(100);
		const wrapper = snap.nodes.find((n) => n.refId === "e80");
		expect(wrapper).toBeDefined();
		// dedupe strips actionable on the low-confidence wrapper
		expect(wrapper?.actionable).toBe(false);
		expect(wrapper?.recommendedAction).toBeUndefined();
		// ...but mustKeep + visible text survive dedupe
		expect(wrapper?.mustKeep).toBe(true);
		expect(wrapper?.text).toContain("WRAP_TEXT");
		// ...and rendering preserves the text in the snapshot text surface
		expect(snap.text).toContain("WRAP_TEXT");
	});
});

// ---------------------------------------------------------------------------
// Group 6: URL and media metadata parity
// ---------------------------------------------------------------------------

describe("URL and media metadata parity", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		setupSpecs();
	});

	it("snapshot, dom, and find agree on href/src/alt/parentRefId/postId", async () => {
		// Use e\d+ refIds so allocateRefId preserves them.
		document.body.innerHTML = `
			<article data-post-id="post-42" data-ref-id="e20">
				<a href="/relative/path" data-ref-id="e21">Link</a>
				<img src="/img/photo.jpg" alt="Photo alt" data-ref-id="e22" />
			</article>
		`;

		const snap = snapshotNodes(100);
		const dom = flattenDom(
			await domNodes("article", { depth: 3, includeHidden: true }),
		);
		const find = await findNodes("a, img");

		const snapLink = snap.find((n) => n.refId === "e21");
		const domLink = dom.find((n) => n.refId === "e21");
		const findLink = find.find((n) => n.refId === "e21");

		expect(snapLink?.href).toMatch(/^http.+\/relative\/path$/);
		expect(domLink?.href).toMatch(/^http.+\/relative\/path$/);
		expect(findLink?.href).toMatch(/^http.+\/relative\/path$/);

		const snapImg = snap.find((n) => n.refId === "e22");
		const domImg = dom.find((n) => n.refId === "e22");
		const findImg = find.find((n) => n.refId === "e22");

		expect(snapImg?.src).toMatch(/^http.+\/img\/photo\.jpg$/);
		expect(snapImg?.alt).toBe("Photo alt");
		expect(domImg?.src).toMatch(/^http.+\/img\/photo\.jpg$/);
		expect(domImg?.alt).toBe("Photo alt");
		expect(findImg?.src).toMatch(/^http.+\/img\/photo\.jpg$/);
		expect(findImg?.alt).toBe("Photo alt");

		// parentRefId should point to the article container
		expect(snapLink?.parentRefId).toBe("e20");
		expect(snapImg?.parentRefId).toBe("e20");
		expect(domLink?.parentRefId).toBe("e20");
		expect(domImg?.parentRefId).toBe("e20");
		expect(findLink?.parentRefId).toBe("e20");
		expect(findImg?.parentRefId).toBe("e20");

		// postId on article
		const snapArticle = snap.find((n) => n.refId === "e20");
		expect(snapArticle?.postId).toBe("post-42");
		const domArticle = dom.find((n) => n.refId === "e20");
		expect(domArticle?.postId).toBe("post-42");
		const findArticle = await findNodes("article");
		expect(findArticle[0]?.postId).toBe("post-42");
	});

	it("unsupported URL schemes (javascript/mailto/data) are omitted across snapshot, dom, and find", async () => {
		// jsdom resolves javascript:/mailto:/data: anchors; only http/https/file
		// are surfaced. The href field must be absent, not a non-http string.
		document.body.innerHTML = `
			<a href="javascript:void(0)" data-ref-id="e40">JS_LINK</a>
			<a href="mailto:user@example.com" data-ref-id="e41">MAILTO_LINK</a>
			<a href="data:text/plain,hello" data-ref-id="e43">DATA_LINK</a>
			<a href="/ok/path" data-ref-id="e42">OK_LINK</a>
		`;
		const snap = snapshotNodes(100);
		const dom = flattenDom(
			await domNodes("a", { depth: 0, includeHidden: false }),
		);
		const find = await findNodes("a");

		const snapJs = snap.find((n) => n.refId === "e40");
		const domJs = dom.find((n) => n.refId === "e40");
		const findJs = find.find((n) => n.refId === "e40");
		expect(snapJs?.href).toBeUndefined();
		expect(domJs?.href).toBeUndefined();
		expect(findJs?.href).toBeUndefined();

		const snapMailto = snap.find((n) => n.refId === "e41");
		const domMailto = dom.find((n) => n.refId === "e41");
		const findMailto = find.find((n) => n.refId === "e41");
		expect(snapMailto?.href).toBeUndefined();
		expect(domMailto?.href).toBeUndefined();
		expect(findMailto?.href).toBeUndefined();

		// data: URLs are also a non-http scheme and must be omitted across all surfaces.
		const snapData = snap.find((n) => n.refId === "e43");
		const domData = dom.find((n) => n.refId === "e43");
		const findData = find.find((n) => n.refId === "e43");
		expect(snapData?.href).toBeUndefined();
		expect(domData?.href).toBeUndefined();
		expect(findData?.href).toBeUndefined();

		// Sanity: the supported-scheme anchor resolves to an absolute URL across
		// all three surfaces (positive control, not just the omission negative).
		const snapOk = snap.find((n) => n.refId === "e42");
		const domOk = dom.find((n) => n.refId === "e42");
		const findOk = find.find((n) => n.refId === "e42");
		expect(snapOk?.href).toMatch(/^http.+\/ok\/path$/);
		expect(domOk?.href).toMatch(/^http.+\/ok\/path$/);
		expect(findOk?.href).toMatch(/^http.+\/ok\/path$/);
	});

	it("permalink and imageUrls emitted in parity across snapshot, dom, and find", async () => {
		// A non-anchor container owning a heading anchor + child images gets
		// `permalink` (resolved from the heading link) and `imageUrls` (the
		// descendant img srcs). The anchor itself is not enriched with permalink
		// (it is the link), but the container is.
		document.body.innerHTML = `
			<article data-ref-id="e50">
				<h2><a href="/posts/123" data-ref-id="e51">Title</a></h2>
				<p data-ref-id="e52">PARMA_BODY_TEXT
					<img src="/img/a.jpg" data-ref-id="e53" />
					<img src="/img/b.jpg" data-ref-id="e54" />
				</p>
			</article>
		`;
		const snap = snapshotNodes(100);
		const dom = flattenDom(
			await domNodes("article", { depth: 6, includeHidden: false }),
		);
		const find = await findNodes("article, p");

		// permalink on the article (non-anchor with a scoped h2 a[href])
		const snapArticle = snap.find((n) => n.refId === "e50");
		const domArticle = dom.find((n) => n.refId === "e50");
		expect(snapArticle?.permalink).toMatch(/^http.+\/posts\/123$/);
		expect(domArticle?.permalink).toMatch(/^http.+\/posts\/123$/);

		// imageUrls on the paragraph containing the two images
		const snapPara = snap.find((n) => n.refId === "e52");
		const domPara = dom.find((n) => n.refId === "e52");
		const findPara = find.find(
			(n) => n.tag === "p" && n.text?.includes("PARMA_BODY_TEXT"),
		);
		expect(snapPara?.imageUrls?.length).toBe(2);
		expect(domPara?.imageUrls?.length).toBe(2);
		expect(findPara?.imageUrls?.length).toBe(2);
		expect(snapPara?.imageUrls?.[0]).toMatch(/^http.+\/img\/a\.jpg$/);
		expect(findPara?.imageUrls?.[0]).toMatch(/^http.+\/img\/a\.jpg$/);
	});
});

// ---------------------------------------------------------------------------
// Group 7: observation lease grants actionable refs
// ---------------------------------------------------------------------------

describe("observation lease grants actionable refs", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		setupSpecs();
		resetLease();
	});

	it("snapshot refId is clickable in same lease", async () => {
		document.body.innerHTML = `<button id="b1" data-ref-id="e30">Go</button>`;
		let clicked = false;
		document.getElementById("b1")!.addEventListener("click", () => {
			clicked = true;
		});

		// grantFromInlineSnapshot grants the lease; collectInlineSnapshot alone does not.
		const granted = grantFromInlineSnapshot(100);
		const refId = granted.nodes.find((n) => n.tag === "button")?.refId;
		expect(refId).toMatch(/^e\d+$/);

		const clickResult = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ refId },
		);
		expect(clickResult.ok).toBe(true);
		expect(clicked).toBe(true);
	});

	it("dom refId is clickable in same lease", async () => {
		document.body.innerHTML = `<button id="b2" data-ref-id="e31">Dom</button>`;
		let clicked = false;
		document.getElementById("b2")!.addEventListener("click", () => {
			clicked = true;
		});

		await domNodes("button", { depth: 0 });
		const clickResult = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ refId: "e31" },
		);
		expect(clickResult.ok).toBe(true);
		expect(clicked).toBe(true);
	});

	it("find refId is clickable in same lease", async () => {
		document.body.innerHTML = `<button id="b3" data-ref-id="e32">Find</button>`;
		let clicked = false;
		document.getElementById("b3")!.addEventListener("click", () => {
			clicked = true;
		});

		await findNodes("button");
		const clickResult = await dispatchContentScriptCall(
			"page_click",
			"click",
			handlers.click,
			{ refId: "e32" },
		);
		expect(clickResult.ok).toBe(true);
		expect(clicked).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Group 8: mutation guard remains snapshot-only
// ---------------------------------------------------------------------------

describe("mutation guard remains snapshot-only", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		setupSpecs();
	});

	it("snapshot throws E_SNAPSHOT when DOM mutates during walk", () => {
		document.body.innerHTML = `<div id="root"><span>text</span></div>`;

		// Stub MutationObserver to fire callback synchronously during walk
		const origObserver = globalThis.MutationObserver;
		let callback: ((mutations: MutationRecord[]) => void) | null = null;
		globalThis.MutationObserver = class {
			observe() {
				if (callback) callback([]);
			}
			disconnect() {}
			takeRecords() {
				return [{} as MutationRecord];
			}
			constructor(cb: (mutations: MutationRecord[]) => void) {
				callback = cb;
			}
		};

		try {
			let thrown: (Error & { code?: string }) | null = null;
			try {
				collectInlineSnapshot(100);
			} catch (e) {
				thrown = e as Error & { code?: string };
			}
			expect(thrown, "snapshot should throw on mutation").not.toBeNull();
			// Pin the structured error code, not just "threw something".
			// A bare TypeError regression would fail this assertion.
			expect(thrown?.code).toBe("E_SNAPSHOT");
		} finally {
			globalThis.MutationObserver = origObserver;
		}
	});

	it("dom does not throw E_SNAPSHOT when DOM mutates", async () => {
		document.body.innerHTML = `<div id="root"><span>text</span></div>`;

		const origObserver = globalThis.MutationObserver;
		let callback: ((mutations: MutationRecord[]) => void) | null = null;
		globalThis.MutationObserver = class {
			observe() {
				if (callback) callback([]);
			}
			disconnect() {}
			takeRecords() {
				return [{} as MutationRecord];
			}
			constructor(cb: (mutations: MutationRecord[]) => void) {
				callback = cb;
			}
		};

		try {
			const result = await dispatchContentScriptCall(
				"page_dom",
				"dom",
				handlers.dom,
				{ selector: "div", depth: 1 },
			);
			expect(result.ok).toBe(true);
		} finally {
			globalThis.MutationObserver = origObserver;
		}
	});

	it("find does not throw E_SNAPSHOT when DOM mutates", async () => {
		document.body.innerHTML = `<div id="root"><span>text</span></div>`;

		const origObserver = globalThis.MutationObserver;
		let callback: ((mutations: MutationRecord[]) => void) | null = null;
		globalThis.MutationObserver = class {
			observe() {
				if (callback) callback([]);
			}
			disconnect() {}
			takeRecords() {
				return [{} as MutationRecord];
			}
			constructor(cb: (mutations: MutationRecord[]) => void) {
				callback = cb;
			}
		};

		try {
			const result = await dispatchContentScriptCall(
				"page_find",
				"find",
				handlers.find,
				{ selector: "span" },
			);
			expect(result.ok).toBe(true);
		} finally {
			globalThis.MutationObserver = origObserver;
		}
	});
});
