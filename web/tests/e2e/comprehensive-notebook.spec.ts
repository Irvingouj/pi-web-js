import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import {
  setCellCode,
  runCell,
  waitForKernelReady,
} from "../helpers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const notebookPath = resolve(__dirname, "../../../comprehensive-test-notebook.json");

const notebook: { cells: Array<{ id: string; kind: string; source: string }> } = JSON.parse(
  readFileSync(notebookPath, "utf-8"),
);

const codeCells = notebook.cells.filter((c) => c.kind === "code");

test("Comprehensive API Test Notebook - all cells", async ({ page }) => {
  test.setTimeout(300_000);

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.goto("/");
  await waitForKernelReady(page);

  // Mock Chrome APIs after page load
  await page.addInitScript(() => {
    const storageData = new Map<string, unknown>();
    let nextTabId = 1;

    class MockResponse {
      _body: string;
      status: number;
      ok: boolean;
      _headers: Record<string, string>;
      constructor(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
        this._body = body;
        this.status = init.status ?? 200;
        this.ok = this.status >= 200 && this.status < 300;
        this._headers = init.headers ?? {};
      }
      async text() { return this._body; }
      async json() { return JSON.parse(this._body); }
      get headers() {
        return {
          get: (name: string) => this._headers[name.toLowerCase()] ?? null,
          entries: () => Object.entries(this._headers),
        };
      }
    }

    (window as any).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("httpbin.org/get")) {
        return new MockResponse(JSON.stringify({ origin: "127.0.0.1", headers: { "User-Agent": "test" }, args: {} }), { status: 200 });
      }
      if (url.includes("httpbin.org/post")) {
        return new MockResponse(JSON.stringify({ json: { hello: "test" } }), { status: 200 });
      }
      return new MockResponse("{}", { status: 200 });
    };

    (window as any).chrome = {
      runtime: { id: "test-extension-id", sendMessage: async () => ({ pong: true }) },
      tabs: {
        query: async () => [{ id: nextTabId++, title: "Test Tab", url: "https://example.com", active: true, windowId: 1 }],
        get: async (id: number) => ({ id, title: "Test Tab", url: "https://example.com" }),
        create: async () => ({ id: nextTabId++ }),
        update: async () => ({ id: 1 }),
        reload: async () => {},
        remove: async () => {},
        sendMessage: async () => ({ result: "mock" }),
      },
      storage: {
        local: {
          set: async (items: unknown) => {
            if (items && typeof items === "object") {
              Object.entries(items as Record<string, unknown>).forEach(([k, v]) => storageData.set(k, v));
            }
          },
          get: async (keys: unknown) => {
            if (keys === null) return Object.fromEntries(storageData);
            const keyArray = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(keys as Record<string, unknown>);
            const result: Record<string, unknown> = {};
            (keyArray as string[]).forEach((k: string) => { if (storageData.has(k)) result[k] = storageData.get(k); });
            return result;
          },
          remove: async (keys: unknown) => {
            const keyArray = Array.isArray(keys) ? keys : [keys];
            (keyArray as string[]).forEach((k: string) => storageData.delete(k));
          },
          clear: async () => storageData.clear(),
        },
      },
      bookmarks: { search: async () => [], create: async () => ({ id: "bm-1" }), remove: async () => {} },
      history: { search: async () => [], deleteUrl: async () => {} },
      cookies: { getAll: async () => [], get: async () => null, set: async () => {}, remove: async () => {} },
      alarms: { create: async () => {}, get: async () => null, getAll: async () => [], clear: async () => false, clearAll: async () => false, onAlarm: { addListener: () => {}, removeListener: () => {} } },
      action: { setBadgeText: async () => {}, getBadgeText: async () => "", setBadgeBackgroundColor: async () => {}, setIcon: async () => {}, setTitle: async () => {} },
      contextMenus: { create: async () => {}, remove: async () => {} },
      sidePanel: { setOptions: async () => {} },
      scripting: { executeScript: async () => [{ result: "mock" }] },
      notifications: { create: async () => "notif-1", clear: async () => true },
      windows: { getAll: async () => [], create: async () => ({ id: 1 }), remove: async () => {}, update: async () => ({ id: 1 }) },
    };
  });

  const failures: Array<{ id: string; status: string; output: string }> = [];

  for (const cell of codeCells) {
    await setCellCode(page, 0, cell.source);
    await runCell(page, 0);

    // Wait for cell to finish
    await page.waitForFunction(() => {
      const cells = document.querySelectorAll('[data-testid="cell-status"]');
      const cell = cells[0] as HTMLElement;
      const text = cell?.innerText?.toLowerCase() || '';
      return text === 'success' || text === 'error';
    }, { timeout: 30_000 });

    const status = await page.evaluate(() => {
      const cells = document.querySelectorAll('[data-testid="cell-status"]');
      const cell = cells[0] as HTMLElement;
      return cell ? cell.innerText : "no status";
    });

    const output = await page.evaluate(() => {
      const cells = document.querySelectorAll('[data-testid="cell-output"]');
      const cell = cells[0] as HTMLElement;
      return cell ? cell.innerText : "no output";
    });

    if (status.toLowerCase() !== "success") {
      failures.push({ id: cell.id, status, output: output.substring(0, 500) });
      console.log(`\n❌ FAILED: ${cell.id}`);
      console.log("Status:", status);
      console.log("Output:", output.substring(0, 300));
    } else {
      console.log(`✅ PASSED: ${cell.id}`);
    }
  }

  // Report summary
  console.log(`\n=== SUMMARY ===`);
  console.log(`Total: ${codeCells.length}`);
  console.log(`Passed: ${codeCells.length - failures.length}`);
  console.log(`Failed: ${failures.length}`);

  if (failures.length > 0) {
    console.log("\nFailed cells:");
    failures.forEach((f) => console.log(`  - ${f.id}: ${f.status}`));
  }

  expect(failures.length).toBe(0);
});
