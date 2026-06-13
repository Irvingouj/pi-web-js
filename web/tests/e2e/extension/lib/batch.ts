import { expect } from "@playwright/test";
import { executeCell } from "./harness.ts";
import { buildStrictRunnerSource } from "./runner-source.ts";
import { parseAllSentinels } from "./sentinels.ts";
import type {
	ApiCase,
	CellExecution,
	ContractResult,
	ExtensionFixture,
	ExtensionHarness,
} from "./types.ts";

export { buildStrictRunnerSource, parseAllSentinels };

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		out.push(items.slice(i, i + size));
	}
	return out;
}

export async function runApiBatch(
	cases: ApiCase[],
	harness: ExtensionHarness,
	fixture: ExtensionFixture,
	runDestructive: boolean,
): Promise<void> {
	const selected = cases.filter((c) =>
		runDestructive ? true : !c.destructive,
	);
	const runnable = selected.filter((c) => !c.skip || runDestructive);
	if (runnable.length === 0) return;

	for (const batch of chunk(runnable, 12)) {
		const names = batch.map((c) => c.api);
		const source = buildStrictRunnerSource(
			names,
			runDestructive,
			harness.extensionId,
		);
		const execution = await executeCell<ContractResult[]>(
			harness.sidepanel,
			source,
		);
		expect(
			execution.status,
			`batch failed: ${execution.stderr}\n${execution.stdout}`,
		).toBe("success");

		const sentinels = parseAllSentinels(execution.stdout);
		expect(
			sentinels.length,
			`expected ${names.length} sentinels for ${names.join(", ")}, got ${sentinels.map((s) => s.api).join(", ")}\n${execution.stdout}`,
		).toBe(names.length);

		for (const apiCase of batch) {
			const entry = sentinels.find((s) => s.api === apiCase.api);
			expect(entry, `missing sentinel for ${apiCase.api}`).toBeTruthy();
			const singleExec: CellExecution<ContractResult> = {
				status: execution.status,
				result: entry ?? null,
				stdout: execution.stdout,
				stderr: execution.stderr,
			};
			await apiCase.assert(singleExec, harness, fixture);
		}
	}
}
