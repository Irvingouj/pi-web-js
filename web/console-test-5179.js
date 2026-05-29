import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const logs = [];
  page.on('console', msg => {
    const text = msg.text();
    logs.push(`[${msg.type()}] ${text}`);
    console.log(`[${msg.type()}] ${text}`);
  });
  page.on('pageerror', err => {
    logs.push(`[pageerror] ${err.message}`);
    console.log(`[pageerror] ${err.message}`);
  });

  await page.goto('http://localhost:5179/');
  await page.waitForSelector('[data-testid="kernel-status"]:has-text("ready")', { timeout: 30000 });

  // Test 1: 1+1
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('1+1');

  await page.locator('[data-testid="cell-run-button"]').first().click();

  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="cell-status"]');
    const text = el?.textContent || '';
    return text.includes('done') || text.includes('err') || text.includes('error');
  }, { timeout: 15000 });

  const status1 = await page.locator('[data-testid="cell-status"]').first().textContent();
  const output1 = await page.locator('[data-testid="cell-output"]').first().textContent();
  const error1 = await page.locator('[data-testid="cell-error"]').first().textContent().catch(() => '');
  console.log('Test 1 status:', status1);
  console.log('Test 1 output:', output1);
  console.log('Test 1 error:', error1);

  // Test 2: print("hello")
  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('print("hello")');
  await page.locator('[data-testid="cell-run-button"]').first().click();

  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="cell-status"]');
    const text = el?.textContent || '';
    return text.includes('done') || text.includes('err') || text.includes('error');
  }, { timeout: 15000 });

  const status2 = await page.locator('[data-testid="cell-status"]').first().textContent();
  const output2 = await page.locator('[data-testid="cell-output"]').first().textContent();
  const error2 = await page.locator('[data-testid="cell-error"]').first().textContent().catch(() => '');
  console.log('Test 2 status:', status2);
  console.log('Test 2 output:', output2);
  console.log('Test 2 error:', error2);

  await browser.close();
})();
