// @vitest-environment node

import { describe, expect, it, beforeEach } from "vitest";
import { z } from "zod";
import { defineContentScriptTool } from "../../src/shared/registry/define-content-script-tool.js";
import {
	addContentScriptAction,
	clearContentScriptActions,
	getContentScriptActions,
	isContentScriptAction,
} from "../../src/shared/registry/content-script-actions.js";
import { getContentScriptSpec } from "../../src/content-script/registry.js";
import {
	clearJsRegistry,
	freezeJsRegistry,
	getSerializableJsManifest,
} from "../../src/shared/tool-registry.js";

describe("content-script action set", () => {
	beforeEach(() => {
		clearContentScriptActions();
	});

	it("addContentScriptAction makes isContentScriptAction return true", () => {
		expect(isContentScriptAction("test_action")).toBe(false);
		addContentScriptAction("test_action");
		expect(isContentScriptAction("test_action")).toBe(true);
	});

	it("getContentScriptActions returns an array containing added actions", () => {
		addContentScriptAction("action_a");
		addContentScriptAction("action_b");
		const actions = getContentScriptActions();
		expect(Array.isArray(actions)).toBe(true);
		expect(actions).toContain("action_a");
		expect(actions).toContain("action_b");
	});

	it("duplicate adds are idempotent (Set behavior)", () => {
		addContentScriptAction("dup_action");
		addContentScriptAction("dup_action");
		const actions = getContentScriptActions();
		expect(actions.filter((a) => a === "dup_action")).toHaveLength(1);
	});
});

describe("defineContentScriptTool", () => {
	beforeEach(() => {
		clearJsRegistry();
		clearContentScriptActions();
	});

	it("calls registerContentScriptJsCall (manifest entry created)", () => {
		defineContentScriptTool({
			action: "cs_test_manifest",
			namespace: "test",
			name: "manifest",
			description: "Test manifest entry",
			params: z.object({}),
			returns: z.null(),
			handlerKey: "test_handler",
		});

		const manifest = getSerializableJsManifest();
		const entry = manifest.find((m) => m.action === "cs_test_manifest");
		expect(entry).toBeDefined();
		expect(entry?.owner).toBe("content-script");
	});

	it("calls addContentScriptAction (action appears in dynamic set)", () => {
		defineContentScriptTool({
			action: "cs_test_action",
			namespace: "test",
			name: "action",
			description: "Test action",
			params: z.object({}),
			returns: z.null(),
			handlerKey: "test_handler",
		});

		expect(isContentScriptAction("cs_test_action")).toBe(true);
		expect(getContentScriptActions()).toContain("cs_test_action");
	});

	it("does NOT call registerContentScriptSpec (no CS spec registered)", () => {
		defineContentScriptTool({
			action: "cs_test_no_spec",
			namespace: "test",
			name: "no_spec",
			description: "Test no spec",
			params: z.object({}),
			returns: z.null(),
			handlerKey: "test_handler",
		});

		expect(getContentScriptSpec("cs_test_no_spec")).toBeUndefined();
	});

	it("freezes without orphans when used with real specs", () => {
		defineContentScriptTool({
			action: "cs_test_freeze",
			namespace: "test",
			name: "freeze",
			description: "Test freeze",
			params: z.object({}),
			returns: z.null(),
			handlerKey: "test_handler",
		});

		expect(() => freezeJsRegistry()).not.toThrow();
	});
});
