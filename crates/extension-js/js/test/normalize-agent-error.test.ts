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
			new Error(
				"Could not establish connection. Receiving end does not exist.",
			),
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
		const err = normalizeAgentError(new Error("Receiving end does not exist."));
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

	it("preserves Error name, message, and stack fields (T-016)", () => {
		const original = new Error("Something broke");
		original.name = "CustomError";
		const err = normalizeAgentError(original);
		expect(err.message).toBe("Something broke");
		expect(err.code).toBe("E_EXTENSION");
		expect(err.details?.name).toBe("CustomError");
		expect(typeof err.details?.stack).toBe("string");
		expect(err.details?.stack).toContain("Error");
	});

	it("extracts line number from stack trace (T-016)", () => {
		const original = new Error("Line error");
		original.stack = "Error: Line error\n    at foo (file.js:42:10)";
		const err = normalizeAgentError(original);
		expect(err.details?.line).toBe(42);
	});

	it("QuickJS ReferenceError includes message + line (T-016)", () => {
		const refError = new ReferenceError("foo is not defined");
		refError.stack =
			"ReferenceError: foo is not defined\n    at eval (cell.js:7:5)";
		const err = normalizeAgentError(refError);
		expect(err.details?.name).toBe("ReferenceError");
		expect(err.details?.line).toBe(7);
		expect(err.message).toContain("foo is not defined");
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
