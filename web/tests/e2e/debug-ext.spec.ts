import path from "node:path";
import { chromium, test } from "@playwright/test";

interface ChromeTab {
  id: number;
  url?: string;
}

interface ChromeApi {
  tabs: { query: (params: Record<string, unknown>) => Promise<ChromeTab[]> };
  scripting: {
    executeScript: (
      details: Record<string, unknown>,
    ) => Promise<{ result?: unknown }[]>;
  };
}

declare global {
  interface Window {
    chrome?: ChromeApi;
  }
}

test("debug tab.fetch directly", async () => {
  const extensionPath = path.resolve("dist");
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker");
  }
  const extensionId = serviceWorker.url().split("/")[2];

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/index.html`);
  await popup.waitForTimeout(2000);

  const testPage = await context.newPage();
  await testPage.goto("https://example.com");
  await testPage.waitForTimeout(2000);

  const tabsInfo = await popup.evaluate(async () => {
    const chrome = window.chrome;
    if (!chrome) return [];
    const tabs = await chrome.tabs.query({});
    return tabs.map((t) => ({ id: t.id, url: t.url }));
  });
  const targetTab = tabsInfo.find((t) => t.url?.includes("example.com"));

  // Direct fetch via executeScript
  const result = await popup.evaluate(
    async ({ tabId }) => {
      const chrome = window.chrome;
      if (!chrome) return { ok: false, error: "No chrome" };
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: async (fetchUrl: string) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            try {
              const resp = await fetch(fetchUrl, { signal: controller.signal });
              clearTimeout(timeoutId);
              const text = await resp.text();
              return {
                status: resp.status,
                ok: resp.ok,
                body_len: text.length,
                body_start: text.slice(0, 50),
              };
            } catch (e: unknown) {
              clearTimeout(timeoutId);
              const msg = e instanceof Error ? e.message : String(e);
              return { error: msg || String(e) };
            }
          },
          args: ["https://example.com"],
        });
        return { ok: true, results };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg || String(err) };
      }
    },
    { tabId: targetTab?.id },
  );
  console.log("Direct fetch result:", JSON.stringify(result, null, 2));

  await context.close();
});
