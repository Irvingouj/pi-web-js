import { describe, expect, it } from "vitest";
import {
	contentScriptMissingError,
	labelNotFoundError,
	normalizeAgentError,
	staleRefError,
} from "../src/shared/registry/normalize-agent-error.js";

describe("normalizeAgentError", () => {
	it("maps Receiving end does not exist to E_CONTENT_SCRIPT with recovery", () => {
		const err = normalizeAgentError(
			new Error("Could not establish connection. Receiving end does not exist."),
			{ tabId: 941354017, url: "https://www.google.com/" },
		);
		expect(err.code).toBe("E_CONTENT_SCRIPT");
		expect(err.category).toBe("content-script");
		expect(err.message).not.toContain("Receiving end does not exist");
		expect(err.hint).toContain("Content script is not connected");
		expect(err.recovery?.[0]).toContain("page.goto");
		expect(err.recovery?.some((s) => s.includes("page.wake"))).toBe(false);
		expect(err.details?.tabId).toBe(941354017);
	});

	it("maps connection errors without tabId to generic E_CONTENT_SCRIPT", () => {
		const err = normalizeAgentError(
			new Error("Receiving end does not exist."),
		);
		expect(err.code).toBe("E_CONTENT_SCRIPT");
		expect(err.details).toBeUndefined();
		expect(err.hint).toContain("Content script is not connected");
	});

	it("passthrough preserves structured errors with hint", () => {
		const existing = staleRefError("e1");
		expect(normalizeAgentError(existing)).toEqual(existing);
	});

	it("enriches bare E_CONTENT_SCRIPT when tabId context is provided", () => {
		const err = normalizeAgentError(
			{ message: "Content script missing", code: "E_CONTENT_SCRIPT" },
			{ tabId: 3, url: "https://example.com/" },
		);
		expect(err.hint).toContain("Content script is not connected");
		expect(err.details?.tabId).toBe(3);
	});

	it("maps permission errors to E_PERMISSION", () => {
		const err = normalizeAgentError(new Error("permission denied for tabs"));
		expect(err.code).toBe("E_PERMISSION");
		expect(err.category).toBe("permission");
	});

	it("maps not found strings to E_NOT_FOUND", () => {
		const err = normalizeAgentError(new Error("Element not found by refId"));
		expect(err.code).toBe("E_NOT_FOUND");
		expect(err.category).toBe("resource");
	});

	it("falls back to E_EXTENSION for unknown errors", () => {
		const err = normalizeAgentError(new Error("something unexpected"));
		expect(err.code).toBe("E_EXTENSION");
		expect(err.category).toBe("extension");
	});

	it("contentScriptMissingError never mentions page.wake", () => {
		const err = contentScriptMissingError(1, "https://example.com/");
		expect(err.recovery?.join(" ")).not.toContain("page.wake");
	});

	it("labelNotFoundError uses E_NOT_FOUND with label details", () => {
		const err = labelNotFoundError("Search", [
			{ refId: "e2", name: "Search box" },
		]);
		expect(err.code).toBe("E_NOT_FOUND");
		expect(err.message).toContain('label "Search"');
		expect(err.details?.label).toBe("Search");
		expect(err.details?.candidates).toHaveLength(1);
	});
});
