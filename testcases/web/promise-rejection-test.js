import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => console.log(`[pageerror] ${err.message}`));
  page.on('requestfailed', req => console.log(`[requestfailed] ${req.url()}`));

  await page.goto('http://localhost:5173/');
  await page.waitForSelector('[data-testid="kernel-status"]:has-text("ready")', { timeout: 30000 });

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('new Object()');
  await page.locator('[data-testid="cell-run-button"]').first().click();

  // Wait for cell status with a longer timeout
  await page.waitForSelector('[data-testid="cell-status"]', { timeout: 30000 });

  const output = await page.locator('[data-testid="cell-output"]').first().textContent();
  const error = await page.locator('[data-testid="cell-error"]').first().textContent().catch(() => '');
  console.log('Result:', JSON.stringify({ output, error }));

  await browser.close();
})();
