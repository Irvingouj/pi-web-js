# Snapshot and DOM Pipeline Implementation Draft

## Goal

Make the extension content-script snapshot/DOM handler family less fragile by
moving shared DOM traversal, keep/drop decisions, metadata enrichment, and API
output shaping behind one recursive pipeline.

Product scope is extension-js only:

- `page.snapshot`
- `page.snapshot_text`
- `page.snapshot_data`
- `page.snapshot_query`
- `page.dom`
- `page.find`
- `web.tab.*` callers that route through the same content-script actions

Do not redesign the older `crates/dom-semantic-tree` Rust/WASM path for this
work. It is not the product path.

## Current Fragility

The current code has overlapping behavior in several places:

- `crates/extension-js/js/src/shared/cross/collect-inline-snapshot.ts`
  already has a partial guard/enricher pipeline, but it owns traversal,
  emission, dedupe, rendering, and form-error derivation.
- `crates/extension-js/js/src/content-script/dom-tree.ts` separately walks DOM
  nodes for `page.dom`.
- `crates/extension-js/js/src/content-script/handlers.ts` hand-builds nodes for
  `page.find`.
- `crates/extension-js/js/src/shared/cs/snapshot-dom.ts` owns role/name/text,
  visibility, form state, URL, and clickability helpers, but not a stable
  pipeline contract.

The result: new behavior can be fixed in one API and silently missing in
another.

## Tests To Add First

Add tests before refactoring. Keep them behavior-level, not implementation-level.

### 1. Shared visible-text invariant across surfaces

File: `crates/extension-js/js/test/snapshot-pipeline.test.ts`

Fixture DOM:

- nested generic containers with visible text
- `role="presentation"` and `role="none"` visible text
- `aria-live`, `role="status"`, `role="alert"`
- hidden variants: `display:none`, `visibility:hidden`, `hidden`,
  `aria-hidden="true"`, `inert`

Assert:

- `collectInlineSnapshot(1)` includes every visible sentinel
- each visible sentinel node has `mustKeep: true`
- hidden sentinels are absent
- low `maxNodes` does not drop `mustKeep` visible text
- `page.dom` builder includes the same visible sentinels when
  `includeHidden: false`
- `page.find` output for a matched visible element carries the same basic node
  fields as snapshot: `refId`, `tag`, `role`, `name`, `text`, form state where
  relevant

### 2. Pipeline preserves child traversal when parent is skipped

Fixture DOM:

```html
<div id="wrapper">
  <script>ignored</script>
  <div class="structural">
    <span>PIPELINE_CHILD_VISIBLE</span>
  </div>
</div>
```

Assert:

- excluded tags are skipped with subtree ignored
- non-emitted structural parents still allow visible descendants through
- emitted child depth/rendering remains stable enough that snapshot text still
  contains the child under a sensible indentation

### 3. `mustKeep` beats filters and limits

Fixture DOM:

- several clickable/actionable controls
- several visible-text generic nodes

Assert:

- `snapshot_query({ filter: { interactiveOnly: true, limit: 1 } })` still
  returns all `mustKeep` visible-text nodes
- non-`mustKeep` nodes are limited
- interactive controls still pass through when under the limit

### 4. Form metadata parity across snapshot, DOM, and find

Fixture DOM:

- text input with value
- required invalid input with `validationMessage`
- checkbox/radio checked state
- select and option values
- file input with `accept` and file count
- react-select style hidden validation proxy inside `[role="combobox"]`

Assert:

- snapshot nodes include form state
- DOM nodes include the same form state
- find nodes include the same form state for matched elements
- validation proxy is present as `controlType: "validation-proxy"` and
  `actionable: false`
- combobox/select gets `controlType: "dropdown"` and
  `recommendedAction: "select_option"`

### 5. Clickability and dedupe behavior stays stable

Fixture DOM:

- clickable wrapper with clickable child
- Gmail-style `jsaction` element with `aria-label`
- icon-only `tabindex="0"` element with `aria-label`
- `role="menuitem"` and `role="tab"`

Assert:

- known clickable controls are actionable
- dedupe removes low-confidence wrapper actionability when a better child
  exists
- nodes remain emitted even if dedupe removes `recommendedAction`

### 6. URL and media metadata parity

Fixture DOM:

- anchor with relative `href`
- image with relative `src`, `alt`
- container with `data-post-id`
- non-anchor element with permalink child
- element with child images

Assert:

- snapshot, DOM, and find agree on `href`, `src`, `alt`, `parentRefId`,
  `postId`, `permalink`, and `imageUrls` where the API output supports them
- unsupported URL schemes are omitted

### 7. Observation lease still grants actionable refs

Use existing content-script handler tests where possible.

Assert:

- snapshot grants refs for emitted nodes
- DOM grants refs for returned nodes
- find grants refs for returned nodes
- actions can still resolve a ref returned by each API in the same observation
  lease

### 8. Mutation guard remains snapshot-only

Assert:

- snapshot still throws structured `E_SNAPSHOT` if DOM mutates during collection
- DOM/find behavior does not accidentally inherit snapshot mutation guard unless
  intentionally changed

## Plan

### Phase 1: Introduce shared node construction without changing output

Create one small shared module:

`crates/extension-js/js/src/shared/cs/dom-pipeline.ts`

It should own:

- recursive DOM walk
- pipeline pass types
- shared node base construction
- shared enrichers currently split between snapshot, DOM, and find

Do not move rendering, snapshot filtering, or snapshot wrapper response shape in
this phase.

### Phase 2: Move snapshot collection onto the shared walker

Update `collect-inline-snapshot.ts` to use the shared walker and snapshot
pipeline.

Keep these local to snapshot collection:

- mutation guard
- wrapper clickability dedupe
- text rendering
- form-error derivation
- final `InlineSnapshotResult` shape

### Phase 3: Move `page.dom` onto the shared walker

Replace `buildDomNode` recursion with the shared walker plus a DOM output
adapter.

`dom-tree.ts` can become a thin adapter module or be deleted if the adapter is
clearer in `dom-pipeline.ts`.

### Phase 4: Move `page.find` onto the shared node builder

Stop hand-building `Record<string, unknown>` in `handlers.ts`.

Use the same element-to-node path as snapshot/DOM, then choose the find output
fields.

This should also remove the visible `Record<string, unknown>` public/test-facing
shape from that code path.

### Phase 5: Tighten types and delete duplicate helpers

After behavior is pinned and all surfaces use the shared path:

- delete duplicate form/url/dropdown enrichment code
- keep `snapshot-dom.ts` as low-level DOM helper functions only
- keep `collect-inline-snapshot.ts` focused on snapshot-specific orchestration
- keep handlers focused on params, lease grants, and response shape

## Detailed Code Shape

### Core Types

```ts
export type WalkMode = "snapshot" | "dom" | "find";

export type HiddenReason =
	| "display-none"
	| "visibility-hidden"
	| "aria-hidden"
	| "opacity-zero"
	| "hidden-attr"
	| "inert";

export type BasePipelineNode = {
	refId: string;
	tag: string;
	role: string;
	name?: string;
	text?: string;
	mustKeep?: true;
	value?: string;
	checked?: boolean;
	disabled?: boolean;
	readOnly?: boolean;
	selected?: boolean;
	required?: boolean;
	valid?: boolean;
	invalid?: boolean;
	validationMessage?: string;
	errorMessage?: string;
	href?: string;
	src?: string;
	alt?: string;
	title?: string;
	parentRefId?: string;
	postId?: string;
	permalink?: string;
	imageUrls?: string[];
	accept?: string;
	filesCount?: number;
	controlType?: string;
	actionable?: boolean;
	recommendedAction?: string;
	confidence?: "high" | "low";
	controls?: string;
	expanded?: boolean;
	forControl?: string;
	hidden?: boolean;
	hiddenReason?: HiddenReason;
	attributes?: Record<string, string>;
};

export type ElementContext = {
	el: Element;
	depth: number;
	parentRefId: string;
	mode: WalkMode;
	includeHidden: boolean;
	node: Partial<BasePipelineNode>;
	meta: {
		excludedTag?: boolean;
		selfOrAncestorHidden?: boolean;
		hiddenReason?: HiddenReason;
		hasVisibleText?: boolean;
		shouldIncludeSnapshot?: boolean;
	};
};

export type PipelineDecision =
	| { kind: "continue"; ctx: ElementContext }
	| { kind: "skip-subtree" }
	| { kind: "skip-self"; descend: true };

export type PipelinePass = (ctx: ElementContext) => PipelineDecision;
```

Keep the type boring. Avoid pass classes or a plugin registry.

### Walker

```ts
export function walkElements(options: {
	root: Element;
	mode: WalkMode;
	maxNodes?: number;
	depthLimit?: number;
	includeHidden?: boolean;
	passes: PipelinePass[];
	emit: (ctx: ElementContext) => BasePipelineNode | null;
}): Array<{ el: Element; depth: number; node: BasePipelineNode }> {
	const out: Array<{ el: Element; depth: number; node: BasePipelineNode }> = [];

	function visit(el: Element, depth: number, parentRefId: string): void {
		if (options.depthLimit !== undefined && depth > options.depthLimit) return;

		let ctx: ElementContext = {
			el,
			depth,
			parentRefId,
			mode: options.mode,
			includeHidden: options.includeHidden ?? false,
			node: {},
			meta: {},
		};

		for (const pass of options.passes) {
			const next = pass(ctx);
			if (next.kind === "skip-subtree") return;
			if (next.kind === "skip-self") {
				for (const child of Array.from(el.children)) {
					visit(child, depth, parentRefId);
				}
				return;
			}
			ctx = next.ctx;
		}

		const node = options.emit(ctx);
		const childDepth = node ? depth + 1 : depth;
		const childParentRefId = node?.refId ?? parentRefId;
		if (node) out.push({ el, depth, node });

		for (const child of Array.from(el.children)) {
			visit(child, childDepth, childParentRefId);
		}
	}

	visit(options.root, 0, "");
	return out;
}
```

Capacity behavior for snapshot should be in the snapshot emit function, because
`mustKeep` can bypass capacity. Do not hide that rule in generic traversal.

### Shared Passes

Use small function passes:

```ts
export const rejectExcludedSnapshotTags: PipelinePass = (ctx) => {
	const tag = ctx.el.tagName.toLowerCase();
	return tag === "script" || tag === "style" || tag === "noscript" || tag === "template"
		? { kind: "skip-subtree" }
		: { kind: "continue", ctx };
};

export const readVisibility: PipelinePass = (ctx) => {
	const hiddenReason = hiddenReasonFor(ctx.el);
	return {
		kind: "continue",
		ctx: {
			...ctx,
			meta: {
				...ctx.meta,
				selfOrAncestorHidden: isSelfOrAncestorHidden(ctx.el),
				hiddenReason,
			},
		},
	};
};

export const readBaseSemantics: PipelinePass = (ctx) => {
	const tag = ctx.el.tagName.toLowerCase();
	const text = getOwnVisibleText(ctx.el, 100);
	const name = getAccessibleName(ctx.el);
	return {
		kind: "continue",
		ctx: {
			...ctx,
			node: {
				...ctx.node,
				tag,
				role: getAccessibleRole(ctx.el),
				text: text || undefined,
				name: name || undefined,
			},
		},
	};
};
```

Add passes for:

- `markVisibleTextMustKeep`
- `readFormState`
- `readValidationProxy`
- `readDropdown`
- `readClickability`
- `readLinksAndImages`
- `readPostAndPermalink`
- `readRawAttributes` for DOM mode only

### Snapshot Emit

```ts
function createSnapshotEmitter(maxNodes: number) {
	let count = 0;

	return (ctx: ElementContext): BasePipelineNode | null => {
		if (!shouldInclude(ctx.el)) {
			return null;
		}

		const mustKeep = ctx.meta.hasVisibleText === true;
		if (count >= maxNodes && !mustKeep) {
			return null;
		}

		const refId = allocateRefId(ctx.el);
		const node: BasePipelineNode = {
			refId,
			tag: requireString(ctx.node.tag, "tag"),
			role: requireString(ctx.node.role, "role"),
			...ctx.node,
		};

		if (mustKeep) node.mustKeep = true;
		if ((node.tag === "img" || node.tag === "a") && ctx.parentRefId) {
			node.parentRefId = ctx.parentRefId;
		}

		count++;
		return node;
	};
}
```

Use a tiny internal helper for required fields if TypeScript needs it. Do not
add zod inside DOM traversal; this is not an external-data boundary.

### DOM Emit

```ts
function createDomEmitter(includeHidden: boolean) {
	return (ctx: ElementContext): BasePipelineNode | null => {
		if (!includeHidden && ctx.meta.selfOrAncestorHidden) return null;

		const refId = allocateRefId(ctx.el);
		const node: BasePipelineNode = {
			refId,
			tag: requireString(ctx.node.tag, "tag"),
			role: requireString(ctx.node.role, "role"),
			...ctx.node,
		};

		if (ctx.meta.hasVisibleText) node.mustKeep = true;
		if (ctx.meta.hiddenReason) {
			node.hidden = true;
			node.hiddenReason = ctx.meta.hiddenReason;
		}

		return node;
	};
}
```

DOM nesting can be reconstructed from the flat walk result, or the walker can
support a tree adapter. Prefer the smallest diff. Since current `page.dom`
returns nested children, a simple recursive tree emitter may be less churn than
flat reconstruction.

### Snapshot Result Flow

`collectInlineSnapshot(maxNodes)` should become:

```ts
export function collectInlineSnapshot(maxNodes: number): InlineSnapshotResult {
	syncRefIdCounterFromDom();

	return withMutationGuard(() => {
		const walked = document.body
			? walkElements({
					root: document.body,
					mode: "snapshot",
					maxNodes,
					passes: snapshotPasses,
					emit: createSnapshotEmitter(maxNodes),
				})
			: [];

		const nodes = walked.map((x) => x.node as InlineSnapshotNode);
		applyClickableWrapperDedupe(nodes, walked.map((x) => x.el));

		return {
			text: renderSnapshotText(nodes, walked.map((x) => x.depth)),
			nodes,
			formErrors: deriveFormErrors(nodes),
			url: window.location.href,
			title: document.title,
			viewport: { width: window.innerWidth, height: window.innerHeight },
		};
	});
}
```

### Handler Flow

Handlers should stay boring:

- parse params
- call collector/builder
- grant observation
- return response

`handlers.ts` should not know how to enrich an anchor, image, input, combobox,
or clickable wrapper.

## Acceptance Criteria

- All new behavior-pinning tests pass.
- Existing snapshot tests pass:
  - `crates/extension-js/js/test/snapshot-dom.test.ts`
  - `crates/extension-js/js/test/snapshot-filter.test.ts`
  - `crates/extension-js/js/test/snapshot-bounds.test.ts`
  - `crates/extension-js/js/test/snapshot-dispatch.test.ts`
  - `web/tests/e2e/extension/snapshot-visible-text.spec.ts`
- `page.snapshot`, `page.snapshot_text`, and `page.snapshot_data` output remains
  backward compatible.
- `page.snapshot_query` still applies filters after snapshot collection, and
  `mustKeep` nodes survive interactive filters and limits.
- `page.dom` still returns nested children and grants actionable `refId`s.
- `page.find` no longer hand-builds partial node objects.
- Visible text invariant is centralized:
  - if visible text exists, the node is `mustKeep`
  - `mustKeep` is not dropped by capacity, filters, dedupe, or rendering
- Hidden text remains excluded from snapshot when hidden by CSS/ARIA/HTML/inert.
- DOM mode with `includeHidden: true` can report hidden nodes with
  `hiddenReason`.
- Snapshot mutation guard behavior is unchanged.
- No new runtime dependency.
- No new abstraction registry, class hierarchy, or plugin system.
- No visible `any`.
- No new public `Record<string, unknown>` shapes for extension-js API output.

## Non-Goals

- Do not redesign `crates/dom-semantic-tree`.
- Do not change public API names.
- Do not add new snapshot formats.
- Do not add a generic visitor framework beyond this local DOM pipeline.
- Do not change Chrome/native parity transport.

