// @vitest-environment node

import { describe, expect, it } from "vitest";
import { CONTENT_SCRIPT_TOOL_SPECS } from "../../src/shared/registry/content-script-tools.js";
import { handlers } from "../../src/content-script/handlers.js";
import {
	buildContentScriptSpecs,
	buildInfraContentScriptSpecs,
} from "../../src/content-script/schemas.js";

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
