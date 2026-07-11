// @vitest-environment node

/**
 * Seam: register({ name, surfaces, params, returns, ... })
 * Product behavior: one capability registration expands to page and/or web.tab
 * manifest entries, docs from Zod, content-script owner, no main-thread tool handler.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { getContentScriptSpec } from "../../src/content-script/registry.js";
import {
	clearContentScriptActions,
	isContentScriptAction,
} from "../../src/shared/cross/content-script-actions.js";
import { register } from "../../src/shared/main/register-capability.js";
import {
	clearJsRegistry,
	freezeJsRegistry,
	getSerializableJsManifest,
	getTool,
} from "../../src/shared/main/tool-registry.js";

const ClickParams = z.object({
	refId: z.string().optional().describe("Element reference ID"),
	label: z.string().optional().describe("Element label"),
});
const ClickResult = z.object({
	ok: z.literal(true),
	action: z.literal("click"),
});

describe("register capability", () => {
	beforeEach(() => {
		clearJsRegistry();
		clearContentScriptActions();
	});

	it("one register with page + web.tab surfaces exposes both callables to the manifest", () => {
		register({
			name: "click",
			description: "Click an element",
			surfaces: ["page", "web.tab"],
			params: ClickParams,
			returns: ClickResult,
			errorCode: "E_MISSING_PARAM",
			example: 'page.click({ refId: "e2" })',
		});

		const manifest = getSerializableJsManifest();
		const page = manifest.find((m) => m.action === "page_click");
		const tab = manifest.find((m) => m.action === "tab_click");

		expect(page).toMatchObject({
			action: "page_click",
			namespace: "page",
			name: "click",
			publicName: "page.click",
			owner: "content-script",
			description: "Click an element",
		});
		expect(tab).toMatchObject({
			action: "tab_click",
			namespace: "web.tab",
			name: "click",
			publicName: "web.tab.click",
			owner: "content-script",
		});

		expect(isContentScriptAction("page_click")).toBe(true);
		expect(isContentScriptAction("tab_click")).toBe(true);

		// No main-thread executable tool (no stub to dispatch)
		expect(getTool("page_click")).toBeUndefined();
		expect(getTool("tab_click")).toBeUndefined();

		expect(() => freezeJsRegistry()).not.toThrow();
	});

	it("manifest param docs come from Zod declared params, not hand-written paramTypes", () => {
		register({
			name: "click",
			description: "Click an element",
			surfaces: ["page"],
			params: ClickParams,
			returns: ClickResult,
			errorCode: "E_MISSING_PARAM",
		});

		const page = getSerializableJsManifest().find(
			(m) => m.action === "page_click",
		);
		expect(page?.paramsDoc?.some((p) => p.name === "refId")).toBe(true);
		expect(page?.paramsDoc?.some((p) => p.name === "label")).toBe(true);
	});

	it("web.tab surface adds tabId to declared params docs", () => {
		register({
			name: "click",
			description: "Click an element",
			surfaces: ["web.tab"],
			params: ClickParams,
			returns: ClickResult,
			errorCode: "E_NO_TAB",
		});

		const tab = getSerializableJsManifest().find(
			(m) => m.action === "tab_click",
		);
		expect(tab?.paramsDoc?.some((p) => p.name === "tabId")).toBe(true);
	});

	it("opt-in handlerParams registers content-script validation schema separately from declared params", () => {
		const Declared = z.object({
			refId: z.string(),
			files: z.array(z.object({ path: z.string() })),
		});
		const Resolved = z.object({
			refId: z.string(),
			files: z.array(
				z.object({
					kind: z.literal("bytes"),
					name: z.string(),
					mimeType: z.string(),
					base64: z.string(),
				}),
			),
		});

		register({
			name: "setFiles",
			handlerKey: "set_files",
			description: "Attach files",
			surfaces: ["page"],
			params: Declared,
			handlerParams: Resolved,
			returns: z.object({ ok: z.literal(true) }),
			errorCode: "E_MISSING_PARAM",
			wireContentScriptSchema: true,
		});

		const spec = getContentScriptSpec("page_set_files");
		expect(spec).toBeDefined();
		expect(spec?.handlerKey).toBe("set_files");
		// handlerParams used for CS validation
		const bad = Resolved.safeParse({
			refId: "e1",
			files: [{ path: "/x" }],
		});
		expect(bad.success).toBe(false);
		const good = Resolved.safeParse({
			refId: "e1",
			files: [
				{
					kind: "bytes",
					name: "a.txt",
					mimeType: "text/plain",
					base64: "YQ==",
				},
			],
		});
		expect(good.success).toBe(true);
		// CS registry holds handlerParams schema
		expect(spec?.params.safeParse(good.data).success).toBe(true);
		expect(spec?.params.safeParse({ refId: "e1", files: [{ path: "/x" }] }).success).toBe(
			false,
		);

		// Declared docs still describe agent-facing shape (path), not resolved bytes
		const entry = getSerializableJsManifest().find(
			(m) => m.action === "page_set_files",
		);
		const fileParam = entry?.paramsDoc?.find((p) => p.name === "files");
		expect(fileParam).toBeDefined();
	});

	it("surfaces page-only does not emit web.tab action", () => {
		register({
			name: "find",
			description: "Find elements",
			surfaces: ["page"],
			params: z.object({ query: z.string() }),
			returns: z.array(z.string()),
			errorCode: "E_NO_TAB",
		});

		const actions = getSerializableJsManifest().map((m) => m.action);
		expect(actions).toContain("page_find");
		expect(actions).not.toContain("tab_find");
	});

	it("web.tab surface puts tabId first in fields for positional tabId", () => {
		register({
			name: "snapshot",
			description: "Snapshot",
			surfaces: ["page", "web.tab"],
			params: z.object({
				max_nodes: z.number().optional(),
			}),
			returns: z.string(),
			errorCode: "E_SNAPSHOT",
			// page has no fields; web.tab must still get ["tabId"]
		});

		const tab = getSerializableJsManifest().find(
			(m) => m.action === "tab_snapshot",
		);
		expect(tab?.fields).toEqual(["tabId"]);

		register({
			name: "fetch",
			description: "Fetch",
			surfaces: ["web.tab"],
			params: z.object({ url: z.string() }),
			returns: z.object({}),
			errorCode: "E_NO_TAB",
			fields: ["url", "options"],
		});
		const fetch = getSerializableJsManifest().find(
			(m) => m.action === "tab_fetch",
		);
		expect(fetch?.fields).toEqual(["tabId", "url", "options"]);
	});
});
