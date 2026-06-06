import { test } from "@playwright/test";
import {
	expectCellOutputContains as expectExtensionCellOutputContains,
	launchExtensionContext,
	runCell as runExtensionCell,
	setCellCode as setExtensionCellCode,
	waitForCellStatus as waitForExtensionCellStatus,
	waitForKernelReady as waitForExtensionKernelReady,
} from "../extension-helpers";

test.describe("registry contract APIs", () => {
	test.describe("extension context contract tests", () => {
		test("web.url.parse succeeds in extension context", async () => {
			const { context, popup } = await launchExtensionContext();
			try {
				await waitForExtensionKernelReady(popup, 60_000);
				await popup
					.locator(".cm-content")
					.first()
					.waitFor({ state: "visible", timeout: 10_000 });
				await popup.waitForTimeout(500);

				await setExtensionCellCode(
					popup,
					0,
					`const result = web.url.parse("https://example.com:8080/path?q=1#section");
print("protocol: " + result.protocol);
print("host: " + result.host);
print("pathname: " + result.pathname);`,
				);
				await runExtensionCell(popup, 0);
				await waitForExtensionCellStatus(popup, 0, "success", 60_000);
				await expectExtensionCellOutputContains(popup, 0, "protocol: https:");
				await expectExtensionCellOutputContains(popup, 0, "host: example.com:8080");
				await expectExtensionCellOutputContains(popup, 0, "pathname: /path");
			} finally {
				await context.close();
			}
		});

		test("crypto.sha256 succeeds in extension context", async () => {
			const { context, popup } = await launchExtensionContext();
			try {
				await waitForExtensionKernelReady(popup, 60_000);
				await popup
					.locator(".cm-content")
					.first()
					.waitFor({ state: "visible", timeout: 10_000 });
				await popup.waitForTimeout(500);

				await setExtensionCellCode(
					popup,
					0,
					`const hash = crypto.sha256("hello world");
print("hash: " + hash);
print("length: " + hash.length);`,
				);
				await runExtensionCell(popup, 0);
				await waitForExtensionCellStatus(popup, 0, "success", 60_000);
				await expectExtensionCellOutputContains(popup, 0, "length: 64");
			} finally {
				await context.close();
			}
		});

		test("fs.read_text alias succeeds in extension context", async () => {
			const { context, popup } = await launchExtensionContext();
			try {
				await waitForExtensionKernelReady(popup, 60_000);
				await popup
					.locator(".cm-content")
					.first()
					.waitFor({ state: "visible", timeout: 10_000 });
				await popup.waitForTimeout(500);

				await setExtensionCellCode(
					popup,
					0,
					`await fs.writeText("/alias_test.txt", "alias works");
const txt = await fs.read_text("/alias_test.txt");
print("alias_txt: " + txt);`,
				);
				await runExtensionCell(popup, 0);
				await waitForExtensionCellStatus(popup, 0, "success", 60_000);
				await expectExtensionCellOutputContains(popup, 0, "alias_txt: alias works");
			} finally {
				await context.close();
			}
		});

	});
});
