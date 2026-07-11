// @vitest-environment node

import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
	addContentScriptAction,
	clearContentScriptActions,
	getContentScriptActions,
	isContentScriptAction,
} from "../../src/shared/cross/content-script-actions.js";
import { CONTENT_SCRIPT_CAPABILITIES } from "../../src/shared/cross/content-script-capabilities.js";
import { register } from "../../src/shared/main/register-capability.js";
import {
	clearJsRegistry,
	freezeJsRegistry,
	getSerializableJsManifest,
	getTool,
} from "../../src/shared/main/tool-registry.js";

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

describe("register capability on main pipeline", () => {
	beforeEach(() => {
		clearJsRegistry();
		clearContentScriptActions();
	});

	it("creates content-script owner manifest entry without main-thread tool", () => {
		register({
			name: "manifest",
			description: "Test manifest entry",
			surfaces: ["page"],
			params: z.object({}),
			returns: z.null(),
			errorCode: "E_TEST",
		});

		const entry = getSerializableJsManifest().find(
			(m) => m.action === "page_manifest",
		);
		expect(entry).toBeDefined();
		expect(entry?.owner).toBe("content-script");
		expect(getTool("page_manifest")).toBeUndefined();
		expect(isContentScriptAction("page_manifest")).toBe(true);
	});

	it("freezes without orphans", () => {
		register({
			name: "freeze",
			description: "Test freeze",
			surfaces: ["page"],
			params: z.object({}),
			returns: z.null(),
			errorCode: "E_TEST",
		});
		expect(() => freezeJsRegistry()).not.toThrow();
	});
});

describe("dropdown rule in agent docs", () => {
	it("select_option agentMeta enforces dropdown rule and uses degree example", () => {
		const cap = CONTENT_SCRIPT_CAPABILITIES.find(
			(c) => c.actionStem === "select_option" || c.name === "select_option",
		);
		expect(cap).toBeDefined();
		if (!cap) return;
		const notes = (cap.agentMeta?.notes || []).join(" ");
		expect(notes).toMatch(/NEVER page\.fill.*dropdown/i);
		expect(cap.example).toContain("select_option({ refId: degree.refId");
	});
});
