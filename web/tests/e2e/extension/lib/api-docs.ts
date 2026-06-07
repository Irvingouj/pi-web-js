import { expect } from "@playwright/test";

export type RuntimeApiDocAlias = {
	namespace: string;
	name: string;
	fields?: string[] | null;
};

export type RuntimeApiDocEntry = {
	namespace: string;
	name: string;
	action: string | null;
	description: string;
	params: Array<{
		name: string;
		type?: string;
		required: boolean;
		description: string;
	}>;
	returns: {
		type?: string;
		description: string;
	};
	public_name: string;
	source?: string;
	transport?: string;
	tool_source?: string;
	fields?: string[] | null;
	aliases?: RuntimeApiDocAlias[];
	permission?: string;
};

const KNOWN_TOOL_SOURCES = new Set(["rust_core", "js_prelude", "extension"]);

export function parseRuntimeApiDocs(json: string): RuntimeApiDocEntry[] {
	const docs = JSON.parse(json) as unknown;
	expect(Array.isArray(docs)).toBe(true);
	return docs as RuntimeApiDocEntry[];
}

export function collectRuntimePublicNames(
	docs: RuntimeApiDocEntry[],
): Set<string> {
	const names = new Set<string>();
	for (const doc of docs) {
		names.add(doc.public_name);
		for (const alias of doc.aliases ?? []) {
			names.add(`${alias.namespace}.${alias.name}`);
		}
	}
	return names;
}

/**
 * Contract names that may resolve via alias or canonical registry name.
 * Most tab.* contract APIs still register as web.tab.* without a tab.* alias.
 */
export function resolveDocumentedPublicName(contractApi: string): string[] {
	const candidates = [contractApi];
	if (contractApi.startsWith("tab.")) {
		candidates.push(`web.${contractApi}`);
	}
	return candidates;
}

export function hasDocumentedPublicName(
	publicNames: Set<string>,
	contractApi: string,
): boolean {
	return resolveDocumentedPublicName(contractApi).some((name) =>
		publicNames.has(name),
	);
}

/** Contract APIs bound in prelude or host shims without manifest metadata (yet). */
export const UNDOCUMENTED_CONTRACT_PREFIXES = [
	"global.",
	"path.",
	"t.",
	"host.",
] as const;

export const UNDOCUMENTED_CONTRACT_APIS = new Set([
	"chrome.runtime.id",
]);

export function filterDocumentedContractApis(
	publicNames: string[],
): string[] {
	return publicNames.filter(
		(name) =>
			!UNDOCUMENTED_CONTRACT_APIS.has(name) &&
			!UNDOCUMENTED_CONTRACT_PREFIXES.some((prefix) =>
				name.startsWith(prefix),
			),
	);
}

export function assertRuntimeApiDocsComplete(
	docs: RuntimeApiDocEntry[],
	requiredPublicNames: string[],
): void {
	expect(docs.length).toBeGreaterThanOrEqual(130);

	const publicNames = collectRuntimePublicNames(docs);
	const missing = requiredPublicNames.filter(
		(name) => !hasDocumentedPublicName(publicNames, name),
	);
	expect(
		missing,
		`runtime.apiDocs missing ${missing.length} contract APIs: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "..." : ""}`,
	).toEqual([]);

	for (const doc of docs) {
		expect(doc.public_name.length).toBeGreaterThan(0);
		expect(doc.description.length).toBeGreaterThan(0);
		expect(doc.returns.description.length).toBeGreaterThan(0);
		expect(
			doc.returns.type?.length || doc.returns.description.length,
		).toBeGreaterThan(0);
		expect(Array.isArray(doc.params)).toBe(true);
		if (doc.source) {
			expect(KNOWN_TOOL_SOURCES.has(doc.source)).toBe(true);
		}
		for (const param of doc.params) {
			expect(param.name.length).toBeGreaterThan(0);
			expect((param.type ?? "").length).toBeGreaterThan(0);
			expect(param.description.length).toBeGreaterThan(0);
			expect(typeof param.required).toBe("boolean");
		}
	}
}
