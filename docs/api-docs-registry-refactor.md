# API Docs & Tool Registry Refactor — Handoff Spec

**Status:** Ready for implementation (separate worktree)  
**Owner:** Dedicated agent — API docs + registry consolidation only  
**Parallel track:** Main worktree implements `problems.md` runtime fixes (AgentError, fail-fast CS, `page.health`, mutation receipts, etc.)  
**Audience:** Implementing agent with no prior chat context

---

## What

Fix extension-js **API documentation** so agents can learn real parameter shapes, return types, prerequisites, and semantic notes from `runtime.apiDocs()` / `ExtensionSession.apiDocs()` — not empty params or useless `"null"` / `"undefined"` types.

Consolidate the **content-script tool registration triple source of truth** into a single spec-derived flow, without breaking the existing manifest → WASM → execution pipeline.

---

## Why

### Agent pain (observed in Browsergent capability-check)

- `get_doc` / `apiDocs` listed parameters as `` `undefined` `` and returns as `` `undefined` `` when `paramTypes: []` was used despite a Zod schema existing.
- Agents cannot learn that `page.fill` is **object-only** `{ refId, value }` from docs alone.
- Agents confuse `page.*` vs `web.tab.*` and assume snapshot success implies mutation capability — docs do not state prerequisites.
- Return type `"null"` for mutations hides the upcoming `PageActionResult` contract.

### Maintainer pain

The same content-script API is declared in **three places** that must be manually kept in sync:

| # | Location | Role |
|---|----------|------|
| 1 | `crates/extension-js/js/src/shared/registry/content-script-actions.ts` | `CONTENT_SCRIPT_ACTIONS` Set |
| 2 | `crates/extension-js/js/src/content-script/schemas.ts` | `ACTION_SCHEMAS` (params/returns Zod) |
| 3 | `crates/extension-js/js/src/main/runner/tools/page.ts` (and `tab.ts`) | `registerContentScriptJsCall({ paramTypes, ... })` |

Docs are a **fourth** partial copy via hand-written `paramTypes` / `returnDoc`.

---

## How It Works Today

### End-to-end flow

```
sidepanel loads runner/index.ts
  → registerJsCall / registerContentScriptJsCall (tools/*.ts)
  → jsRegistry (all APIs) + toolRegistry (main-thread handlers only)

ExtensionSession.init()
  → freezeJsRegistry() — orphan validation
  → getSerializableJsManifest() — paramsDoc from spec.paramTypes ?? []
  → post manifest to Worker

Worker initWasm()
  → register_js_call_batch(manifestEntryToWasm(entry), callback)
  → Rust web_js_core::api_docs::ApiManifestEntry
  → populateRoutesFromManifest()
  → freezeManifest()

QuickJS: page.fill({...})
  → WASM async → worker callback → relay
  → ExtensionSession.executeContentScriptCommand()
  → chrome.tabs.sendMessage → content-script/registry
  → dispatchValidated(ACTION_SCHEMAS[action]) → handlers.fill
```

### Key files

| Concern | File(s) |
|---------|---------|
| JS registration | `crates/extension-js/js/src/shared/tool-registry.ts` |
| Manifest types | `crates/extension-js/js/src/shared/registry/manifest.ts` |
| Zod validation + `describeSchema` | `crates/extension-js/js/src/shared/registry/dispatch.ts` |
| CS action list | `crates/extension-js/js/src/shared/registry/content-script-actions.ts` |
| CS schemas (duplicate) | `crates/extension-js/js/src/content-script/schemas.ts` |
| CS dispatch | `crates/extension-js/js/src/content-script/registry.ts` |
| Tool registrations | `crates/extension-js/js/src/main/runner/tools/*.ts` |
| WASM import | `crates/extension-js/js/src/worker/worker.ts` (`initWasm`, `manifestEntryToWasm`) |
| Rust manifest + markdown | `crates/web-js-core/src/api_docs.rs` |
| WASM bridge | `crates/extension-js/src/lib.rs` (`registerJsCallBatch`) |
| Host apiDocs | `crates/extension-js/js/src/main/session/extension-session.ts` |
| Tests | `crates/extension-js/js/test/manifest-docs.test.ts` |

### Why docs are wrong today

In `getSerializableJsManifest()`:

```typescript
const paramsDoc = spec.paramTypes ?? [];  // empty → no params in docs
const returnsDoc = {
  type: spec.returnType ?? zodTypeName(spec.returns),  // z.null() → "null"
  description: spec.returnDoc ?? "Result",
};
```

`describeSchema()` already exists in `dispatch.ts` for **validation error messages** but is **not used for documentation**.

Known APIs with **`paramTypes: []`** today (non-exhaustive):

- `page.url`, `page.title`, `page.back`, `page.forward`, `page.reload`, `page.unhover`, `page.active_tab`
- `web.tab.current`, `web.tab.query` (partial)
- several `sidepanel.*`, `storage.*`, `clipboard.*`

Many mutation APIs **do** have hand-written `paramTypes` (e.g. `page.fill`) — the problem is **inconsistent** coverage and **coarse return types**.

---

## Target Architecture

**Principle:** Register once; **Zod is canonical** for params/returns; docs are **derived** unless explicitly overridden.

```
defineTool(spec)
  ├─ jsRegistry entry (manifest)
  ├─ toolRegistry handler (if main-thread)
  ├─ content-script spec (if CS) — no separate ACTION_SCHEMAS table
  └─ derived docs:
       paramsDoc  ← zodToParamDocs(params) with optional overrides
       returnsDoc ← named schema / zodTypeName + returnDoc
       agentMeta  ← prerequisites, notes, tags, relatedApis
```

### New / extended types

**`ToolAgentMeta`** (on `JsCallSpec` / manifest entry):

```typescript
type ToolAgentMeta = {
  prerequisites?: string[];
  notes?: string[];
  tags?: Array<"read" | "write" | "mutation" | "snapshot" | "navigation" | "chrome">;
  relatedApis?: string[];  // e.g. ["web.tab.fill"]
};
```

**`zodToParamDocs(schema)`** — extract from `ZodObject` shape:

- `name`, `type` (via `describeSchema`), `required` (not optional), `description` (from `.describe()` or override map)

**Markdown/json output** — extend `web-js-core` `generate_markdown()` to render Prerequisites, Notes, Tags, Related APIs.

### Coordination with parallel runtime work

The main worktree will land (do **not** block doc refactor on these, but **document** them):

| Runtime change | Doc impact |
|----------------|------------|
| `PageActionResult` replaces `z.null()` mutation returns | Update `returns` Zod + `returnDoc` when merging |
| `page.health()` new API | New manifest entry with full agent meta |
| `page.url` / `page.title` → main-thread | Change `owner`; remove from CS triple-list |
| `page.active_tab` → single object like `web.tab.current` | Update `returnsDoc` |
| `SnapshotNode` + form fields | Update snapshot API return docs |

**Rule for this workstream:** Build infra so these are **schema + meta updates**, not another doc-system rewrite.

---

## Explicit Refactor Plan

### Phase 1 — Zod → paramsDoc (highest ROI, no CS consolidation yet)

**Goal:** Every API with a `ZodObject` params schema gets non-empty `paramsDoc` automatically.

#### 1.1 Create `zod-to-docs.ts`

**New file:** `crates/extension-js/js/src/shared/registry/zod-to-docs.ts`

- Export `zodToParamDocs(schema: z.ZodTypeAny): ToolDocParam[]`
- Reuse or move `describeSchema` from `dispatch.ts` into a shared module (both import it — avoid duplication)
- For `ZodObject`: one `ToolDocParam` per key; honor optional/nullable
- For empty `ZodObject` / no-arg APIs: return `[]` (valid — means “no parameters”)
- Support `.describe("...")` on Zod fields as `description`
- Export `zodToReturnType(schema: z.ZodTypeAny): string` — prefer `describeSchema` over coarse `zodTypeName` (already handles `{ refId?: string, value?: string }`)

#### 1.2 Wire into manifest export

**Edit:** `crates/extension-js/js/src/shared/tool-registry.ts` — `getSerializableJsManifest()`

```typescript
const paramsDoc =
  spec.paramTypes && spec.paramTypes.length > 0
    ? spec.paramTypes
    : zodToParamDocs(spec.params);

const returnsDoc = {
  type: spec.returnType ?? zodToReturnType(spec.returns),
  description: spec.returnDoc ?? "Result",
};
```

**Policy:** Explicit `paramTypes` **wins** when non-empty (backward compatible). Empty array triggers auto-derivation.

#### 1.3 Tests

**Edit:** `crates/extension-js/js/test/manifest-docs.test.ts`

Add cases:

- `page.url` / `page.title`: paramsDoc may be `[]` but returns type is `string`, not `undefined`
- `page.fill`: paramsDoc includes `refId`, `value` (even if hand-written exists, must not regress)
- `page.click`: paramsDoc non-empty
- Chrome alias with `z.unknown()`: document behavior (paramsDoc empty OK; returns documented)

**Edit or add:** snapshot test for `apiDocs('markdown')` containing `page.fill` parameter section with `refId`.

#### 1.4 Verify

```bash
cd crates/extension-js/js && npm test -- manifest-docs
cd crates/extension-js/js && npm test -- runner.test  # manifest contract tests
```

---

### Phase 2 — Agent metadata on manifest

**Goal:** Docs explain prerequisites and read/write semantics for agents.

#### 2.1 Extend TS types

**Edit:** `crates/extension-js/js/src/shared/registry/manifest.ts`

Add to `JsCallSpec` and `SerializableJsCallManifestEntry`:

```typescript
prerequisites?: string[];
notes?: string[];
tags?: string[];
relatedApis?: string[];
```

**Edit:** `manifestEntryToWasm()` — pass new fields through (camelCase in JS → snake_case in Rust DTO if needed).

#### 2.2 Extend Rust DTO + markdown

**Edit:** `crates/web-js-core/src/api_docs.rs`

- Add optional fields to `JsManifestEntry` / `ApiManifestEntry` / `JsApiDoc` (serde defaults = omit empty)
- Update `generate_markdown()`:
  - **Prerequisites** — bullet list
  - **Notes** — bullet list
  - **Tags** — inline
  - **Related APIs** — bullet list

#### 2.3 Seed high-value metadata (manual, targeted)

**Edit:** `crates/extension-js/js/src/main/runner/tools/page.ts`, `tab.ts`, `page-snapshot.ts`

| API | prerequisites | notes | tags | relatedApis |
|-----|---------------|-------|------|-------------|
| `page.fill`, `page.click`, … mutations | `page.health()` on unknown/cold tabs | Same content-script path as `web.tab.*` | `mutation`, `write` | `web.tab.fill` etc. |
| `page.snapshot`, `page.snapshot_data` | — | Uses script injection; does not guarantee mutations work | `snapshot`, `read` | `web.tab.snapshot` |
| `page.health` | — | (new API — coordinate with main track) | `read` | — |
| `page.*` vs `web.tab.*` pair | — | `page.*` = active tab; `web.tab.*` = explicit tabId | — | cross-link |

Do **not** hand-write 130 entries in Phase 2 — only page/tab/snapshot/mutation cluster + any API with empty paramTypes that agents hit frequently.

#### 2.4 Tests

- Manifest entry includes `prerequisites` when set
- Markdown output contains `**Prerequisites**` for `page.fill`

---

### Phase 3 — Consolidate content-script registration

**Goal:** One registration path for CS APIs; delete `ACTION_SCHEMAS` duplication.

#### 3.1 Create `defineContentScriptTool`

**New file:** `crates/extension-js/js/src/shared/registry/define-content-script-tool.ts`

```typescript
export function defineContentScriptTool<P, R>(spec: {
  action: string;
  namespace: string;
  name: string;
  description: string;
  params: z.ZodSchema<P>;
  returns: z.ZodSchema<R>;
  handler: ContentScriptHandler;  // from content-script/handlers
  handlerKey?: string;              // default: strip page_/tab_ prefix
  fields?: string[];
  aliases?: ...;
  errorCode: string;
  errorCategory?: string;
  example: string;
  paramTypes?: ToolDocParam[];     // optional override
  returnDoc?: string;
  returnType?: string;
  agentMeta?: ToolAgentMeta;
}): void
```

Implementation must:

1. Call `registerContentScriptJsCall` (or internal shared register) with full spec
2. Call `registerContentScriptSpec({ registryAction, handlerKey, params, returns })`
3. Register action in CS actions set — **replace hardcoded `CONTENT_SCRIPT_ACTIONS`**

#### 3.2 Derive CS action set from registry

**Edit:** `content-script-actions.ts`

- Replace static `CONTENT_SCRIPT_ACTIONS` Set with `getContentScriptActions(): Set<string>` populated at register time
- `isContentScriptAction()` reads from that set
- `freezeJsRegistry()` validation unchanged in spirit

#### 3.3 Migrate page/tab CS tools first

**Edit:** `page.ts`, `tab.ts` — convert `registerContentScriptJsCall` blocks for mutations to `defineContentScriptTool`, passing handler refs.

**Challenge:** `handlers` lives in content-script bundle; tool registration runs in main-thread runner. Options:

- **A (recommended):** `defineContentScriptTool` only registers schema + manifest; handler binding stays in `content-script/schemas.ts` loop but reads from a **shared spec array** exported from `shared/registry/content-script-tools.ts`
- **B:** Split spec table in shared file; both runner and content-script import it; handlers mapped by key in CS bundle only

**New file:** `crates/extension-js/js/src/shared/registry/content-script-tools.ts`

- Export `CONTENT_SCRIPT_TOOL_SPECS` array (action, params, returns, handlerKey, docs meta)
- `page.ts` / `tab.ts` iterate and call `defineContentScriptTool` OR import a `registerAllContentScriptTools()` called from runner index
- `content-script/index.ts` imports same specs + attaches `handlers[handlerKey]`

#### 3.4 Delete duplicate schemas

**Delete or gut:** `crates/extension-js/js/src/content-script/schemas.ts` — `ACTION_SCHEMAS` table removed; `buildContentScriptSpecs()` builds from shared spec list.

#### 3.4 Tests

- `freezeJsRegistry()` still passes
- `buildContentScriptSpecs()` count matches manifest CS entries
- `browsergent-parity.test.ts` still passes
- No action in `CONTENT_SCRIPT_ACTIONS` without schema + handler

---

### Phase 4 — Return type names for agents

**Goal:** Returns show `{ ok: true, action, refId?, value? }` not `"null"`.

#### 4.1 Named Zod schemas

**New or edit:** `crates/extension-js/js/src/shared/schemas.ts`

```typescript
export const PageActionResultSchema = z.object({
  ok: z.literal(true),
  action: z.string(),
  refId: z.string().optional(),
  tag: z.string().optional(),
  role: z.string().optional(),
  value: z.string().optional(),
  checked: z.boolean().optional(),
  key: z.string().optional(),
  // extend as main track lands
});
```

Coordinate with main worktree — if they land first, import their schema.

#### 4.2 Update mutation registrations

Change `returns: z.null()` → `returns: PageActionResultSchema` in specs + `returnDoc` text.

#### 4.3 Tests

- `getSerializableJsManifest()` entry for `page_fill` has `returnsDoc.type` containing `ok` and `action`

---

### Phase 5 — Optional cleanup (if time)

- Deprecate `registerContentScriptJsCall` — thin wrapper calling `defineContentScriptTool`
- Add `listTools()` parity for content-script entries (today `listTools()` is main-thread only; agents use full manifest via apiDocs — document this)
- Export stable JSON schema for apiDocs consumers (Browsergent `get_doc`)

---

## Out of Scope (this workstream)

These belong to the **main worktree** (`problems.md` runtime track):

- `normalizeAgentError`, fail-fast content script, removing `sendMessageToTab` auto-inject
- `page.health()` implementation
- `page.url` / `page.title` main-thread move
- `buildSnapshotInTab` form fields
- Rust `AsyncError` hint/recovery/details (unless Phase 2 markdown needs empty placeholders)
- Browsergent host `get_doc` integration (consumer repo)

**Interface boundary:** This workstream owns **manifest shape + doc generation + CS spec consolidation**. Main track owns **runtime behavior**; they meet at Zod schemas and manifest metadata.

---

## Acceptance Criteria

### Must pass

- [ ] `npm test` in `crates/extension-js/js` — all existing tests green
- [ ] `manifest-docs.test.ts`: no manifest entry has `returnsDoc.type === "undefined"`
- [ ] APIs with `ZodObject` params and empty `paramTypes` get derived non-empty `paramsDoc` (except truly no-arg `{}` schemas)
- [ ] `page.fill` markdown/json docs show parameter names and types agents can use
- [ ] `page.fill` docs include **Prerequisites** or **Notes** mentioning content-script / health check
- [ ] `content-script/schemas.ts` has no duplicate `ACTION_SCHEMAS` mirror (Phase 3)
- [ ] `freezeJsRegistry()` passes with zero orphans

### Spot-check (manual or E2E)

```javascript
// In extension sidepanel session after init:
const docs = await session.apiDocs("markdown");
// Must contain page.fill params, not empty Parameters section
// Must NOT list returns as `undefined`
```

### Regression guards

- `manifestEntryToWasm` still matches `JsManifestEntry` Rust struct (add fields with serde defaults)
- WASM `register_js_call_batch` still succeeds at worker init
- Content-script `dispatchValidated` still validates fill/click on live extension

---

## Suggested Implementation Order

1. **Phase 1** — `zod-to-docs.ts` + wire manifest (1–2 days)
2. **Phase 2** — agent meta + Rust markdown (1 day)
3. **Phase 3** — CS spec consolidation (2–3 days, highest risk — test heavily)
4. **Phase 4** — return schemas (coordinate with main track, 0.5 day)

Use **strangler pattern**: Phase 1 ships independently and immediately improves all APIs.

---

## Files Touched (checklist)

| Action | Path |
|--------|------|
| **New** | `crates/extension-js/js/src/shared/registry/zod-to-docs.ts` |
| **New** | `crates/extension-js/js/src/shared/registry/define-content-script-tool.ts` |
| **New** | `crates/extension-js/js/src/shared/registry/content-script-tools.ts` (or equivalent) |
| **Edit** | `crates/extension-js/js/src/shared/tool-registry.ts` |
| **Edit** | `crates/extension-js/js/src/shared/registry/manifest.ts` |
| **Edit** | `crates/extension-js/js/src/shared/registry/dispatch.ts` (extract shared describe) |
| **Edit** | `crates/extension-js/js/src/shared/registry/content-script-actions.ts` |
| **Edit** | `crates/extension-js/js/src/content-script/schemas.ts` |
| **Edit** | `crates/extension-js/js/src/content-script/index.ts` |
| **Edit** | `crates/extension-js/js/src/main/runner/tools/page.ts` |
| **Edit** | `crates/extension-js/js/src/main/runner/tools/tab.ts` |
| **Edit** | `crates/extension-js/js/src/main/runner/tools/page-snapshot.ts` |
| **Edit** | `crates/web-js-core/src/api_docs.rs` |
| **Edit** | `crates/extension-js/js/test/manifest-docs.test.ts` |
| **Edit** | `crates/extension-js/js/test/browsergent-parity.test.ts` (if needed) |

---

## Reference: Design decisions (from planning session)

These are **already decided** for the product; docs should reflect them as they land:

| Topic | Decision |
|-------|----------|
| Cold tab | Fail-fast + structured `E_CONTENT_SCRIPT`; no auto-inject |
| `page.wake()` | **Not implemented**; recovery text points to goto/refresh |
| Mutation success | `PageActionResult` with echo + post-state DOM values |
| `page.health()` | `{ mutationsReady, contentScript, scripting, hint?, recovery? }` |
| Stale refId errors | `E_STALE` + recovery text; **no** misleading `availableNodes` list |
| `page.active_tab()` | Same single-object shape as `web.tab.current()` |

---

## Questions for main track (async coordination)

If blocked, leave TODO comments and open a note in PR:

1. Final `PageActionResultSchema` field list
2. Exact `page.health` return shape when implemented
3. Whether `SnapshotNodeSchema` lives in `shared/schemas.ts`

---

*End of handoff spec.*
