import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => console.log(`[pageerror] ${err.message}`));

  const runCode = async (code) => {
    await page.goto('http://localhost:5179/');
    await page.waitForSelector('[data-testid="kernel-status"]:has-text("ready")', { timeout: 30000 });
    const editor = page.locator('.cm-content').first();
    await editor.click();
    await page.keyboard.press('Meta+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(code);
    await page.locator('[data-testid="cell-run-button"]').first().click();
    await page.waitForSelector('[data-testid="cell-status"]', { timeout: 15000 });
    const output = await page.locator('[data-testid="cell-output"]').first().textContent();
    const error = await page.locator('[data-testid="cell-error"]').first().textContent().catch(() => '');
    return { output, error };
  };

  const t1 = await runCode('function F() { return this; } F.call({})');
  console.log('F.call({}):', JSON.stringify(t1));

  const t2 = await runCode('function F() { return 42; } F.call({})');
  console.log('F.call({}) return 42:', JSON.stringify(t2));

  const t3 = await runCode('function F() { return undefined; } F.call({})');
  console.log('F.call({}) return undefined:', JSON.stringify(t3));

  const t4 = await runCode('function F() {} F.call({})');
  console.log('F.call({}) no return:', JSON.stringify(t4));

  await browser.close();
})();
