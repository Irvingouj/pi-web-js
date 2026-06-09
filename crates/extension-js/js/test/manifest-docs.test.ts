// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { z } from "zod";

// Load the full runner tool registrations.
import "../src/main/runner/index.js";
import { manifestEntryToWasm } from "../src/shared/registry/manifest.js";
import {
	clearRegistry,
	freezeJsRegistry,
	getSerializableJsManifest,
	listTools,
	registerContentScriptJsCall,
	registerJsCall,
	removeToolForTest,
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
			expect(entry.returnsDoc.type).not.toBe("undefined");
			expect(entry.returnsDoc.description.length).toBeGreaterThan(0);
			expect(entry.example).toBeDefined();
			expect(entry.example.length).toBeGreaterThan(0);

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
			permission: sample.permission ?? null,
			example: sample.example ?? null,
			prerequisites: sample.prerequisites ?? null,
			notes: sample.notes ?? null,
			tags: sample.tags ?? null,
			relatedApis: sample.relatedApis ?? null,
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
		const pageFind = manifest.find((entry) => entry.action === "page_find");
		const chromeTabsQuery = manifest.find(
			(entry) => entry.action === "chrome_tabs_query",
		);

		expect(pageGoto?.owner).toBe("main-thread");
		expect(pageGoto?.fields).toEqual(["url"]);
		expect(pageGoto?.example).toBe('page.goto("https://example.com")');
		expect(pageClick?.owner).toBe("content-script");
		expect(pageClick?.paramsDoc[0]?.description).toContain("(refId)");
		expect(pageFind?.description).toContain("CSS selector");
		expect(pageFind?.fields).toEqual(["selector"]);
		expect(chromeTabsQuery?.fields).toBeNull();

		const tabCreate = manifest.find((entry) => entry.action === "tab_create");
		expect(tabCreate?.fields).toEqual(["url"]);
		expect(tabCreate?.aliases).toEqual([
			{ namespace: "tab", name: "create", fields: ["url"] },
		]);
		const pageNewTab = manifest.find((entry) => entry.action === "page_new_tab");
		expect(pageNewTab?.fields).toEqual(["url"]);

		expect(pageFind?.aliases?.some((a) => a.namespace === "page" && a.name === "query")).toBe(true);
	});

	it("registers page tab aliases", () => {
		const manifest = getSerializableJsManifest();
		expect(manifest.some((e) => e.action === "page_tabs")).toBe(true);
		expect(manifest.some((e) => e.action === "page_switch")).toBe(true);
		expect(manifest.some((e) => e.action === "page_new_tab")).toBe(true);
	});

	it("manifest examples avoid known-invalid chrome call patterns", () => {
		const manifest = getSerializableJsManifest();
		const denylist = [
			/chrome\.getInfo\(/,
			/chrome\.search\(/,
			/^chrome\.query\(/,
			/^chrome\.create\(/,
			/^chrome\.get\(/,
			/^chrome\.set\(/,
			/^chrome\.remove\(/,
			/^chrome\.update\(/,
			/^chrome\.clear\(/,
		];
		for (const entry of manifest) {
			if (!entry.example) continue;
			for (const pattern of denylist) {
				expect(entry.example).not.toMatch(pattern);
			}
			if (entry.example.startsWith("chrome.")) {
				const prefix = entry.publicName.replace(/\.[^.]+$/, "");
				expect(entry.example.startsWith(prefix)).toBe(true);
			}
		}
		const cpuInfo = manifest.find(
			(entry) => entry.action === "chrome_system_cpu_getInfo",
		);
		const memoryInfo = manifest.find(
			(entry) => entry.action === "chrome_system_memory_getInfo",
		);
		const storageInfo = manifest.find(
			(entry) => entry.action === "chrome_system_storage_getInfo",
		);
		expect(cpuInfo?.example).toBe("chrome.system.cpu.getInfo()");
		expect(memoryInfo?.example).toBe("chrome.system.memory.getInfo()");
		expect(storageInfo?.example).toBe("chrome.system.storage.getInfo()");
		const bookmarksSearch = manifest.find(
			(entry) => entry.action === "chrome_bookmarks_search",
		);
		expect(bookmarksSearch?.example).toContain("chrome.bookmarks.search");
	});

	it("includes permission field for permission-gated APIs", () => {
		const manifest = getSerializableJsManifest();
		const chromeNotificationsCreate = manifest.find(
			(entry) => entry.action === "chrome_notifications_create",
		);
		const chromeCookiesGet = manifest.find(
			(entry) => entry.action === "chrome_cookies_get",
		);
		expect(chromeNotificationsCreate?.permission).toBe("notifications");
		expect(chromeCookiesGet?.permission).toBe("cookies");

		const wasmNotifications = manifestEntryToWasm(chromeNotificationsCreate!);
		const wasmCookies = manifestEntryToWasm(chromeCookiesGet!);
		expect(wasmNotifications.permission).toBe("notifications");
		expect(wasmCookies.permission).toBe("cookies");

		const chromeRuntimeGetUrl = manifest.find(
			(entry) => entry.action === "chrome_runtime_getURL",
		);
		const chromeActionSetBadge = manifest.find(
			(entry) => entry.action === "chrome_action_setBadgeText",
		);
		expect(chromeRuntimeGetUrl?.permission).toBeUndefined();
		expect(chromeActionSetBadge?.permission).toBeUndefined();
	});

	it("seeds agentMeta on page.* mutation APIs", () => {
		const manifest = getSerializableJsManifest();
		const pageFill = manifest.find((e) => e.action === "page_fill");
		expect(pageFill?.prerequisites).toEqual(["Ensure the target tab is active and the content script is ready before mutating"]);
		expect(pageFill?.tags).toEqual(["mutation", "write"]);
		expect(pageFill?.relatedApis).toEqual(["web.tab.fill"]);

		const pageClick = manifest.find((e) => e.action === "page_click");
		expect(pageClick?.prerequisites).toEqual(["Ensure the target tab is active and the content script is ready before mutating"]);
		expect(pageClick?.tags).toEqual(["mutation", "write"]);
		expect(pageClick?.relatedApis).toEqual(["web.tab.click"]);

		const pageType = manifest.find((e) => e.action === "page_type");
		expect(pageType?.tags).toEqual(["mutation", "write"]);
		expect(pageType?.relatedApis).toEqual(["web.tab.type"]);

		const pageAppend = manifest.find((e) => e.action === "page_append");
		expect(pageAppend?.tags).toEqual(["mutation", "write"]);
		expect(pageAppend?.relatedApis).toBeUndefined();

		const pagePress = manifest.find((e) => e.action === "page_press");
		expect(pagePress?.tags).toEqual(["mutation", "write"]);
		expect(pagePress?.relatedApis).toEqual(["web.tab.press"]);

		const pageSelect = manifest.find((e) => e.action === "page_select");
		expect(pageSelect?.tags).toEqual(["mutation", "write"]);
		expect(pageSelect?.relatedApis).toEqual(["web.tab.select"]);

		const pageCheck = manifest.find((e) => e.action === "page_check");
		expect(pageCheck?.tags).toEqual(["mutation", "write"]);
		expect(pageCheck?.relatedApis).toEqual(["web.tab.check"]);

		const pageHover = manifest.find((e) => e.action === "page_hover");
		expect(pageHover?.tags).toEqual(["mutation", "write"]);
		expect(pageHover?.relatedApis).toEqual(["web.tab.hover"]);
	});

	it("seeds agentMeta on page.* snapshot APIs", () => {
		const manifest = getSerializableJsManifest();
		const pageSnapshot = manifest.find((e) => e.action === "page_snapshot");
		expect(pageSnapshot?.notes?.join(" ")).toMatch(/content-script/i);
		expect(pageSnapshot?.tags).toEqual(["snapshot", "read"]);
		expect(pageSnapshot?.relatedApis).toEqual([
			"page.snapshot_data",
			"web.tab.snapshot",
		]);

		const pageSnapshotData = manifest.find((e) => e.action === "page_snapshot_data");
		expect(pageSnapshotData?.notes?.join(" ")).toMatch(/content-script/i);
		expect(pageSnapshotData?.tags).toEqual(["snapshot", "read"]);
		expect(pageSnapshotData?.relatedApis).toEqual([
			"page.click",
			"web.tab.snapshot_data",
		]);
	});

	it("seeds agentMeta on web.tab.* mutation APIs", () => {
		const manifest = getSerializableJsManifest();
		const tabFill = manifest.find((e) => e.action === "tab_fill");
		expect(tabFill?.prerequisites).toEqual(["Ensure the target tab exists and the content script is ready before mutating"]);
		expect(tabFill?.tags).toEqual(["mutation", "write"]);
		expect(tabFill?.notes).toContain("Explicit tabId required; same handlers as page.*");
		expect(tabFill?.relatedApis).toEqual(["page.fill"]);

		const tabClick = manifest.find((e) => e.action === "tab_click");
		expect(tabClick?.prerequisites).toEqual(["Ensure the target tab exists and the content script is ready before mutating"]);
		expect(tabClick?.tags).toEqual(["mutation", "write"]);
		expect(tabClick?.relatedApis).toEqual(["page.click"]);

		const tabType = manifest.find((e) => e.action === "tab_type");
		expect(tabType?.tags).toEqual(["mutation", "write"]);
		expect(tabType?.relatedApis).toEqual(["page.type"]);

		const tabPress = manifest.find((e) => e.action === "tab_press");
		expect(tabPress?.tags).toEqual(["mutation", "write"]);
		expect(tabPress?.relatedApis).toEqual(["page.press"]);

		const tabSelect = manifest.find((e) => e.action === "tab_select");
		expect(tabSelect?.tags).toEqual(["mutation", "write"]);
		expect(tabSelect?.relatedApis).toEqual(["page.select"]);

		const tabCheck = manifest.find((e) => e.action === "tab_check");
		expect(tabCheck?.tags).toEqual(["mutation", "write"]);
		expect(tabCheck?.relatedApis).toEqual(["page.check"]);

		const tabHover = manifest.find((e) => e.action === "tab_hover");
		expect(tabHover?.tags).toEqual(["mutation", "write"]);
		expect(tabHover?.relatedApis).toEqual(["page.hover"]);
	});

	it("derives returnsDoc.type from Zod schema when returnType is missing", () => {
		const manifest = getSerializableJsManifest();
		const pageFind = manifest.find((entry) => entry.action === "page_find");
		expect(pageFind).toBeDefined();
		// page_find returns z.array(z.object({ tag: z.string(), refId: z.string().nullable(), text: z.string() }))
		expect(pageFind!.returnsDoc.type).toContain("tag");
		expect(pageFind!.returnsDoc.type).toContain("refId");
		expect(pageFind!.returnsDoc.type).toContain("text");
	});

	it("page_fill paramsDoc contains refId and value from hand-written paramTypes", () => {
		const manifest = getSerializableJsManifest();
		const pageFill = manifest.find((entry) => entry.action === "page_fill");
		expect(pageFill).toBeDefined();
		expect(pageFill!.paramsDoc.some((p) => p.name === "refId")).toBe(true);
		expect(pageFill!.paramsDoc.some((p) => p.name === "value")).toBe(true);
	});

	it("page_fill returnsDoc.type contains ok and action", () => {
		const manifest = getSerializableJsManifest();
		const pageFill = manifest.find((e) => e.action === "page_fill");
		expect(pageFill).toBeDefined();
		expect(pageFill!.returnsDoc.type).toContain("ok");
		expect(pageFill!.returnsDoc.type).toContain("action");
	});

	it("page_fill returnsDoc.type does NOT start with null", () => {
		const manifest = getSerializableJsManifest();
		const pageFill = manifest.find((e) => e.action === "page_fill");
		expect(pageFill).toBeDefined();
		expect(pageFill!.returnsDoc.type).not.toMatch(/^null/);
	});

	it("every mutation entry uses MutationReturnSchema (returnsDoc contains ok and action)", () => {
		const manifest = getSerializableJsManifest();
		const mutations = manifest.filter((e) => e.tags?.includes("mutation"));
		expect(mutations.length).toBeGreaterThan(0);
		for (const m of mutations) {
			expect(m.returnsDoc.type).toContain("ok");
			expect(m.returnsDoc.type).toContain("action");
		}
	});

	it("no manifest entry has returnsDoc.type === undefined", () => {
		const manifest = getSerializableJsManifest();
		for (const entry of manifest) {
			expect(entry.returnsDoc.type).not.toBe("undefined");
		}
	});

	it("no manifest entry has banned types in returnsDoc.type or paramsDoc[].type", () => {
		const manifest = getSerializableJsManifest();
		const banned = new Set(["unknown", "undefined", "any", "object", "lazy", "void", "record"]);
		for (const entry of manifest) {
			expect(banned.has(entry.returnsDoc.type)).toBe(false);
			for (const param of entry.paramsDoc) {
				expect(banned.has(param.type)).toBe(false);
			}
		}
	});

	it("forwards agentMeta from JsCallSpec through the manifest to WASM", () => {
		clearRegistry();
		registerJsCall({
			action: "agent_meta_test_action",
			namespace: "test",
			name: "agentMeta",
			description: "Test agent metadata forwarding",
			params: z.object({}),
			returns: z.null(),
			owner: "main-thread",
			handler: async () => null,
			paramTypes: [],
			returnDoc: "null",
			errorCode: "ETEST",
			agentMeta: {
				prerequisites: ["page.click()"],
				notes: ["Requires active tab"],
				tags: ["mutation", "navigation"],
				relatedApis: ["page_click", "page_goto"],
			},
		});

		const manifest = getSerializableJsManifest();
		const entry = manifest.find((e) => e.action === "agent_meta_test_action");
		expect(entry).toBeDefined();
		expect(entry?.prerequisites).toEqual(["page.click()"]);
		expect(entry?.notes).toEqual(["Requires active tab"]);
		expect(entry?.tags).toEqual(["mutation", "navigation"]);
		expect(entry?.relatedApis).toEqual(["page_click", "page_goto"]);

		const wasm = manifestEntryToWasm(entry!);
		expect(wasm.prerequisites).toEqual(["page.click()"]);
		expect(wasm.notes).toEqual(["Requires active tab"]);
		expect(wasm.tags).toEqual(["mutation", "navigation"]);
		expect(wasm.relatedApis).toEqual(["page_click", "page_goto"]);
	});

	it("manifestEntryToWasm handles empty agentMeta arrays correctly", () => {
		const entry: import("../src/shared/registry/manifest.js").SerializableJsCallManifestEntry = {
			action: "empty_meta_test",
			namespace: "test",
			name: "empty",
			publicName: "test.empty",
			description: "Test empty arrays",
			fields: null,
			aliases: null,
			owner: "main-thread",
			paramsDoc: [],
			returnsDoc: { type: "null", description: "null" },
			errorCode: "ETEST",
			prerequisites: [],
			notes: [],
			tags: [],
			relatedApis: [],
		};

		const wasm = manifestEntryToWasm(entry);
		expect(wasm.prerequisites).toEqual([]);
		expect(wasm.notes).toEqual([]);
		expect(wasm.tags).toEqual([]);
		expect(wasm.relatedApis).toEqual([]);
	});

	it("manifestEntryToWasm handles partial agentMeta correctly", () => {
		const entry: import("../src/shared/registry/manifest.js").SerializableJsCallManifestEntry = {
			action: "partial_meta_test",
			namespace: "test",
			name: "partial",
			publicName: "test.partial",
			description: "Test partial metadata",
			fields: null,
			aliases: null,
			owner: "main-thread",
			paramsDoc: [],
			returnsDoc: { type: "null", description: "null" },
			errorCode: "ETEST",
			tags: ["read"],
		};

		const wasm = manifestEntryToWasm(entry);
		expect(wasm.prerequisites).toBeNull();
		expect(wasm.notes).toBeNull();
		expect(wasm.tags).toEqual(["read"]);
		expect(wasm.relatedApis).toBeNull();
	});
});

describe("manifest integrity", () => {
	it("freezeJsRegistry passes when every manifest entry has a handler", () => {
		// The full runner registration already loaded; freeze should succeed.
		expect(() => freezeJsRegistry()).not.toThrow();
	});

	it("freezeJsRegistry throws when a content-script entry lacks a handler manifest entry", () => {
		clearRegistry();
		registerContentScriptJsCall({
			action: "phantom_content_action",
			namespace: "test",
			name: "phantom",
			description: "Phantom content-script action",
			params: z.object({}),
			returns: z.null(),
			paramTypes: [],
			returnDoc: "null",
			errorCode: "ETEST",
		});
		expect(() => freezeJsRegistry()).toThrow("phantom_content_action");
	});

	it("freezeJsRegistry passes when a main-thread entry has a tool handler", () => {
		clearRegistry();
		registerJsCall({
			action: "phantom_main_action",
			namespace: "test",
			name: "phantom",
			description: "Phantom main-thread action",
			params: z.object({}),
			returns: z.null(),
			owner: "main-thread",
			handler: async () => null,
			paramTypes: [],
			returnDoc: "null",
			errorCode: "ETEST",
		});
		expect(() => freezeJsRegistry()).not.toThrow();
		const manifest = getSerializableJsManifest();
		const mainThreadEntry = manifest.find((e) => e.action === "phantom_main_action");
		expect(mainThreadEntry?.owner).toBe("main-thread");
	});

	it("freezeJsRegistry throws when a main-thread entry lacks a tool handler", () => {
		clearRegistry();
		registerJsCall({
			action: "orphan_main_action",
			namespace: "test",
			name: "orphan",
			description: "Orphan main-thread action",
			params: z.object({}),
			returns: z.null(),
			owner: "main-thread",
			handler: async () => null,
			paramTypes: [],
			returnDoc: "null",
			errorCode: "ETEST",
		});
		// Simulate a phantom API by removing the tool handler while keeping the JS registry entry.
		expect(removeToolForTest("orphan_main_action")).toBe(true);
		expect(() => freezeJsRegistry()).toThrow("orphan_main_action");
	});

	it("derives paramsDoc from Zod schema when paramTypes is empty", () => {
		clearRegistry();
		registerJsCall({
			action: "zod_derived_params_test",
			namespace: "test",
			name: "zodDerivedParams",
			description: "Test zod-derived paramsDoc",
			params: z.object({
				url: z.string(),
				timeout: z.number().optional(),
			}),
			returns: z.null(),
			owner: "main-thread",
			handler: async () => null,
			paramTypes: [],
			returnDoc: "null",
			errorCode: "ETEST",
		});

		const manifest = getSerializableJsManifest();
		const entry = manifest.find((e) => e.action === "zod_derived_params_test");
		expect(entry).toBeDefined();
		expect(entry!.paramsDoc.some((p) => p.name === "url")).toBe(true);
		expect(entry!.paramsDoc.some((p) => p.name === "timeout")).toBe(true);
		expect(entry!.paramsDoc.find((p) => p.name === "url")?.required).toBe(true);
		expect(entry!.paramsDoc.find((p) => p.name === "timeout")?.required).toBe(false);
	});
});
