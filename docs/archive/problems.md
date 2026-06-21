# extension-js: Required Product Behavior

**Status:** Unresolved product requirements
**Owner:** extension-js
**Priority:** Blocking for browser agents
**Evidence:** Browsergent capability sessions using extension-js `^0.4.1` and `^0.5.0`

## Objective

Fix extension-js so an agent can reliably observe a page, identify a specific element or media object, act on it, fetch its data, save it, and verify the result without guessing undocumented behavior.

The agent must not need application-specific DOM execution, raw Chrome APIs, repeated signature experiments, or speculative recovery loops to complete ordinary browser tasks.

This document specifies required behavior only. Implementation choices belong to the extension-js agent.

## P0: Complete Element Observation

An agent querying page elements must receive enough structured information to understand and use the results.

For every element returned by `page.find()` or the equivalent structured observation API, provide:

- A usable `refId` when the element can be targeted.
- Element tag and semantic role.
- Accessible name, visible text, and relevant form state.
- Relevant DOM attributes, including `src`, `href`, `alt`, `title`, `value`, `checked`, `disabled`, and `readOnly` when applicable.
- Absolute URLs for URL-bearing attributes, or an unambiguous documented representation.
- Enough relationship or context information to associate nested media with its containing article, post, link, or other parent object.

Returning objects such as `{ tag: "IMG", refId: null, text: "" }` is not sufficient.

CSS queries for links and images must not report matching elements while omitting the requested element's `href` or `src`.

## P0: Reliable Snapshots on Real Applications

`page.snapshot()`, `page.snapshot_text()`, and `page.snapshot_data()` must work reliably on large, dynamic applications such as X.

Required behavior:

- A snapshot must not fail merely because the page is large or changes while being observed.
- `max_nodes` must actually bound the work and allow a smaller snapshot to succeed.
- Snapshot failures must identify the concrete cause.
- A structured observation fallback must remain available if one snapshot representation cannot be produced.
- Recovery guidance must never direct the agent back to an API that cannot succeed under the current condition.
- Snapshot nodes must contain the state needed to verify prior mutations.

Repeated `E_SNAPSHOT: Failed to get page snapshot` at 500, 200, 100, and 50 nodes is unacceptable.

## P0: Stable Element Targeting

Elements discovered through supported observation APIs must be actionable through supported mutation APIs.

Required behavior:

- Visible interactive elements must receive usable references.
- Label targeting must use the same semantic information exposed during observation.
- When targeting fails, the error must distinguish stale reference, no matching label, non-interactable element, and unsupported target.
- Failure details must include useful candidates or enough context to select a valid target.
- Dynamic page changes must produce an explicit stale-reference result, not a generic not-found result.
- `page.*` and `web.tab.*` must behave consistently for equivalent targeting operations.

An agent must not be able to find a post or media container but then be unable to click it because all returned references are null.

## P0: Binary-Safe Fetching and File Saving

extension-js must provide a documented, end-to-end path for downloading and saving binary resources such as images, PDFs, audio, and archives.

Required behavior:

- Fetching binary content must preserve every byte.
- The response must clearly identify whether its body is text, bytes, or base64.
- Binary data returned by fetch must be directly accepted by a documented filesystem write operation, or convertible using documented runtime facilities.
- Content type, status, final URL, and byte length must be available.
- A saved file must be verifiable through filesystem metadata and read/hash operations.
- The flow must work for cross-origin media URLs accessible from the active page.
- Unsupported binary operations must fail before data corruption occurs and explain the limitation precisely.

Returning JPEG bytes through `response.text()` as corrupted replacement characters is unacceptable.

## P0: Filesystem Calls Must Match Their Documentation

Every documented filesystem signature must work exactly as documented.

Required behavior:

- `fs.write`, `fs.writeBase64`, and aliases must accept their documented parameter shapes.
- Parameters must arrive at the filesystem dispatcher unchanged and non-null.
- Invalid data must produce a precise validation error naming the field and expected representation.
- Successful writes must return explicit confirmation containing the destination and written byte count.
- Relative-path behavior and the filesystem root must be documented.
- Equivalent camelCase and snake_case aliases, if both are exposed, must have equivalent semantics.

A documented call such as `fs.writeBase64({ path, data })` must not reach the dispatcher as null.

## P0: Cold-Tab Read and Write Consistency

On a normal HTTP(S) tab that was open before extension-js loaded, the API must clearly and consistently represent what is ready.

Required behavior:

- Read success must not misleadingly imply mutation readiness.
- Mutation attempts must either become ready automatically or fail with a specific readiness error.
- The error must explain why reads can work while writes cannot.
- Recovery must be concrete and known to work.
- `page.health()` or equivalent capability state must accurately report observation and mutation readiness before the agent acts.
- `page.url()` and `page.title()` must work whenever active-tab metadata is available.

Raw Chrome connection errors must never reach the agent.

## P1: Explicit Success Results

All state-changing operations must return explicit, typed confirmation rather than `null` or ambiguous values.

The result must identify:

- The operation performed.
- The target used.
- The relevant resulting state.
- Whether extension-js observed the intended effect.

A successful dispatch that produced no page effect must not be reported as successful task completion.

## P1: Actionable Errors

Every failure exposed to agent code must contain:

- A stable machine-readable code.
- A specific human-readable message.
- The failed API and operation.
- Useful structured details such as URL, tab ID, selector, label, reference, status, or candidate targets.
- A short explanation when the behavior is non-obvious.
- Recovery steps that are valid for the actual failure.

Generic `TypeError`, `ReferenceError`, `E_UNKNOWN`, `E_EXTENSION`, and `Failed to get page snapshot` messages without the original message, location, and cause are unacceptable.

Runtime errors must preserve:

- Error name.
- Error message.
- Failing line or expression when available.
- Stack or equivalent source location when available.

## P1: Runtime Capability Clarity

The JavaScript runtime must expose a coherent, documented set of language and binary primitives.

Required behavior:

- Documentation must state whether standard APIs such as `Uint8Array`, `ArrayBuffer`, `TextEncoder`, `TextDecoder`, `atob`, and `btoa` are available.
- APIs shown in examples must exist in the runtime.
- Missing runtime capabilities must produce named errors rather than bare `ReferenceError` output.
- Ordinary binary workflows must not depend on guessing which JavaScript globals survived sandboxing.

## P1: Accurate Generated Documentation

`get_doc` is the runtime contract for agents and must be trustworthy.

Required behavior:

- Every parameter must have its real type, required status, accepted shapes, and defaults.
- Every return value must have its real structure and field types.
- Examples must use a valid signature and be executable in the documented runtime.
- Documentation must identify whether an API returns text or binary data.
- Documentation must identify prerequisites, permissions, context restrictions, and side effects.
- Aliases must be documented consistently.
- `page.*` versus `web.tab.*` ownership and behavior must be unambiguous.
- Recovery examples must not recommend APIs known to share the same failing dependency.

Parameters and return values described as `undefined` are unacceptable when concrete schemas exist.

## P1: API Signature Consistency

Supported calling conventions must be consistent and deterministic.

Required behavior:

- Object and positional forms must not be accepted inconsistently across closely related APIs.
- If only one form is supported, documentation and validation must require it consistently.
- Invalid calls must explain the accepted form.
- Equivalent `page.*` and `web.tab.*` operations must use predictable parameter naming and return shapes.
- Active-tab APIs must use a consistent tab identity shape.

The agent must not need to probe multiple argument permutations to discover the actual signature.

## P1: Dynamic-Page Continuity

extension-js must make it possible to preserve the identity of objects on feeds and other virtualized applications.

Required behavior:

- Structured results must expose stable URLs or identifiers when the page provides them.
- Media must be associable with the post or article that contains it.
- After scrolling or rerendering, the agent must be able to determine whether it is still acting on the same object.
- Stale ephemeral references must be clearly distinguished from stable page-provided identifiers.

## P2: Trace and Lifecycle Correctness

Every execution must reach a final state.

Required behavior:

- A completed, failed, stopped, or timed-out cell must not remain marked `running`.
- Tool events must have deterministic chronological ordering.
- Errors and completion states must retain the call ID needed to correlate them.
- Timeouts and cancellation must produce explicit final results.

## Required Acceptance Scenarios

The extension-js agent must add automated extension-context tests proving all scenarios below.

### 1. Dynamic Feed Observation

On a realistic dynamic feed fixture:

1. Find at least ten article elements.
2. Identify images belonging to each article.
3. Read each image's absolute source URL and alternative text.
4. Read each article's stable permalink.
5. Associate every returned image with the correct article.
6. Target a selected article or image using a supported reference.

### 2. X-Sized Snapshot

On a large, mutating DOM fixture:

1. `page.snapshot()` succeeds.
2. `page.snapshot_data({ max_nodes: 50 })` succeeds and returns no more than the documented bound.
3. Increasing the bound returns additional useful nodes.
4. A concurrent rerender does not produce an unexplained generic failure.

### 3. Download and Save an Image

From a page containing a cross-origin JPEG:

1. Discover the image URL through a supported observation API.
2. Fetch the image without byte corruption.
3. Save it through the documented filesystem API.
4. Confirm the file exists.
5. Confirm its size matches the fetched byte length.
6. Confirm its hash matches the original bytes.
7. Return explicit success results at every step.

### 4. Cold Existing Tab

On an HTTP(S) tab opened before the extension loads:

1. Observation capability is reported accurately.
2. Mutation capability is reported accurately.
3. A mutation either succeeds or returns a specific readiness error with working recovery.
4. No raw Chrome connection string is exposed.
5. After recovery, fill and click succeed with explicit confirmation.

### 5. Stale Dynamic Reference

1. Capture a reference to an interactive element.
2. Replace that element through a rerender.
3. Attempt to use the old reference.
4. Receive a specific stale-reference error with useful details.
5. Refresh observation and successfully target the replacement.

### 6. Documentation Contract

For every public `page`, `web.tab`, and `fs` API used above:

1. Generate documentation.
2. Execute the documented example unchanged.
3. Validate its parameters and result against the documented schema.
4. Confirm no parameter or return type is incorrectly reported as `undefined`.

## Completion Standard

This work is complete only when the automated extension-context tests pass in a fresh build and a browser agent can complete the image-download scenario without undocumented APIs, signature guessing, raw DOM execution, corrupted data, or speculative retries.
