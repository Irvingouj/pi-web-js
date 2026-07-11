// @vitest-environment node

import { describe, expect, it } from "vitest";
import { handlers } from "../../src/content-script/handlers.js";
import {
	buildContentScriptSpecs,
	buildInfraContentScriptSpecs,
} from "../../src/content-script/schemas.js";
import { expandCapability } from "../../src/shared/cross/capability.js";
import { CONTENT_SCRIPT_CAPABILITIES } from "../../src/shared/cross/content-script-capabilities.js";

describe("buildContentScriptSpecs", () => {
	it("produces one CS spec per expanded capability surface", () => {
		const expected = CONTENT_SCRIPT_CAPABILITIES.flatMap((c) =>
			expandCapability(c),
		).length;
		const specs = buildContentScriptSpecs();
		expect(specs).toHaveLength(expected);
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

	it("page_snapshot_query expands with correct handlerKey", () => {
		const cap = CONTENT_SCRIPT_CAPABILITIES.find(
			(c) => c.actionStem === "snapshot_query" || c.name === "snapshot_query",
		);
		expect(cap).toBeDefined();
		const page = expandCapability(cap!).find((e) => e.action === "page_snapshot_query");
		expect(page?.handlerKey).toBe("snapshot_query");
		expect(page?.namespace).toBe("page");
		expect(page?.name).toBe("snapshot_query");
	});

	it("page_snapshot_query params schema validates filter", () => {
		const page = buildContentScriptSpecs().find(
			(s) => s.registryAction === "page_snapshot_query",
		);
		expect(page).toBeDefined();
		const result = page!.params.safeParse({
			filter: { role: "button", interactiveOnly: true },
		});
		expect(result.success).toBe(true);
	});

	it("tab_snapshot_query expands with correct handlerKey", () => {
		const cap = CONTENT_SCRIPT_CAPABILITIES.find(
			(c) => c.actionStem === "snapshot_query" || c.name === "snapshot_query",
		);
		const tab = expandCapability(cap!).find((e) => e.action === "tab_snapshot_query");
		expect(tab?.handlerKey).toBe("snapshot_query");
		expect(tab?.namespace).toBe("web.tab");
		expect(tab?.name).toBe("snapshot_query");
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
