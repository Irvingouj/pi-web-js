import { RESULT_PREFIX } from "./constants.ts";

export function buildStrictRunnerSource(
	apiNames: string[],
	runDestructive: boolean,
	extensionId: string,
): string {
	return `
var RESULT_PREFIX = "${RESULT_PREFIX}";
if (typeof globalThis.runContractBatch !== "function") {
	var runnerUrl = "chrome-extension://${extensionId}/e2e/contract-batch-runner.js";
	var runnerRes = await web.fetch(runnerUrl);
	eval(runnerRes.body);
}
var contractUrl = "chrome-extension://${extensionId}/e2e/all-apis-extension-contract.js";
var contractRes = await web.fetch(contractUrl);
await runContractBatch(contractRes.body, ${JSON.stringify(apiNames)}, ${runDestructive}, RESULT_PREFIX);
`;
}
