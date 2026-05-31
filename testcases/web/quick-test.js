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

  const t1 = await runCode('1+1');
  console.log('1+1:', JSON.stringify(t1));

  await page.waitForTimeout(500);
  const t2 = await runCode('print("hello")');
  console.log('print("hello"):', JSON.stringify(t2));

  await page.waitForTimeout(500);
  const t3 = await runCode('var x = 5; x * 2');
  console.log('var x = 5; x * 2:', JSON.stringify(t3));

  await page.waitForTimeout(500);
  const t4 = await runCode('function f() { return 42; } f()');
  console.log('function f():', JSON.stringify(t4));

  await page.waitForTimeout(500);
  const t5 = await runCode('throw new Error("boom")');
  console.log('throw Error:', JSON.stringify(t5));

  await browser.close();
})();
