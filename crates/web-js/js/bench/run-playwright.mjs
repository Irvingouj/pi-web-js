#!/usr/bin/env node
// Drives the QuickJS bench headlessly via Playwright (Chromium) and prints the
// report + saves a screenshot. Decoupled from web/playwright.config.ts (that one
// spawns the web dev server on :5173, which we don't want here).
//
// Assumes the bench server is already running:
//   node crates/web-js/js/bench/serve.mjs
//
//   node crates/web-js/js/bench/run-playwright.mjs
//   BENCH_URL=http://127.0.0.1:9393/bench/bench.html HEADED=1 node ...run-playwright.mjs

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Playwright lives in web/node_modules.
const webModules = path.resolve(__dirname, "../../../../web/node_modules");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(webModules, "playwright"));

const URL_ = process.env.BENCH_URL ?? "http://127.0.0.1:9393/bench/bench.html";
const HEADED = process.env.HEADED === "1";
const SHOT = path.resolve(__dirname, "result.png");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch({
    headless: !HEADED,
    args: ["--js-flags=--expose-gc"], // expose window.gc for tighter heap numbers
  });
  const page = await browser.newPage();
  page.on("console", (m) => {
    const t = m.text();
    if (t.startsWith("bench:")) console.log(`[page] ${t}`);
  });
  page.on("pageerror", (e) => console.error("[pageerror]", e));

  console.log(`→ ${URL_}`);
  await page.goto(URL_, { waitUntil: "domcontentloaded" });

  console.log("→ clicking #run (cold bootstrap + bench; this takes ~30-60s)");
  await page.click("#run");

  // Wait until the report finishes (Verdict line) or an error shows.
  await page.waitForFunction(
    () => {
      const t = document.getElementById("out").textContent;
      return /Verdict|error:/i.test(t);
    },
    { timeout: 300_000 },
  );

  const text = (await page.textContent("#out")) ?? "";
  console.log("\n════════════════════ bench output ════════════════════\n");
  console.log(text.trim());
  console.log("\n══════════════════════════════════════════════════════\n");

  await page.screenshot({ path: SHOT, fullPage: true });
  console.log(`screenshot → ${SHOT}`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
