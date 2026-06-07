# Chrome API E2E tests

One Playwright file per `chrome.*` namespace. Each file runs **one test per API** (120 total).

Each test runs the contract batch for a single API (builds fixture, calls API, tears down). Typical cell time is **0.6–2s**; namespace suites use a **15s per-test timeout** because fixture setup is included in each cell.

Tests in a namespace file are `describe.serial` — the first failure skips the rest of that file so you can fix one namespace at a time.

## Run one namespace (recommended while developing)

```bash
cd web
npx playwright test --config playwright.extension.config.ts tests/e2e/extension/chrome/bookmarks.spec.ts --reporter=line
```

No rebuild needed if `web/dist/` is already fresh. After runner or contract changes:

```bash
npm run build
```

## Run all chrome APIs

```bash
cd web
npx playwright test --config playwright.extension.config.ts tests/e2e/extension/chrome --reporter=line
```

## Logging and diagnostics

- Browser console from sidepanel, service worker, and fixture tab is captured in `harness.runtimeLogs` (default on).
- Optional extension-js internal logging via `EXT_E2E_LOG_LEVEL=info|debug` (default `error` / off — `debug` can overflow the stack on contract cells).
- On failure, tests attach: stdout, stderr, sentinel JSON, last 200 runtime log lines, SW/browser errors.
- Playwright annotations on every run: `api`, `expectation`, `destructive`, `cell_elapsed_ms`.

Environment variables:

| Variable | Default | Effect |
|----------|---------|--------|
| `EXT_E2E_VERBOSE` | `1` | Capture all console levels into `runtimeLogs` |
| `EXT_E2E_LOG_LEVEL` | `error` | Set `info` or `debug` to enable `?e2e_log=` on sidepanel (use with care) |
| `EXT_E2E_ATTACH_ALWAYS` | `0` | Attach full diagnostic bundle even on success |

## File layout

| File | Namespace | APIs |
|------|-----------|-----:|
| `action.spec.ts` | `chrome.action` | 7 |
| `alarms.spec.ts` | `chrome.alarms` | 4 |
| `bookmarks.spec.ts` | `chrome.bookmarks` | 9 |
| `browsing-data.spec.ts` | `chrome.browsingData` | 7 |
| `context-menus.spec.ts` | `chrome.contextMenus` | 4 |
| `cookies.spec.ts` | `chrome.cookies` | 4 |
| `declarative-net-request.spec.ts` | `chrome.declarativeNetRequest` | 6 |
| `desktop-capture.spec.ts` | `chrome.desktopCapture` | 2 |
| `downloads.spec.ts` | `chrome.downloads` | 7 |
| `history.spec.ts` | `chrome.history` | 6 |
| `identity.spec.ts` | `chrome.identity` | 3 |
| `idle.spec.ts` | `chrome.idle` | 1 |
| `management.spec.ts` | `chrome.management` | 4 |
| `notifications.spec.ts` | `chrome.notifications` | 4 |
| `offscreen.spec.ts` | `chrome.offscreen` | 2 |
| `page-capture.spec.ts` | `chrome.pageCapture` | 1 |
| `permissions.spec.ts` | `chrome.permissions` | 4 |
| `runtime.spec.ts` | `chrome.runtime` | 5 |
| `scripting.spec.ts` | `chrome.scripting` | 3 |
| `sessions.spec.ts` | `chrome.sessions` | 3 |
| `side-panel.spec.ts` | `chrome.sidePanel` | 2 |
| `storage.spec.ts` | `chrome.storage` | 8 |
| `system.spec.ts` | `chrome.system` | 3 |
| `tab-groups.spec.ts` | `chrome.tabGroups` | 4 |
| `tabs.spec.ts` | `chrome.tabs` | 8 |
| `top-sites.spec.ts` | `chrome.topSites` | 1 |
| `tts.spec.ts` | `chrome.tts` | 3 |
| `windows.spec.ts` | `chrome.windows` | 5 |

Shared helpers live in [`../lib/`](../lib/): `chrome-apis.ts`, `chrome-fixture.ts`, `chrome-test.ts`, `define-chrome-namespace.ts`.
