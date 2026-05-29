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

  const t1 = await runCode('function F() {} typeof F.prototype');
  console.log('F.prototype typeof:', JSON.stringify(t1));

  const t2 = await runCode('function F() {} F.prototype');
  console.log('F.prototype object:', JSON.stringify(t2));

  const t3 = await runCode('function F() {} F.prototype.foo = 1; F.prototype.foo');
  console.log('F.prototype.foo:', JSON.stringify(t3));

  const t4 = await runCode('function F() {} new F()');
  console.log('new F():', JSON.stringify(t4));

  await browser.close();
})();
