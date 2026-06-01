import { test } from "@playwright/test";
import {
  expectCellOutputContains,
  launchExtensionContext,
  runCell,
  setCellCode,
  waitForCellStatus,
  waitForKernelReady,
} from "../extension-helpers";

test.describe("crypto APIs", () => {
  test("crypto.sha256, md5, hmac_sha256, hex_encode, hex_decode work", async () => {
    const { context, popup } = await launchExtensionContext();
    try {
      await waitForKernelReady(popup, 30_000);
      await popup
        .locator(".cm-content")
        .first()
        .waitFor({ state: "visible", timeout: 10_000 });
      await popup.waitForTimeout(500);

      await setCellCode(
        popup,
        0,
        `const message = 'Hello, Extension World!';
console.log('SHA-256:', crypto.sha256(message));
console.log('MD5:', crypto.md5(message));
console.log('HMAC:', crypto.hmac_sha256('my-secret-key', message));
const hex = crypto.hex_encode(message);
console.log('Hex encoded:', hex);
console.log('Decoded:', crypto.hex_decode(hex));
const url = await page.url();
console.log('Hash of current URL:');
console.log('  SHA-256:', crypto.sha256(url));
console.log('  MD5:', crypto.md5(url));`,
      );
      await runCell(popup, 0);
      await waitForCellStatus(popup, 0, "success", 20_000);
      await expectCellOutputContains(popup, 0, "SHA-256:");
      await expectCellOutputContains(popup, 0, "MD5:");
      await expectCellOutputContains(popup, 0, "HMAC:");
      await expectCellOutputContains(popup, 0, "Hex encoded:");
      await expectCellOutputContains(popup, 0, "Decoded: Hello, Extension World!");
      await expectCellOutputContains(popup, 0, "Hash of current URL:");
    } finally {
      await context.close();
    }
  });
});
