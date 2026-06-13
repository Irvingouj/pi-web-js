import { expect, test } from "./fixtures.ts";
import {
	assertRuntimeApiDocsComplete,
	collectRuntimePublicNames,
	filterDocumentedContractApis,
	type RuntimeApiDocEntry,
} from "./lib/api-docs.ts";
import { RESULT_PREFIX } from "./lib/constants.ts";
import { CONTRACT_MANIFEST } from "./lib/contract-metadata.ts";
import {
	assertNoHarnessErrors,
	executeCell,
	restartKernel,
} from "./lib/harness.ts";
import { parseAllSentinels } from "./lib/sentinels.ts";
import type { ContractResult } from "./lib/types.ts";

type ApiDocsPayload = {
	count: number;
	docs: RuntimeApiDocEntry[];
};

async function readRuntimeApiDocs(
	sidepanel: Parameters<typeof executeCell>[0],
): Promise<RuntimeApiDocEntry[]> {
	const exec = await executeCell<ContractResult<ApiDocsPayload>>(
		sidepanel,
		`
var RESULT_PREFIX = "${RESULT_PREFIX}";
if (typeof runtime.apiDocs !== "function") {
  print(RESULT_PREFIX + JSON.stringify({ ok: false, error: { message: "runtime.apiDocs is not defined", code: "E_MISSING_API" } }));
} else {
  const docs = runtime.apiDocs("json");
  print(RESULT_PREFIX + JSON.stringify({ ok: true, value: { count: docs.length, docs } }));
}
`,
		20_000,
	);

	expect(exec.status, `${exec.stderr}\n${exec.stdout}`).toBe("success");
	const parsed = parseAllSentinels(exec.stdout)[0];
	expect(parsed?.ok, exec.stdout).toBe(true);
	if (!parsed?.ok) {
		throw new Error("runtime.apiDocs sentinel missing");
	}
	const payload = parsed.value as ApiDocsPayload;
	expect(Array.isArray(payload.docs)).toBe(true);
	return payload.docs;
}

const DOCUMENTED_CONTRACT_APIS =
	filterDocumentedContractApis(CONTRACT_MANIFEST);

test.describe
	.serial("runtime api docs", () => {
		test.setTimeout(60_000);

		test.afterEach(({ harness }, testInfo) => {
			assertNoHarnessErrors(harness, testInfo);
		});

		test("runtime.apiDocs returns JSON for every manifest-registered contract API", async ({
			harness,
		}) => {
			const docs = await readRuntimeApiDocs(harness.sidepanel);
			assertRuntimeApiDocsComplete(docs, DOCUMENTED_CONTRACT_APIS);
			expect(collectRuntimePublicNames(docs).size).toBeGreaterThanOrEqual(
				DOCUMENTED_CONTRACT_APIS.length,
			);
		});

		test("runtime.apiDocs markdown includes module sections", async ({
			harness,
		}) => {
			const exec = await executeCell<ContractResult<string>>(
				harness.sidepanel,
				`
var RESULT_PREFIX = "${RESULT_PREFIX}";
const md = runtime.apiDocs("markdown");
print(RESULT_PREFIX + JSON.stringify({ ok: true, value: md }));
`,
				20_000,
			);
			expect(exec.status).toBe("success");
			const parsed = parseAllSentinels(exec.stdout)[0];
			expect(parsed?.ok).toBe(true);
			if (!parsed?.ok) return;
			const markdown = parsed.value;
			expect(markdown).toContain("## `page` module");
			expect(markdown).toContain("page.goto");
			expect(markdown).toContain("**Returns**");
		});

		test("runtime.apiDocs includes alias public names", async ({ harness }) => {
			const docs = await readRuntimeApiDocs(harness.sidepanel);
			const names = collectRuntimePublicNames(docs);
			expect(names.has("web.fetch")).toBe(true);
			expect(names.has("web.storage.get")).toBe(true);
			expect(names.has("tab.create")).toBe(true);
			expect(names.has("tab.current")).toBe(true);

			const fetchEntry = docs.find(
				(doc) => doc.public_name === "network.fetch",
			);
			expect(
				fetchEntry?.aliases?.some(
					(a) => a.namespace === "web" && a.name === "fetch",
				),
			).toBe(true);
			const tabCreate = docs.find((doc) => doc.action === "tab_create");
			expect(
				tabCreate?.aliases?.some(
					(a) => a.namespace === "tab" && a.name === "create",
				),
			).toBe(true);
		});

		test("runtime.apiDocs survives kernel restart", async ({ harness }) => {
			await restartKernel(harness.sidepanel);
			const docs = await readRuntimeApiDocs(harness.sidepanel);
			assertRuntimeApiDocsComplete(docs, DOCUMENTED_CONTRACT_APIS);
		});

		test("host session.apiDocs('json') returns same catalog as runtime.apiDocs('json')", async ({
			harness,
		}) => {
			const hostDocs = await harness.sidepanel.evaluate(async () => {
				const session = (window as any).__extensionSession;
				if (!session || typeof session.apiDocs !== "function") {
					throw new Error("session.apiDocs is not available");
				}
				return session.apiDocs("json");
			});
			expect(Array.isArray(hostDocs)).toBe(true);
			expect(hostDocs.length).toBeGreaterThan(0);
			assertRuntimeApiDocsComplete(
				hostDocs as RuntimeApiDocEntry[],
				DOCUMENTED_CONTRACT_APIS,
			);

			const runtimeDocs = await readRuntimeApiDocs(harness.sidepanel);
			expect(hostDocs.length).toBe(runtimeDocs.length);
			const hostNames = collectRuntimePublicNames(
				hostDocs as RuntimeApiDocEntry[],
			);
			const runtimeNames = collectRuntimePublicNames(runtimeDocs);
			expect(hostNames).toEqual(runtimeNames);
		});

		test("host session.apiDocs('markdown') returns markdown string", async ({
			harness,
		}) => {
			const markdown = await harness.sidepanel.evaluate(async () => {
				const session = (window as any).__extensionSession;
				if (!session || typeof session.apiDocs !== "function") {
					throw new Error("session.apiDocs is not available");
				}
				return session.apiDocs("markdown");
			});
			expect(typeof markdown).toBe("string");
			expect(markdown).toContain("## `page` module");
			expect(markdown).toContain("page.goto");
			expect(markdown).toContain("**Returns**");
		});
	});
