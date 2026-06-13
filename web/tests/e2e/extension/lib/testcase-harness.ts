import { expect, type Page } from "@playwright/test";
import { RESULT_PREFIX } from "./constants.ts";
import { executeCell } from "./harness.ts";
import type { CellExecution } from "./types.ts";

/**
 * Activate a testcase tab by navigating the fixture tab to the given URL
 * and bringing it to the front.
 */
export async function activateTestcaseTab(
	fixtureTab: Page,
	url: string,
): Promise<void> {
	await fixtureTab.goto(url, { waitUntil: "domcontentloaded" });
	await fixtureTab.bringToFront();
}

/**
 * Run a QuickJS cell in the sidepanel that targets the active testcase tab.
 * Automatically prepends the RESULT_PREFIX sentinel boilerplate.
 */
export async function runAgentCell<T>(
	sidepanel: Page,
	source: string,
	timeoutMs = 20_000,
): Promise<CellExecution<T>> {
	const wrapped = `var RESULT_PREFIX = "${RESULT_PREFIX}";\n${source}`;
	return executeCell<T>(sidepanel, wrapped, timeoutMs);
}

/**
 * Assert that a cell execution result contains an agent error with the expected code.
 */
export function assertAgentError(
	result: CellExecution<unknown>,
	code: string,
): void {
	expect(result.status).toBe("error");
	const stderr = result.stderr ?? "";
	const stdout = result.stdout ?? "";
	const combined = stderr + stdout;
	expect(
		combined.includes(code),
		`Expected error code "${code}" in output, but got:\nstderr: ${stderr}\nstdout: ${stdout}`,
	).toBe(true);
}
