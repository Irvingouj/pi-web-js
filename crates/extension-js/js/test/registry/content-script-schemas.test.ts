// @vitest-environment node

import { describe, expect, it } from "vitest";
import { handlers } from "../../src/content-script/handlers.js";
import {
	buildContentScriptSpecs,
	buildInfraContentScriptSpecs,
} from "../../src/content-script/schemas.js";
import { CONTENT_SCRIPT_TOOL_SPECS } from "../../src/shared/cross/content-script-tools.js";

describe("buildContentScriptSpecs", () => {
	it("produces one spec per CONTENT_SCRIPT_TOOL_SPECS entry", () => {
		const specs = buildContentScriptSpecs();
		expect(specs).toHaveLength(CONTENT_SCRIPT_TOOL_SPECS.length);
	});

	it("every spec has params and returns defined", () => {
		const specs = buildContentScriptSpecs();
		for (const spec of specs) {
			expect(spec.params).toBeDefined();
			expect(spec.returns).toBeDefined();
		}
	});

	it("every handlerKey exists in handlers", () => {
		const specs = buildContentScriptSpecs();
		for (const spec of specs) {
			expect(
				handlers[spec.handlerKey],
				`missing handler for key: ${spec.handlerKey}`,
			).toBeDefined();
		}
	});

	it("page_snapshot_query spec has correct handlerKey and schema", () => {
		const spec = CONTENT_SCRIPT_TOOL_SPECS.find(
			(s) => s.action === "page_snapshot_query",
		);
		expect(spec).toBeDefined();
		expect(spec!.handlerKey).toBe("snapshot_query");
		expect(spec!.namespace).toBe("page");
		expect(spec!.name).toBe("snapshot_query");
	});

	it("page_snapshot_query params schema validates filter", () => {
		const spec = CONTENT_SCRIPT_TOOL_SPECS.find(
			(s) => s.action === "page_snapshot_query",
		);
		const result = spec!.params.safeParse({
			filter: { role: "button", interactiveOnly: true },
		});
		expect(result.success).toBe(true);
	});

	it("tab_snapshot_query spec has correct handlerKey and schema", () => {
		const spec = CONTENT_SCRIPT_TOOL_SPECS.find(
			(s) => s.action === "tab_snapshot_query",
		);
		expect(spec).toBeDefined();
		expect(spec!.handlerKey).toBe("snapshot_query");
		expect(spec!.namespace).toBe("web.tab");
		expect(spec!.name).toBe("snapshot_query");
	});
});

describe("buildInfraContentScriptSpecs", () => {
	it("defines infra-only direct-action schemas", () => {
		const specs = buildInfraContentScriptSpecs();
		expect(specs.length).toBeGreaterThan(0);
		for (const spec of specs) {
			expect(spec.registryAction).toBeTruthy();
			expect(spec.handlerKey).toBeTruthy();
			expect(spec.params).toBeDefined();
			expect(spec.returns).toBeDefined();
		}
	});
});
