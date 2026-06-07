// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

// Load the full runner tool registrations.
import "../src/main/runner/index.js";
import { manifestEntryToWasm } from "../src/shared/registry/manifest.js";
import {
	getSerializableJsManifest,
	listTools,
} from "../src/shared/tool-registry.js";

const KNOWN_OWNERS = new Set([
	"main-thread",
	"content-script",
	"worker",
	"offscreen",
]);

describe("manifest documentation export", () => {
	it("exports a large manifest with unique actions", () => {
		const manifest = getSerializableJsManifest();
		expect(manifest.length).toBeGreaterThanOrEqual(130);

		const actions = manifest.map((entry) => entry.action);
		expect(new Set(actions).size).toBe(actions.length);
	});

	it("every manifest entry has complete documentation metadata", () => {
		const manifest = getSerializableJsManifest();

		for (const entry of manifest) {
			expect(entry.action.length).toBeGreaterThan(0);
			expect(entry.namespace.length).toBeGreaterThan(0);
			expect(entry.name.length).toBeGreaterThan(0);
			expect(entry.publicName).toBe(`${entry.namespace}.${entry.name}`);
			expect(entry.description.length).toBeGreaterThan(0);
			expect(entry.errorCode.length).toBeGreaterThan(0);
			expect(KNOWN_OWNERS.has(entry.owner)).toBe(true);
			expect(Array.isArray(entry.paramsDoc)).toBe(true);
			expect(entry.returnsDoc.type.length).toBeGreaterThan(0);
			expect(entry.returnsDoc.description.length).toBeGreaterThan(0);

			for (const param of entry.paramsDoc) {
				expect(param.name.length).toBeGreaterThan(0);
				expect(param.type.length).toBeGreaterThan(0);
				expect(typeof param.required).toBe("boolean");
				expect(param.description.length).toBeGreaterThan(0);
			}
		}
	});

	it("listTools covers every main-thread manifest entry", () => {
		const manifest = getSerializableJsManifest();
		const mainThreadActions = new Set(
			manifest
				.filter((entry) => entry.owner === "main-thread")
				.map((entry) => entry.action),
		);
		const toolActions = new Set(listTools().map((tool) => tool.action));

		for (const action of mainThreadActions) {
			expect(toolActions.has(action)).toBe(true);
		}
	});

	it("does not export rust-owned entries from the JS manifest", () => {
		const manifest = getSerializableJsManifest();
		expect(manifest.every((entry) => entry.owner !== "rust")).toBe(true);
	});

	it("includes content-script and main-thread owners", () => {
		const manifest = getSerializableJsManifest();
		const owners = new Set(manifest.map((entry) => entry.owner));
		expect(owners.has("content-script")).toBe(true);
		expect(owners.has("main-thread")).toBe(true);
	});

	it("manifestEntryToWasm maps docs into the WASM registration shape", () => {
		const manifest = getSerializableJsManifest();
		const sample =
			manifest.find((entry) => entry.action === "page_goto") ??
			manifest[0];

		expect(manifestEntryToWasm(sample)).toEqual({
			action: sample.action,
			namespace: sample.namespace,
			name: sample.name,
			publicName: sample.publicName,
			description: sample.description,
			fields: sample.fields,
			aliases: (sample.aliases ?? []).map((alias) => ({
				namespace: alias.namespace,
				name: alias.name,
				fields: alias.fields,
			})),
			paramsDoc: sample.paramsDoc.map((param) => ({
				name: param.name,
				type: param.type,
				required: param.required,
				description: param.description,
			})),
			returnsDoc: {
				type: sample.returnsDoc.type,
				description: sample.returnsDoc.description,
			},
			errorCode: sample.errorCode,
			errorCategory: sample.errorCategory ?? null,
		});
	});

	it("manifestEntryToWasm preserves aliases for WASM import", () => {
		const manifest = getSerializableJsManifest();
		const withAlias = manifest.find(
			(entry) => (entry.aliases?.length ?? 0) > 0,
		);
		expect(withAlias).toBeDefined();
		const wasm = manifestEntryToWasm(withAlias!);
		expect(wasm.aliases).toEqual(
			(withAlias!.aliases ?? []).map((alias) => ({
				namespace: alias.namespace,
				name: alias.name,
				fields: alias.fields,
			})),
		);
	});

	it("documents representative APIs with expected shapes", () => {
		const manifest = getSerializableJsManifest();
		const pageGoto = manifest.find((entry) => entry.action === "page_goto");
		const pageClick = manifest.find((entry) => entry.action === "page_click");
		const chromeTabsQuery = manifest.find(
			(entry) => entry.action === "chrome_tabs_query",
		);

		expect(pageGoto?.owner).toBe("main-thread");
		expect(pageGoto?.fields).toEqual(["url"]);
		expect(pageClick?.owner).toBe("content-script");
		expect(chromeTabsQuery?.fields).toBeNull();

		const tabCreate = manifest.find((entry) => entry.action === "tab_create");
		expect(tabCreate?.aliases).toEqual([{ namespace: "tab", name: "create", fields: null }]);
	});
});
