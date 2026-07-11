# Extension runtime (web-js)

Chrome extension product path: generated JavaScript runs in the extension runner; browser/page effects go through typed extension APIs, not raw Chrome/DOM access (except explicit user code paths).

## Language

### Capability registration

**Capability**:
Something the extension can do for agent code (click a page element, read a snapshot, navigate a tab, …). A capability exists only where its implementation can run (content script for page DOM, main thread for chrome/navigation, sidepanel for sidepanel UI, …).
_Avoid_: ToolSpec catalog, “verb table” as a separate product artifact.

**Register**:
The single call that declares a capability to the runtime: name, description, Zod params/returns, handler, and optional docs metadata. Call **register where the capability lives**. The registry pipeline is responsible for exposing it to QuickJS; the capability author does not own transport, WASM, or session routing.
_Avoid_: separate page-specs / tab-specs tables; main-thread stub handlers for content-script work; hand-maintained parallel action lists.

**Registry pipeline**:
How registered capabilities become callable from QuickJS (manifest, owner routing, content-script `registryCall`, validation, docs). Layers keep their jobs; authors only call **Register**.
_Avoid_: treating the pipeline as something each tool re-implements.

**Declared params vs handler params**:
Optional split on **Register**: **declared params** (what agents and apiDocs see) may differ from **handler params** (what the handler actually receives after earlier pipeline steps). Opt-in; default is one schema for both. Used when the pipeline rewrites inputs (e.g. `set_files` after worker file resolution).
_Avoid_: hidden special-case Sets outside Register; `unknown` to paper over the split.

**Surface**:
How one capability is named for agents: **page** (active tab) and/or **web.tab** (explicit `tabId`). Declared on a single **Register** via an explicit surfaces list; the pipeline generates action ids and adds required `tabId` only for `web.tab`. One handler, one description, one core params schema.
_Avoid_: two independent tools that only happen to share a handler name; separate page-specs and tab-specs tables; optional `tabId` on page.

**Action id**:
Wire/registry string for a callable (e.g. `page_click`, `tab_click`).
_Avoid_: confusing with the agent-facing `page.click` spelling alone.

**Project-owned API**:
`page.*`, `web.tab.*`, `dom.*`, `host.*` and other first-party tools. Named Zod schemas end-to-end at Register; no `unknown` / `z.unknown()` at that boundary.
_Avoid_: chrome-parity opacity leaking into project-owned Register calls.

**NativeArgs**:
Opaque argument arrays only at the Chrome native-parity edge (`chrome.*` / parity aliases → `invokeNative`). Not used for project-owned **Register** params.
_Avoid_: “unknown args” for page/tab capabilities.

**Main-thread capability**:
A capability whose handler must run on the extension main thread (e.g. navigation, health, network, chrome passthrough). Still uses **Register** at that site; not implemented in the content script.
_Avoid_: fake content-script registration for these.
